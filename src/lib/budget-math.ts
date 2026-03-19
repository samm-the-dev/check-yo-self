/**
 * budget-math.ts — Canonical source for all budget computation in Check Yo Self.
 *
 * Mental model:
 * - YNAB owns all category balances. CYS never does its own budgeting math.
 * - totalAvailable = sum of flexible category spending envelopes (necessity excluded).
 *   Categories with a YNAB weekly/monthly spending goal contribute their goal-derived
 *   envelope; categories without a goal contribute their positive balance.
 * - dailyAmount = totalAvailable / LOOKAHEAD_DAYS (rolling horizon, month-agnostic).
 *   Used as the budget guardrail on the dashboard and for per-category pace.
 * - windowAmount = dailyAmount * LOOKBACK_DAYS (same rate, expressed per-window).
 * - spendingVelocity = 14-day rolling average of actual flex outflows.
 *   Used for the cashflow committed-line drawdown (descriptive, not prescriptive).
 * - Cashflow projection anchors on today's checking balance. Past days are
 *   reconstructed from actual transactions. Future days subtract spendingVelocity
 *   (flex spend only) and apply only hitsChecking scheduled transactions.
 * - Only hitsChecking events affect both lines — CC-billed charges are excluded
 *   because they manifest as CC payment transfers when they actually hit checking.
 *   This avoids double-counting.
 * - The 14-day lookahead may cross a month boundary; the spending velocity
 *   continues past month-end as a best-guess estimate of ongoing spending.
 *
 * All exported functions are pure (deterministic, no side effects) except when
 * callers omit optional date parameters — those fall back to the system clock
 * via todayISO(). No React, no Dexie, no YNAB SDK. Numbers in, numbers out.
 */

import { todayISO } from '@/lib/utils';

/** Format a local Date as YYYY-MM-DD without timezone shift. */
function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ---------------------------------------------------------------------------
// Input types (decoupled from YNAB SDK types)
// ---------------------------------------------------------------------------

export interface CategoryInput {
  id: string;
  name: string;
  groupName: string;
  /** Dollar amount (already converted from milliunits) */
  balance: number;
  budgeted: number;
  activity: number;
  tier: 'flexible' | 'necessity' | undefined;
  /** Weekly spending target from YNAB goal (dollars, normalized to weekly).
   *  When set, overrides balance-derived dailyBudget for pace/coverage. */
  weeklyTarget?: number;
  /** Original YNAB goal amount and cadence for display purposes */
  goalDisplay?: { amount: number; cadence: 'weekly' | 'monthly' };
  /** True if the YNAB goal is snoozed */
  goalSnoozed?: boolean;
}

export interface TransactionInput {
  date: string; // YYYY-MM-DD
  /** Dollar amount — negative for outflows */
  amount: number;
  categoryName: string;
  payeeName: string;
}

export interface ScheduledTransactionInput {
  dateNext: string; // YYYY-MM-DD
  /** Dollar amount — negative for outflows, positive for income */
  amount: number;
  frequency: string;
  payeeName: string;
  categoryName: string;
  /** Non-null for account transfers (e.g., CC payments) */
  transferAccountId: string | null;
  /** True if this transaction directly impacts the checking account balance.
   *  Non-checking-account transactions only affect the committed line. */
  hitsChecking: boolean;
}

export interface FlexibleBreakdownResult {
  name: string;
  groupName: string;
  balance: number;
  budgeted: number;
  weeklyTarget?: number;
  goalDisplay?: { amount: number; cadence: 'weekly' | 'monthly' };
  goalSnoozed?: boolean;
  dailyAmount: number;
  windowAmount: number;
  spentInWindow: number;
  spentToday: number;
  remainingToday: number;
  percentOfTotal: number;
}

export interface CashflowEntry {
  date: string;
  label: string;
  amount: number;
  /** Projected balance: checking minus accumulated spending velocity drawdown */
  balance: number;
  /** Committed balance: only moves on hitsChecking scheduled events (no daily drawdown) */
  checkingBalance: number;
  type: 'income' | 'bill';
  dayEvents?: { label: string; amount: number; type: 'income' | 'bill' }[];
}

