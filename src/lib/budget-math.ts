/**
 * budget-math.ts — Canonical source for all budget computation in Check Yo Self.
 *
 * Mental model:
 * - YNAB owns all category balances. CYS never does its own budgeting math.
 * - totalAvailable = sum of flexible category balances > 0 (necessity excluded).
 * - dailyAmount = totalAvailable / daysRemaining (including today).
 * - weeklyAmount = dailyAmount * 7 (same rate, just expressed per-week).
 * - Cashflow projection anchors on today's checking balance. Past days are
 *   reconstructed from actual transactions. Future days subtract dailyAmount
 *   (flex spend only) and apply scheduled transactions (income +, bills −).
 * - CC payment transfers are included in cashflow — they represent real checking
 *   outflows even though YNAB models them as inter-account transfers.
 * - The 14-day lookahead may cross a month boundary; dailyAmount continues past
 *   month-end as a best-guess estimate of ongoing spending.
 *
 * All functions are pure — no React, no Dexie, no YNAB SDK. Numbers in, numbers out.
 */

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
   *  Transactions on CC accounts only hit the committed line, not checking. */
  hitsChecking: boolean;
}

export interface FlexibleBreakdownResult {
  name: string;
  groupName: string;
  balance: number;
  dailyAmount: number;
  weeklyAmount: number;
  spentThisWeek: number;
  spentToday: number;
  remainingToday: number;
  percentOfTotal: number;
}

export interface CashflowEntry {
  date: string;
  label: string;
  amount: number;
  /** Committed balance: checking minus accumulated daily drawdown */
  balance: number;
  /** Cash-in-bank balance: only moves on discrete events (bills, income, CC payments) */
  checkingBalance: number;
  type: 'income' | 'bill';
  dayEvents?: { label: string; amount: number; type: 'income' | 'bill' }[];
}

// ---------------------------------------------------------------------------
// Core computations
// ---------------------------------------------------------------------------

/**
 * Compute days remaining in the month, including today. Floors at 1.
 * @param year - full year (e.g. 2026)
 * @param month - 0-indexed month (0=Jan, 2=Mar)
 * @param dayOfMonth - current day of month (1-31)
 */
export function computeDaysRemaining(year: number, month: number, dayOfMonth: number): number {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  return Math.max(1, daysInMonth - dayOfMonth + 1);
}

/** dailyAmount = totalAvailable / daysRemaining */
export function computeDailyAmount(totalAvailable: number, daysRemaining: number): number {
  if (daysRemaining <= 0) return totalAvailable;
  return totalAvailable / daysRemaining;
}

/**
 * Sum of all flexible category balances > 0.
 * Negative balances are excluded (not subtracted).
 * Necessity categories are excluded.
 */
export function computeTotalAvailable(categories: CategoryInput[]): number {
  let total = 0;
  for (const cat of categories) {
    if (cat.tier === 'flexible' && cat.balance > 0) {
      total += cat.balance;
    }
  }
  return total;
}

/**
 * Per-category breakdown for flexible categories.
 * weeklyAmount = dailyAmount * 7 (consistent with the daily rate).
 */
