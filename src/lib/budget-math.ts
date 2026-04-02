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
 * - spendingVelocity = rolling average of actual flex outflows (default 14 days,
 *   cashflow projection uses VELOCITY_LOOKBACK_DAYS=7 for faster response).
 *   Used for the cashflow projected-line drawdown (descriptive, not prescriptive).
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
  /** YNAB-computed shortfall: how much more needs to be budgeted to meet the goal */
  goalUnderFunded?: number;
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
  /** YNAB category ID — used for stable dedup (names can collide across groups) */
  categoryId?: string;
  /** Non-null for account transfers (e.g., CC payments) */
  transferAccountId: string | null;
  /** True if this transaction directly impacts the checking account balance.
   *  Non-checking-account transactions only affect the committed line. */
  hitsChecking: boolean;
  /** Event origin — defaults to 'scheduled' if omitted */
  source?: CashflowEventSource;
}

export interface FlexibleBreakdownResult {
  name: string;
  groupName: string;
  balance: number;
  budgeted: number;
  weeklyTarget?: number;
  goalDisplay?: { amount: number; cadence: 'weekly' | 'monthly' };
  goalSnoozed?: boolean;
  goalUnderFunded?: number;
  dailyAmount: number;
  windowAmount: number;
  spentInWindow: number;
  spentToday: number;
  remainingToday: number;
  percentOfTotal: number;
  /** Period-aware bar data used for visualization of this category. */
  bar: {
    /** 'weekly' | 'monthly' = goal-based period bar, 'depletion' = no-goal balance bar */
    mode: 'weekly' | 'monthly' | 'depletion';
    /** Spending in the goal period (last 7d for weekly, trailing 30d for monthly, MTD for depletion) */
    periodSpent: number;
    /** Decay-weighted spending: each txn's impact decays linearly over the period.
     *  impact = amount × (periodDays - daysSince) / periodDays.
     *  Models spending as coverage — a grocery run covers meals for several days,
     *  and each day that passes frees up budget. */
    effectiveSpent: number;
    /** Budget for the period (weeklyTarget, monthlyTarget, or activity+balance for depletion) */
    periodBudget: number;
    /** Fill ratio (0–1+). periodSpent / periodBudget. Can exceed 1 (overspent). */
    fill: number;
    /** Where the "today" marker sits within the bar (0–1). For weekly/monthly goal bars
     *  this is a fixed mid-period marker at 0.5. For depletion there is no
     *  pace concept, so the marker is null. */
    todayPosition: number | null;
    /** Upcoming scheduled transactions in this category, with date and amount for
     *  timeline placement on the bar. Sorted by date. */
    scheduledEvents: { date: string; amount: number }[];
  };
}

/** Where a cashflow event originated.
 *  'scheduled' = actual past transaction or YNAB scheduled transaction (non-goal event).
 *  'goal' = synthetic event from a TBD goal target date. */
export type CashflowEventSource = 'scheduled' | 'goal';

export interface CashflowEntry {
  date: string;
  label: string;
  amount: number;
  /** Committed balance at the start of this day (before events/drawdown) */
  startingBalance: number;
  /** Projected balance: checking minus accumulated spending velocity drawdown */
  balance: number;
  /** Committed balance: only moves on hitsChecking scheduled events (no daily drawdown) */
  checkingBalance: number;
  type: 'income' | 'bill';
  dayEvents?: {
    label: string;
    amount: number;
    type: 'income' | 'bill';
    source: CashflowEventSource;
  }[];
}

// ---------------------------------------------------------------------------
// Goal-derived tier classification
// ---------------------------------------------------------------------------

/**
 * Derive a category's budget tier from YNAB goal metadata.
 *
 * NEED + Refill  (goal_needs_whole_amount false/null) → 'flexible'
 * NEED + Set Aside (goal_needs_whole_amount true)     → 'necessity'
 * All other goal types (TB, TBD, MF, DEBT) or no goal → undefined (excluded)
 *
 * Snoozed goals still return their derived tier — the necessity gate
 * handles snoozed categories separately (skips blocking for them).
 */