// ---------------------------------------------------------------------------
// Core computations
// ---------------------------------------------------------------------------

/** dailyAmount = totalAvailable / LOOKAHEAD_DAYS (rolling horizon, month-agnostic) */
export function computeDailyAmount(totalAvailable: number): number {
  return totalAvailable / LOOKAHEAD_DAYS;
}

/**
 * Sum of all flexible category spending envelopes.
 *
 * Categories with a weekly target contribute `(weeklyTarget / 7) * LOOKAHEAD_DAYS`
 * regardless of current balance, so that `computeDailyAmount(totalAvailable)` equals
 * the sum of per-category daily amounts. Categories without a target contribute
 * their positive balance (negative balances excluded). Necessity categories are
 * always excluded.
 */
export function computeTotalAvailable(categories: CategoryInput[]): number {
  let total = 0;
  for (const cat of categories) {
    if (cat.tier !== 'flexible') continue;
    if (cat.weeklyTarget != null) {
      total += (cat.weeklyTarget / 7) * LOOKAHEAD_DAYS;
    } else if (cat.balance > 0) {
      total += cat.balance;
    }
  }
  return total;
}

/**
 * Per-category breakdown for flexible categories.
 * windowAmount = dailyAmount * LOOKBACK_DAYS (consistent with the lookback window).
 */