export function computeFlexibleBreakdown(
  categories: CategoryInput[],
  transactions: TransactionInput[],
  daysRemaining: number,
  totalDailyAmount: number,
  today?: string,
): FlexibleBreakdownResult[] {
  const todayStr = today ?? _todayISO();
  const weekAgo = new Date(todayStr + 'T00:00:00');
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekAgoStr = weekAgo.toISOString().slice(0, 10);

  // Spending by category for today
  const spentTodayByCategory = new Map<string, number>();
  // Spending by category for last 7 days (including today)
  const weeklySpentByCategory = new Map<string, number>();

  for (const txn of transactions) {
    if (txn.amount >= 0) continue; // skip inflows
    const absAmount = Math.abs(txn.amount);

    if (txn.date === todayStr) {
      const cur = spentTodayByCategory.get(txn.categoryName) ?? 0;
      spentTodayByCategory.set(txn.categoryName, cur + absAmount);
    }
    // 7-day window: weekAgoStr < date <= today (exclusive start, inclusive end)
    if (txn.date > weekAgoStr && txn.date <= todayStr) {
      const cur = weeklySpentByCategory.get(txn.categoryName) ?? 0;
      weeklySpentByCategory.set(txn.categoryName, cur + absAmount);
    }
  }

  const flexCats = categories.filter((c) => c.tier === 'flexible');

  return flexCats.map((cat) => {
    const catDailyAmount = cat.balance / Math.max(1, daysRemaining);
    const catSpentToday = spentTodayByCategory.get(cat.name) ?? 0;
    // weeklyAmount = dailyAmount * 7 (consistent with daily rate)
    const catWeeklyAmount = catDailyAmount * 7;

    return {
      name: cat.name,
      groupName: cat.groupName,
      balance: cat.balance,
      dailyAmount: catDailyAmount,
      weeklyAmount: catWeeklyAmount,
      spentThisWeek: weeklySpentByCategory.get(cat.name) ?? 0,
      spentToday: catSpentToday,
      remainingToday: catDailyAmount - catSpentToday,
      percentOfTotal: totalDailyAmount > 0 ? catDailyAmount / totalDailyAmount : 0,
    };
  });
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
 * Estimate how many days a category balance will last at the current weekly
 * spend rate. Capped at LOOKAHEAD (14).
 */
export function computeCoverageDays(
  balance: number,
  spentThisWeek: number,
  lookahead = 14,
): number {
  if (balance <= 0 || spentThisWeek <= 0) return lookahead;
  const dailyRate = spentThisWeek / 7;
  return Math.min(Math.floor(balance / dailyRate), lookahead);
}

// ---------------------------------------------------------------------------
// Frequency advancement (duplicated from ynab.ts / cashflow.ts — now canonical)
// ---------------------------------------------------------------------------

/** Advance a date in-place by the YNAB scheduled transaction frequency */
export function advanceByYnabFrequency(date: Date, frequency: string): void {
  switch (frequency) {
    case 'daily':
      date.setDate(date.getDate() + 1);
      break;
    case 'weekly':
      date.setDate(date.getDate() + 7);
      break;
    case 'everyOtherWeek':
      date.setDate(date.getDate() + 14);
      break;
    case 'twiceAMonth':
      if (date.getDate() < 15) {
        date.setDate(15);
      } else {
        date.setDate(1);
        date.setMonth(date.getMonth() + 1);
      }
      break;
    case 'every4Weeks':
      date.setDate(date.getDate() + 28);
      break;
    case 'monthly':
      date.setMonth(date.getMonth() + 1);
      break;
    case 'everyOtherMonth':
      date.setMonth(date.getMonth() + 2);
      break;
    case 'every3Months':
      date.setMonth(date.getMonth() + 3);
      break;
    case 'every4Months':
      date.setMonth(date.getMonth() + 4);
      break;
    case 'twiceAYear':
      date.setMonth(date.getMonth() + 6);
      break;
    case 'yearly':
      date.setFullYear(date.getFullYear() + 1);
      break;
    case 'everyOtherYear':
      date.setFullYear(date.getFullYear() + 2);
      break;
    default:
      // 'never' or unknown — no change
      break;
  }
}

// ---------------------------------------------------------------------------
// Cashflow projection
// ---------------------------------------------------------------------------

interface CashflowParams {
  checkingBalance: number;
  dailyAmount: number;
  today: string; // YYYY-MM-DD
  lookbackDays: number;
  lookaheadDays: number;
  transactions: TransactionInput[];
  scheduledTransactions: ScheduledTransactionInput[];
}

type DayEvent = { label: string; amount: number; type: 'income' | 'bill'; hitsChecking?: boolean };

/**
 * Build a cashflow projection: past actuals + today anchor + future drawdown.
 *
 * Produces two balance series per day:
 * - `balance` (committed): subtracts dailyAmount + all scheduled events.
 *   Represents what's effectively available after accounting for flex spending.
 * - `checkingBalance` (cash-in-bank): only moves on events where
 *   `hitsChecking` is true — transactions that directly impact checking
 *   (bills from checking, CC payments, income). CC-account charges don't
 *   hit this line until the CC payment clears.
 *
 * Past days: both lines are identical (transactions already cleared).
 * Future days: lines diverge as daily flex spend accumulates on the committed
 * line while checking only moves on discrete events.
 *
 * dailyAmount continues past month-end as a best estimate of ongoing spending.
 */
export function buildCashflowProjection(params: CashflowParams): CashflowEntry[] {
  const {
    checkingBalance,
    dailyAmount,
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
  for (const t of scheduledTransactions) {
    const event: DayEvent = {
      label: t.payeeName,
      amount: t.amount,
      type: t.amount < 0 ? 'bill' : 'income',
      hitsChecking: t.hitsChecking,
    };

    if (t.frequency === 'never') {
      if (t.dateNext > today && t.dateNext <= horizonStr) {
        const list = futureByDate.get(t.dateNext) ?? [];
        list.push(event);
        futureByDate.set(t.dateNext, list);
      }
    } else {
      const d = new Date(t.dateNext + 'T00:00:00');
      // Advance past today
      while (d.toISOString().slice(0, 10) <= today) {
        advanceByYnabFrequency(d, t.frequency);
      }
      let dateStr = d.toISOString().slice(0, 10);
      while (dateStr <= horizonStr) {
        const list = futureByDate.get(dateStr) ?? [];
        list.push({ ...event });
        futureByDate.set(dateStr, list);
        advanceByYnabFrequency(d, t.frequency);
        dateStr = d.toISOString().slice(0, 10);
      }
    }
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

  // FUTURE: balance = dailyAmount drawdown + all scheduled events (committed view)
  //         checkingBalance = only events that directly hit checking (no daily drawdown,
  //         no CC-account charges — those only land when the CC payment clears)
  let futureBalance = checkingBalance;
  let futureCheckingBalance = checkingBalance;
  const fd = new Date(today + 'T00:00:00');
  fd.setDate(fd.getDate() + 1);

  while (fd.toISOString().slice(0, 10) <= horizonStr) {
    const dateStr = fd.toISOString().slice(0, 10);

    futureBalance -= dailyAmount;

    const events = futureByDate.get(dateStr);
    if (events) {
      for (const ev of events) {
        futureBalance += ev.amount;
        if (ev.hitsChecking) {
          futureCheckingBalance += ev.amount;
        }
      }
    }

    projection.push({
      date: dateStr,
      label: dateStr,
      amount: -dailyAmount,
      balance: futureBalance,
      checkingBalance: futureCheckingBalance,
      type: 'bill',
      dayEvents: events,
    });

    fd.setDate(fd.getDate() + 1);
  }

  return projection;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