export function deriveTierFromGoal(goal: {
  goalType: string | null | undefined;
  goalNeedsWholeAmount: boolean | null | undefined;
}): 'flexible' | 'necessity' | undefined {
  if (goal.goalType !== 'NEED') return undefined;
  return goal.goalNeedsWholeAmount === true ? 'necessity' : 'flexible';
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
 *
 * Each category gets a `bar` object with period-aware fill data:
 * - Weekly goal: 7-day sliding window vs weekly target
 * - Monthly goal: trailing MONTHLY_LOOKBACK_DAYS window vs monthly target
 * - No goal: depletion gauge (activity / (activity + balance))
 */
export function computeFlexibleBreakdown(
  categories: CategoryInput[],
  transactions: TransactionInput[],
  totalDailyAmount: number,
  today?: string,
  scheduledTransactions?: ScheduledTransactionInput[],
): FlexibleBreakdownResult[] {
  const todayStr = today ?? todayISO();

  // 14-day lookback window (for legacy spentInWindow / velocity)
  const windowStart = new Date(todayStr + 'T00:00:00');
  windowStart.setDate(windowStart.getDate() - LOOKBACK_DAYS);
  const windowStartStr = formatLocalDate(windowStart);

  // 7-day lookback for weekly goal bars
  const weekStart = new Date(todayStr + 'T00:00:00');
  weekStart.setDate(weekStart.getDate() - 7);
  const weekStartStr = formatLocalDate(weekStart);

  // Monthly lookback for monthly goal bars
  const monthWindowStart = new Date(todayStr + 'T00:00:00');
  monthWindowStart.setDate(monthWindowStart.getDate() - MONTHLY_LOOKBACK_DAYS);
  const monthWindowStartStr = formatLocalDate(monthWindowStart);

  // Helper: calendar day difference (DST-safe)
  const [ty, tm, td] = todayStr.split('-').map(Number) as [number, number, number];
  const todayMs = Date.UTC(ty, tm - 1, td);
  function daysSince(dateStr: string): number {
    const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
    return (todayMs - Date.UTC(y, m - 1, d)) / (1000 * 60 * 60 * 24);
  }

  // Spending by category across different windows.
  // Raw sums (for spentInWindow, velocity) and decay-weighted sums (for bar fill).
  // Decay: impact = amount × (periodDays - daysSince) / periodDays.
  // This models spending as coverage — a $20 grocery run covers $2.86/day for 7 days,
  // and each day that passes "uses up" one day of coverage, freeing budget.
  const spentTodayByCategory = new Map<string, number>();
  const windowSpentByCategory = new Map<string, number>();
  const weekSpentByCategory = new Map<string, number>();
  const weekDecayByCategory = new Map<string, number>();
  const monthSpentByCategory = new Map<string, number>();
  const monthDecayByCategory = new Map<string, number>();

  for (const txn of transactions) {
    if (txn.amount >= 0) continue; // skip inflows
    const absAmount = Math.abs(txn.amount);
    const age = daysSince(txn.date);

    if (txn.date === todayStr) {
      const cur = spentTodayByCategory.get(txn.categoryName) ?? 0;
      spentTodayByCategory.set(txn.categoryName, cur + absAmount);
    }
    // 14-day lookback: windowStartStr < date <= today
    if (txn.date > windowStartStr && txn.date <= todayStr) {
      const cur = windowSpentByCategory.get(txn.categoryName) ?? 0;
      windowSpentByCategory.set(txn.categoryName, cur + absAmount);
    }
    // 7-day lookback: weekStartStr < date <= today
    if (txn.date > weekStartStr && txn.date <= todayStr) {
      const cur = weekSpentByCategory.get(txn.categoryName) ?? 0;
      weekSpentByCategory.set(txn.categoryName, cur + absAmount);
      // Decay-weighted: impact decreases linearly as the txn ages
      const decay = absAmount * Math.max(0, (7 - age) / 7);
      const curDecay = weekDecayByCategory.get(txn.categoryName) ?? 0;
      weekDecayByCategory.set(txn.categoryName, curDecay + decay);
    }
    // 30-day lookback: monthWindowStartStr < date <= today
    if (txn.date > monthWindowStartStr && txn.date <= todayStr) {
      const cur = monthSpentByCategory.get(txn.categoryName) ?? 0;
      monthSpentByCategory.set(txn.categoryName, cur + absAmount);
      const decay = absAmount * Math.max(0, (30 - age) / 30);
      const curDecay = monthDecayByCategory.get(txn.categoryName) ?? 0;
      monthDecayByCategory.set(txn.categoryName, curDecay + decay);
    }
  }

  // Upcoming scheduled outflow events by category name, with date for timeline placement.
  // Materialize out to the longest bar period so monthly bars can show segments up to 30 days out.
  const scheduledByCategory = new Map<string, { date: string; amount: number }[]>();
  if (scheduledTransactions) {
    const horizonDate = new Date(todayStr + 'T00:00:00');
    horizonDate.setDate(horizonDate.getDate() + Math.max(LOOKAHEAD_DAYS, MONTHLY_LOOKBACK_DAYS));
    const horizonStr = formatLocalDate(horizonDate);
    const events = materializeFutureEvents(scheduledTransactions, todayStr, horizonStr);
    for (const ev of events) {
      if (ev.amount >= 0) continue; // only outflows
      const catName = ev.categoryName;
      if (!catName) continue;
      const list = scheduledByCategory.get(catName) ?? [];
      list.push({ date: ev.date, amount: Math.abs(ev.amount) });
      scheduledByCategory.set(catName, list);
    }
    // Sort each category's events by date
    for (const list of scheduledByCategory.values()) {
      list.sort((a, b) => a.date.localeCompare(b.date));
    }
  }

  const flexCats = categories.filter((c) => c.tier === 'flexible');

  return flexCats.map((cat) => {
    const catDailyAmount =
      cat.weeklyTarget != null ? cat.weeklyTarget / 7 : cat.balance / LOOKAHEAD_DAYS;
    const catSpentToday = spentTodayByCategory.get(cat.name) ?? 0;
    const catWindowAmount = catDailyAmount * LOOKBACK_DAYS;
    const scheduledEvents = scheduledByCategory.get(cat.name) ?? [];

    // --- Bar data ---
    let bar: FlexibleBreakdownResult['bar'];

    if (cat.goalDisplay) {
      if (cat.goalDisplay.cadence === 'weekly') {
        // Weekly goal: 7-day sliding window vs weekly target
        const periodSpent = weekSpentByCategory.get(cat.name) ?? 0;
        const effectiveSpent = weekDecayByCategory.get(cat.name) ?? 0;
        const periodBudget = cat.goalDisplay.amount;
        bar = {
          mode: 'weekly',
          periodSpent,
          effectiveSpent,
          periodBudget,
          fill: periodBudget > 0 ? effectiveSpent / periodBudget : 0,
          todayPosition: 0.5,
          scheduledEvents,
        };
      } else {
        // Monthly goal: 30-day sliding window vs monthly target
        const periodSpent = monthSpentByCategory.get(cat.name) ?? 0;
        const effectiveSpent = monthDecayByCategory.get(cat.name) ?? 0;
        const periodBudget = cat.goalDisplay.amount;
        bar = {
          mode: 'monthly',
          periodSpent,
          effectiveSpent,
          periodBudget,
          fill: periodBudget > 0 ? effectiveSpent / periodBudget : 0,
          todayPosition: 0.5,
          scheduledEvents,
        };
      }
    } else {
      // No goal: depletion gauge — how much of the envelope is used up.
      // Subtract upcoming scheduled outflows from remaining balance.
      const scheduledTotal = scheduledEvents.reduce((sum, ev) => sum + ev.amount, 0);
      const effectiveBalance = Math.max(0, cat.balance - scheduledTotal);
      const totalEnvelope = cat.activity + effectiveBalance;
      bar = {
        mode: 'depletion',
        periodSpent: cat.activity,
        effectiveSpent: cat.activity, // no decay for depletion (MTD from YNAB)
        periodBudget: totalEnvelope,
        fill: totalEnvelope > 0 ? cat.activity / totalEnvelope : 1,
        todayPosition: null,
        scheduledEvents,
      };
    }

    return {
      name: cat.name,
      groupName: cat.groupName,
      balance: cat.balance,
      budgeted: cat.budgeted,
      weeklyTarget: cat.weeklyTarget,
      goalDisplay: cat.goalDisplay,
      goalSnoozed: cat.goalSnoozed,
      goalUnderFunded: cat.goalUnderFunded,
      dailyAmount: catDailyAmount,
      windowAmount: catWindowAmount,
      spentInWindow: windowSpentByCategory.get(cat.name) ?? 0,
      spentToday: catSpentToday,
      remainingToday: catDailyAmount - catSpentToday,
      percentOfTotal: totalDailyAmount > 0 ? catDailyAmount / totalDailyAmount : 0,
      bar,
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

/** Shorter lookback for spending velocity used in the cashflow projection.
 *  More responsive to recent behavior changes than the full LOOKBACK_DAYS window. */
export const VELOCITY_LOOKBACK_DAYS = 7;

/** Lookback window for monthly goal bar fill (days) */
export const MONTHLY_LOOKBACK_DAYS = 30;

/** Maximum lookback across all features — determines how far back to sync transactions */
export const MAX_LOOKBACK_DAYS = MONTHLY_LOOKBACK_DAYS;

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

type DayEvent = {
  label: string;
  amount: number;
  type: 'income' | 'bill';
  source: CashflowEventSource;
  hitsChecking?: boolean;
};

export interface MaterializedEvent {
  date: string;
  amount: number;
  label: string;
  type: 'income' | 'bill';
  hitsChecking: boolean;
  source: CashflowEventSource;
  /** Category name from the source scheduled transaction */
  categoryName: string;
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
      source: (t.source ?? 'scheduled') as CashflowEventSource,
      categoryName: t.categoryName,
    };

    if (t.frequency === 'never') {
      if (t.dateNext > today && t.dateNext <= horizonStr) {
        events.push({ ...base, date: t.dateNext });
      }
    } else {
      const d = new Date(t.dateNext + 'T00:00:00');
      while (formatLocalDate(d) <= today) {
        if (!advanceByYnabFrequency(d, t.frequency)) break;
      }
      let dateStr = formatLocalDate(d);
      while (dateStr <= horizonStr) {
        events.push({ ...base, date: dateStr });
        if (!advanceByYnabFrequency(d, t.frequency)) break;
        dateStr = formatLocalDate(d);
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
  const lookbackStr = formatLocalDate(lookbackDate);

  const horizonDate = new Date(today + 'T00:00:00');
  horizonDate.setDate(horizonDate.getDate() + lookaheadDays);
  const horizonStr = formatLocalDate(horizonDate);

  // --- Past transactions by date ---
  const pastByDate = new Map<string, DayEvent[]>();
  for (const t of transactions) {
    if (t.date >= lookbackStr && t.date <= today) {
      const list = pastByDate.get(t.date) ?? [];
      list.push({
        label: t.payeeName,
        amount: t.amount,
        type: t.amount < 0 ? 'bill' : 'income',
        source: 'scheduled',
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
      source: ev.source,
      hitsChecking: ev.hitsChecking,
    });
    futureByDate.set(ev.date, list);
  }

  // --- Build projection ---
  const projection: CashflowEntry[] = [];

  // PAST: reconstruct balances from actual transactions
  const sortedPastDates: string[] = [];
  const d = new Date(lookbackStr + 'T00:00:00');
  while (formatLocalDate(d) < today) {
    sortedPastDates.push(formatLocalDate(d));
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
    const dayStart = pastBalance;
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
      startingBalance: dayStart,
      balance: pastBalance,
      checkingBalance: pastBalance,
      type: 'bill',
      dayEvents: events,
    });
  }

  // TODAY: anchor point — both lines start at the same value
  // Starting balance = checking balance before today's transactions
  const todayEventTotal = todayEvents ? todayEvents.reduce((sum, ev) => sum + ev.amount, 0) : 0;
  projection.push({
    date: today,
    label: 'Today',
    amount: 0,
    startingBalance: checkingBalance - todayEventTotal,
    balance: checkingBalance,
    checkingBalance: checkingBalance,
    type: 'bill',
    dayEvents: todayEvents,
  });

  // FUTURE: balance (projected) = daily spending drawdown + hitsChecking scheduled events.
  //         checkingBalance (committed) = only hitsChecking events (no daily drawdown).
  let futureBalance = checkingBalance;
  let futureCheckingBalance = checkingBalance;
  const fd = new Date(today + 'T00:00:00');
  fd.setDate(fd.getDate() + 1);

  while (formatLocalDate(fd) <= horizonStr) {
    const dateStr = formatLocalDate(fd);

    const dayStart = futureCheckingBalance;
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
      startingBalance: dayStart,
      balance: futureBalance,
      checkingBalance: futureCheckingBalance,
      type: 'bill',
      dayEvents: events,
    });

    fd.setDate(fd.getDate() + 1);
  }

  return projection;
}
