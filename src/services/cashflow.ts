import type * as ynab from 'ynab';
import { db } from '@/db';
import { todayISO } from '@/lib/utils';
import type { CashflowSnapshot } from '@/types/cashflow';
import type { DailyBudgetSnapshot } from '@/types/budget';
import {
  buildCashflowProjection,
  computeSpendingVelocity,
  materializeFutureEvents,
  LOOKBACK_DAYS,
  LOOKAHEAD_DAYS,
  VELOCITY_LOOKBACK_DAYS,
  type TransactionInput,
  type ScheduledTransactionInput,
} from '@/lib/budget-math';
import { milliToDollars } from '@/services/ynab';

/**
 * Build a cashflow snapshot with past actuals + future projection.
 *
 * This is now a thin data-fetching layer. All math is in budget-math.ts.
 */
export async function getCashflowSnapshot(
  budget?: DailyBudgetSnapshot | null,
): Promise<CashflowSnapshot> {
  const today = todayISO();

  // --- Read from cache ---

  // Accounts — used for checking balance and to classify scheduled transactions
  let checkingBalance: number | null = null;
  const checkingAccountIds = new Set<string>();
  const accountsCached = await db.cache.get('accounts');
  if (accountsCached) {
    const accounts = JSON.parse(accountsCached.data) as ynab.Account[];
    const checkingAccounts = accounts.filter(
      (a) => a.type === 'checking' && !a.closed && !a.deleted,
    );
    for (const a of checkingAccounts) {
      checkingAccountIds.add(a.id);
    }
    if (checkingAccounts.length > 0) {
      checkingBalance = checkingAccounts.reduce((sum, a) => sum + milliToDollars(a.balance), 0);
    }
  }

  // Total budgeted
  let totalBudgeted = 0;
  const catCached = await db.cache.get('categories');
  if (catCached) {
    const groups = JSON.parse(catCached.data) as ynab.CategoryGroupWithCategories[];
    for (const group of groups) {
      if (group.hidden || group.name === 'Internal Master Category') continue;
      for (const cat of group.categories) {
        if (cat.hidden || cat.deleted) continue;
        totalBudgeted += milliToDollars(cat.balance);
      }
    }
  }

  // Convert cached transactions to budget-math inputs.
  // allTransactions: used for spending velocity (includes CC flex spending).
  // checkingTransactions: used for cashflow past-balance reconstruction
  //   (only transactions that moved money in/out of checking).
  const allTransactions: TransactionInput[] = [];
  const checkingTransactions: TransactionInput[] = [];
  const pastTxnsCached = await db.cache.get('transactions');
  if (pastTxnsCached) {
    const txns = JSON.parse(pastTxnsCached.data) as ynab.TransactionDetail[];
    for (const t of txns) {
      const input: TransactionInput = {
        date: t.date,
        amount: milliToDollars(t.amount),
        categoryName: t.category_name ?? 'Uncategorized',
        payeeName: t.payee_name ?? 'Unknown',
      };
      allTransactions.push(input);

      // Only include transactions owned by a checking account for past-balance
      // reconstruction. Transfer counterparts on non-checking accounts are
      // excluded to avoid double-counting (YNAB records both sides).
      if (checkingAccountIds.has(t.account_id)) {
        checkingTransactions.push(input);
      }
    }
  }

  // Convert scheduled transactions to budget-math inputs
  // hitsChecking: true if the transaction is on a checking account or transfers to one.
  // Non-checking-account charges only affect the committed balance line.
  const scheduledTransactions: ScheduledTransactionInput[] = [];
  const scheduledCached = await db.cache.get('scheduled');
  if (scheduledCached) {
    const scheduled = JSON.parse(scheduledCached.data) as ynab.ScheduledTransactionDetail[];
    for (const t of scheduled) {
      const onChecking = checkingAccountIds.has(t.account_id);
      const transfersToChecking =
        t.transfer_account_id != null && checkingAccountIds.has(t.transfer_account_id);
      // YNAB signs amounts from the source account's perspective.
      // When a transfer targets checking from a non-checking account (e.g., CC
      // payment scheduled on the CC side), negate to get the checking perspective.
      const baseAmount = milliToDollars(t.amount);
      const amount = !onChecking && transfersToChecking ? -baseAmount : baseAmount;
      scheduledTransactions.push({
        dateNext: t.date_next,
        amount,
        frequency: t.frequency,
        payeeName: t.payee_name ?? 'Unknown',
        categoryName: t.category_name ?? 'Uncategorized',
        categoryId: t.category_id ?? undefined,
        transferAccountId: t.transfer_account_id ?? null,
        hitsChecking: onChecking || transfersToChecking,
      });
    }
  }

  // Generate synthetic cashflow events from TBD (Target Balance by Date) goals.
  // These represent known future expenses (property tax, annual insurance) with a
  // target date. Dedup: skip if a scheduled transaction in the same category has
  // a date within ±7 days of the goal target date.
  if (catCached) {
    const groups = JSON.parse(catCached.data) as ynab.CategoryGroupWithCategories[];
    const horizonDate = new Date(today + 'T00:00:00');
    horizonDate.setDate(horizonDate.getDate() + LOOKAHEAD_DAYS);
    const horizonStr = [
      horizonDate.getFullYear(),
      String(horizonDate.getMonth() + 1).padStart(2, '0'),
      String(horizonDate.getDate()).padStart(2, '0'),
    ].join('-');

    for (const group of groups) {
      if (group.hidden || group.name === 'Internal Master Category') continue;
      for (const cat of group.categories) {
        if (cat.hidden || cat.deleted) continue;
        if (cat.goal_type !== 'TBD' || !cat.goal_target_date || cat.goal_target == null) continue;

        const targetDate = cat.goal_target_date.slice(0, 10);
        if (targetDate <= today || targetDate > horizonStr) continue;

        // Dedup: skip if a scheduled transaction in same category is within ±7 days.
        // Match by categoryId (stable) with name fallback for transfers (no category ID).
        const targetMs = new Date(targetDate + 'T00:00:00').getTime();
        const hasSimilarScheduled = scheduledTransactions.some((st) => {
          const sameCategory =
            (st.categoryId && st.categoryId === cat.id) || st.categoryName === cat.name;
          if (!sameCategory) return false;
          return (
            Math.abs(new Date(st.dateNext + 'T00:00:00').getTime() - targetMs) <=
            7 * 24 * 60 * 60 * 1000
          );
        });
        if (hasSimilarScheduled) continue;

        // Add synthetic scheduled transaction for the TBD goal
        scheduledTransactions.push({
          dateNext: targetDate,
          amount: -milliToDollars(cat.goal_target),
          frequency: 'never',
          payeeName: `${cat.name} (goal)`,
          categoryName: cat.name,
          categoryId: cat.id,
          transferAccountId: null,
          hitsChecking: true,
          source: 'goal',
        });
      }
    }
  }

  // Compute spending velocity from actual flex outflows (7-day rolling avg).
  // Shorter window is more responsive to recent behavior changes.
  // Falls back to budget-derived dailyAmount when no transaction data exists.
  const flexNames = new Set(budget?.flexibleBreakdown?.map((c) => c.name) ?? []);
  const velocity = computeSpendingVelocity(
    allTransactions,
    flexNames,
    today,
    VELOCITY_LOOKBACK_DAYS,
  );
  const projectedDailySpend = velocity > 0 ? velocity : (budget?.dailyAmount ?? 0);

  // Delegate projection to budget-math
  let projection: CashflowSnapshot['projection'] = [];
  if (checkingBalance !== null) {
    projection = buildCashflowProjection({
      checkingBalance,
      projectedDailySpend,
      today,
      lookbackDays: LOOKBACK_DAYS,
      lookaheadDays: LOOKAHEAD_DAYS,
      transactions: checkingTransactions,
      scheduledTransactions,
    });
  }

  // Cashflow warning: checking-account bills due before next income exceed balance.
  let cashflowWarning = false;
  if (checkingBalance !== null) {
    const horizonDate = new Date(today + 'T00:00:00');
    horizonDate.setDate(horizonDate.getDate() + LOOKAHEAD_DAYS);
    const horizonStr = [
      horizonDate.getFullYear(),
      String(horizonDate.getMonth() + 1).padStart(2, '0'),
      String(horizonDate.getDate()).padStart(2, '0'),
    ].join('-');

    const checkingEvents = materializeFutureEvents(scheduledTransactions, today, horizonStr).filter(
      (e) => e.hitsChecking,
    );

    const sortedDates = [...new Set(checkingEvents.map((e) => e.date))].sort();
    const nextIncomeDate = sortedDates.find((date) =>
      checkingEvents.some((e) => e.date === date && e.amount > 0),
    );
    if (nextIncomeDate) {
      const billsBefore = checkingEvents
        .filter((e) => e.date < nextIncomeDate && e.amount < 0)
        .reduce((sum, e) => sum + Math.abs(e.amount), 0);
      cashflowWarning = billsBefore > checkingBalance;
    }
  }

  // Coverage signals for methodology display
  const scheduledCount = scheduledTransactions.length;
  const incomeFrequencies = new Set(['never']);
  const hasRecurringIncome = scheduledTransactions.some(
    (t) => t.amount > 0 && !incomeFrequencies.has(t.frequency),
  );

  // Velocity window start date (for chart reference line)
  const velStart = new Date(today + 'T00:00:00');
  velStart.setDate(velStart.getDate() - VELOCITY_LOOKBACK_DAYS);
  const velocityWindowStart = [
    velStart.getFullYear(),
    String(velStart.getMonth() + 1).padStart(2, '0'),
    String(velStart.getDate()).padStart(2, '0'),
  ].join('-');

  return {
    checkingBalance,
    totalBudgeted,
    cashflowWarning,
    scheduledCount,
    hasRecurringIncome,
    velocityWindowStart,
    projection,
  };
}