export function computeFlexibleBreakdown(
  categories: CategoryInput[],
  transactions: TransactionInput[],
  totalDailyAmount: number,
  today?: string,
): FlexibleBreakdownResult[] {
  const todayStr = today ?? todayISO();
  const windowStart = new Date(todayStr + 'T00:00:00');
  windowStart.setDate(windowStart.getDate() - LOOKBACK_DAYS);
  const windowStartStr = formatLocalDate(windowStart);

  // Spending by category for today
  const spentTodayByCategory = new Map<string, number>();
  // Spending by category for the lookback window (including today)
  const windowSpentByCategory = new Map<string, number>();

  for (const txn of transactions) {
    if (txn.amount >= 0) continue; // skip inflows
    const absAmount = Math.abs(txn.amount);

    if (txn.date === todayStr) {
      const cur = spentTodayByCategory.get(txn.categoryName) ?? 0;
      spentTodayByCategory.set(txn.categoryName, cur + absAmount);
    }
    // Lookback window: windowStartStr < date <= today (exclusive start, inclusive end)
    if (txn.date > windowStartStr && txn.date <= todayStr) {
      const cur = windowSpentByCategory.get(txn.categoryName) ?? 0;
      windowSpentByCategory.set(txn.categoryName, cur + absAmount);
    }
  }

  const flexCats = categories.filter((c) => c.tier === 'flexible');

  return flexCats.map((cat) => {
    const catDailyAmount =
      cat.weeklyTarget != null ? cat.weeklyTarget / 7 : cat.balance / LOOKAHEAD_DAYS;
    const catSpentToday = spentTodayByCategory.get(cat.name) ?? 0;
    const catWindowAmount = catDailyAmount * LOOKBACK_DAYS;

    return {
      name: cat.name,
      groupName: cat.groupName,
      balance: cat.balance,
      budgeted: cat.budgeted,
      weeklyTarget: cat.weeklyTarget,
      goalDisplay: cat.goalDisplay,
      goalSnoozed: cat.goalSnoozed,
      dailyAmount: catDailyAmount,
      windowAmount: catWindowAmount,
      spentInWindow: windowSpentByCategory.get(cat.name) ?? 0,
      spentToday: catSpentToday,
      remainingToday: catDailyAmount - catSpentToday,
      percentOfTotal: totalDailyAmount > 0 ? catDailyAmount / totalDailyAmount : 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Spending velocity
// ---------------------------------------------------------------------------

/** Canonical lookback window used across the app (days) */
export const LOOKBACK_DAYS = 14;

/** Canonical lookahead window used across the app (days) */
export const LOOKAHEAD_DAYS = 14;

/**
 * Compute average daily spending velocity from recent flexible-category outflows.
 *
 * Returns the average daily spend over the lookback window (always >= 0).
 * Returns 0 when no qualifying transactions exist — caller should fall back
 * to budget-derived dailyAmount in that case.
 */
export function computeSpendingVelocity(
  transactions: TransactionInput[],
  flexibleCategoryNames: Set<string>,
  today: string,
  lookbackDays: number = LOOKBACK_DAYS,
): number {
  const windowStart = new Date(today + 'T00:00:00');
  windowStart.setDate(windowStart.getDate() - lookbackDays);
  const windowStartStr = formatLocalDate(windowStart);

  let totalSpent = 0;
  for (const txn of transactions) {
    if (txn.amount >= 0) continue; // skip inflows
    if (!flexibleCategoryNames.has(txn.categoryName)) continue;
    // Window: windowStartStr < date <= today (exclusive start, inclusive end)
    if (txn.date > windowStartStr && txn.date <= today) {
      totalSpent += Math.abs(txn.amount);
    }
  }

  return lookbackDays > 0 ? totalSpent / lookbackDays : 0;
}

// ---------------------------------------------------------------------------
// Pace / overspend
// ---------------------------------------------------------------------------

/**
 * Compare actual spend over a lookback window against expected pace.
 * Returns the overspend amount (0 if on/under pace).
 */
export function computePaceOverspend(
  spentInWindow: number,
  categoryDailyAmount: number,
  lookbackDays: number,
): number {
  if (categoryDailyAmount <= 0) return spentInWindow;
  const expected = categoryDailyAmount * lookbackDays;
  return Math.max(0, spentInWindow - expected);
}

/**
 * How many days of the 28-day window has spending covered?
 *
 * Spending *is* coverage — a grocery run today covers meals for the next week.
 * daysConsumed = spentInWindow / dailyBudget where dailyBudget = balance / LOOKAHEAD_DAYS.
 *
 * 0 = no spending (bar empty). LOOKBACK_DAYS (14) = exactly on pace (bar at
 * today marker). > LOOKBACK_DAYS = ahead of pace (bar past today, spending
 * covers future days). Capped at LOOKBACK_DAYS + LOOKAHEAD_DAYS (28).
 */
export function computeCoverageDays(
  balance: number,
  spentInWindow: number,
  dailyBudgetOverride?: number,
): number {
  if (spentInWindow <= 0) return 0;
  const dailyBudget = dailyBudgetOverride ?? balance / LOOKAHEAD_DAYS;
  if (dailyBudget <= 0) return LOOKBACK_DAYS + LOOKAHEAD_DAYS;
  const consumed = spentInWindow / dailyBudget;
  return Math.min(consumed, LOOKBACK_DAYS + LOOKAHEAD_DAYS);
}

// ---------------------------------------------------------------------------
// Frequency advancement (canonical)
// ---------------------------------------------------------------------------

/**
 * Advance a date in-place by the YNAB scheduled transaction frequency.
 * Returns true if the date was advanced, false for 'never' or unknown
 * frequencies — callers must break out of materialization loops on false
 * to avoid infinite iteration.
 */
export function advanceByYnabFrequency(date: Date, frequency: string): boolean {
  switch (frequency) {
    case 'daily':
      date.setDate(date.getDate() + 1);
      return true;
    case 'weekly':
      date.setDate(date.getDate() + 7);
      return true;
    case 'everyOtherWeek':
      date.setDate(date.getDate() + 14);
      return true;
    case 'twiceAMonth':
      if (date.getDate() < 15) {
        date.setDate(15);
      } else {
        date.setDate(1);
        date.setMonth(date.getMonth() + 1);
      }
      return true;
    case 'every4Weeks':
      date.setDate(date.getDate() + 28);
      return true;
    case 'monthly':
      date.setMonth(date.getMonth() + 1);
      return true;
    case 'everyOtherMonth':
      date.setMonth(date.getMonth() + 2);
      return true;
    case 'every3Months':
      date.setMonth(date.getMonth() + 3);
      return true;
    case 'every4Months':
      date.setMonth(date.getMonth() + 4);
      return true;
    case 'twiceAYear':
      date.setMonth(date.getMonth() + 6);
      return true;
    case 'yearly':
      date.setFullYear(date.getFullYear() + 1);
      return true;
    case 'everyOtherYear':
      date.setFullYear(date.getFullYear() + 2);
      return true;
    default:
      // 'never' or unknown — no change, caller should not loop
      return false;
  }
}

// ---------------------------------------------------------------------------
// Cashflow projection
// ---------------------------------------------------------------------------

interface CashflowParams {
  checkingBalance: number;
  /** Daily flex spending used for the committed-balance drawdown.
   *  Typically spending velocity (14-day rolling avg of actual outflows),
   *  falling back to budget-derived dailyAmount when no data exists. */
  projectedDailySpend: number;
  today: string; // YYYY-MM-DD
  lookbackDays: number;
  lookaheadDays: number;
  transactions: TransactionInput[];
  scheduledTransactions: ScheduledTransactionInput[];
}

type DayEvent = { label: string; amount: number; type: 'income' | 'bill'; hitsChecking?: boolean };

export interface MaterializedEvent {
  date: string;
  amount: number;
  label: string;
  type: 'income' | 'bill';
  hitsChecking: boolean;
}

/**
 * Materialize scheduled transactions into concrete dated events within a window.
 * Handles both one-off ('never') and recurring frequencies. Breaks safely on
 * unrecognized frequencies to avoid infinite loops.
 */
export function materializeFutureEvents(
  scheduledTransactions: ScheduledTransactionInput[],
  today: string,
  horizonStr: string,
): MaterializedEvent[] {
  const events: MaterializedEvent[] = [];

  for (const t of scheduledTransactions) {
    const base = {
      amount: t.amount,
      label: t.payeeName,
      type: (t.amount < 0 ? 'bill' : 'income') as 'income' | 'bill',
      hitsChecking: t.hitsChecking,
    };

    if (t.frequency === 'never') {
      if (t.dateNext > today && t.dateNext <= horizonStr) {
        events.push({ ...base, date: t.dateNext });
      }
    } else {
      const d = new Date(t.dateNext + 'T00:00:00');
      while (d.toISOString().slice(0, 10) <= today) {
        if (!advanceByYnabFrequency(d, t.frequency)) break;
      }
      let dateStr = d.toISOString().slice(0, 10);
      while (dateStr <= horizonStr) {
        events.push({ ...base, date: dateStr });
        if (!advanceByYnabFrequency(d, t.frequency)) break;
        dateStr = d.toISOString().slice(0, 10);
      }
    }
  }

  return events;
}

/**
 * Build a cashflow projection: past actuals + today anchor + future drawdown.
 *
 * Produces two balance series per day:
 * - `checkingBalance` (committed): only moves on hitsChecking scheduled events —
 *   transactions that will concretely move money in/out of checking (direct debits,
 *   income, account transfers). No daily drawdown.
 * - `balance` (projected): subtracts projectedDailySpend each day + hitsChecking
 *   scheduled events. projectedDailySpend reflects actual spending velocity
 *   (14-day rolling avg of flex outflows), so the projected line shows where
 *   the user is heading based on real behavior rather than budget targets.
 *
 * Both lines exclude non-hitsChecking events (e.g., CC-billed charges) since
 * those manifest as CC payment transfers when they actually hit checking.
 *
 * Past days: both lines are identical (transactions already cleared).
 * Today: both lines anchor at checkingBalance.
 * Future days: lines diverge as daily flex spending accumulates on the
 * projected line while committed only moves on discrete scheduled events.
 */
export function buildCashflowProjection(params: CashflowParams): CashflowEntry[] {
  const {
    checkingBalance,
    projectedDailySpend,
    today,
    lookbackDays,
    lookaheadDays,
    transactions,
    scheduledTransactions,
  } = params;

  const lookbackDate = new Date(today + 'T00:00:00');
  lookbackDate.setDate(lookbackDate.getDate() - lookbackDays);
  const lookbackStr = lookbackDate.toISOString().slice(0, 10);

  const horizonDate = new Date(today + 'T00:00:00');
  horizonDate.setDate(horizonDate.getDate() + lookaheadDays);
  const horizonStr = horizonDate.toISOString().slice(0, 10);

  // --- Past transactions by date ---
  const pastByDate = new Map<string, DayEvent[]>();
  for (const t of transactions) {
    if (t.date >= lookbackStr && t.date <= today) {
      const list = pastByDate.get(t.date) ?? [];
      list.push({
        label: t.payeeName,
        amount: t.amount,
        type: t.amount < 0 ? 'bill' : 'income',
      });
      pastByDate.set(t.date, list);
    }
  }

  // --- Future scheduled events ---
  const futureByDate = new Map<string, DayEvent[]>();
  for (const ev of materializeFutureEvents(scheduledTransactions, today, horizonStr)) {
    const list = futureByDate.get(ev.date) ?? [];
    list.push({
      label: ev.label,
      amount: ev.amount,
      type: ev.type,
      hitsChecking: ev.hitsChecking,
    });
    futureByDate.set(ev.date, list);
  }

  // --- Build projection ---
  const projection: CashflowEntry[] = [];

  // PAST: reconstruct balances from actual transactions
  const sortedPastDates: string[] = [];
  const d = new Date(lookbackStr + 'T00:00:00');
  while (d.toISOString().slice(0, 10) < today) {
    sortedPastDates.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }

  // Compute starting balance by reversing all transactions from lookback..today
  let startBalance = checkingBalance;
  for (const dateStr of sortedPastDates) {
    const events = pastByDate.get(dateStr);
    if (events) {
      for (const ev of events) {
        startBalance -= ev.amount;
      }
    }
  }
  const todayEvents = pastByDate.get(today);
  if (todayEvents) {
    for (const ev of todayEvents) {
      startBalance -= ev.amount;
    }
  }

  // Walk forward applying actual transactions
  // Past: both lines are identical (transactions already cleared checking)
  let pastBalance = startBalance;
  for (const dateStr of sortedPastDates) {
    const events = pastByDate.get(dateStr);
    if (events) {
      for (const ev of events) {
        pastBalance += ev.amount;
      }
    }
    projection.push({
      date: dateStr,
      label: dateStr,
      amount: 0,
      balance: pastBalance,
      checkingBalance: pastBalance,
      type: 'bill',
      dayEvents: events,
    });
  }

  // TODAY: anchor point — both lines start at the same value
  projection.push({
    date: today,
    label: 'Today',
    amount: 0,
    balance: checkingBalance,
    checkingBalance: checkingBalance,
    type: 'bill',
    dayEvents: todayEvents,
  });

  // FUTURE: balance = projectedDailySpend drawdown + all scheduled events (committed view)
  //         checkingBalance = only hitsChecking events (no daily drawdown,
  //         no non-checking-account charges)
  let futureBalance = checkingBalance;
  let futureCheckingBalance = checkingBalance;
  const fd = new Date(today + 'T00:00:00');
  fd.setDate(fd.getDate() + 1);

  while (fd.toISOString().slice(0, 10) <= horizonStr) {
    const dateStr = fd.toISOString().slice(0, 10);

    futureBalance -= projectedDailySpend;

    const events = futureByDate.get(dateStr);
    if (events) {
      for (const ev of events) {
        if (ev.hitsChecking) {
          futureBalance += ev.amount;
          futureCheckingBalance += ev.amount;
        }
      }
    }

    projection.push({
      date: dateStr,
      label: dateStr,
      amount: -projectedDailySpend,
      balance: futureBalance,
      checkingBalance: futureCheckingBalance,
      type: 'bill',
      dayEvents: events,
    });

    fd.setDate(fd.getDate() + 1);
  }

  return projection;
}
