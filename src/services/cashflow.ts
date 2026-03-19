import * as ynab from 'ynab';
import { db } from '@/db';
import { todayISO } from '@/lib/utils';
import type { CashflowSnapshot } from '@/types/cashflow';
import type { DailyBudgetSnapshot } from '@/types/budget';
import {
  buildCashflowProjection,
  computeSpendingVelocity,
  advanceByYnabFrequency,
  type TransactionInput,
  type ScheduledTransactionInput,
} from '@/lib/budget-math';

/** Days of history to show before today */
const LOOKBACK_DAYS = 7;
/** Days of projection to show after today */
const LOOKAHEAD_DAYS = 14;

function milliToDollars(milliunits: number): number {
  return ynab.utils.convertMilliUnitsToCurrencyAmount(milliunits, 2);
}

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

  // Convert cached transactions to budget-math inputs
  const transactions: TransactionInput[] = [];
  const pastTxnsCached = await db.cache.get('transactions');
  if (pastTxnsCached) {
    const txns = JSON.parse(pastTxnsCached.data) as ynab.TransactionDetail[];
    for (const t of txns) {
      transactions.push({
        date: t.date,
        amount: milliToDollars(t.amount),
        categoryName: t.category_name ?? 'Uncategorized',
        payeeName: t.payee_name ?? 'Unknown',
      });
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
      scheduledTransactions.push({
        dateNext: t.date_next,
        amount: milliToDollars(t.amount),
        frequency: t.frequency,
        payeeName: t.payee_name ?? 'Unknown',
        categoryName: t.category_name ?? 'Uncategorized',
        transferAccountId: t.transfer_account_id ?? null,
        hitsChecking: onChecking || transfersToChecking,
      });
    }
  }

  // Compute spending velocity from actual flex outflows (14-day rolling avg).
  // Falls back to budget-derived dailyAmount when no transaction data exists.
  const flexNames = new Set(budget?.flexibleBreakdown?.map((c) => c.name) ?? []);
  const velocity = computeSpendingVelocity(transactions, flexNames, today);
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
      transactions,
      scheduledTransactions,
    });
  }

  // Cashflow warning: checking-account bills due before next income exceed balance.
  // Materializes recurring scheduled transactions so biweekly/weekly bills are counted.
  let cashflowWarning = false;
  if (checkingBalance !== null) {
    const horizonDate = new Date(today + 'T00:00:00');
    horizonDate.setDate(horizonDate.getDate() + LOOKAHEAD_DAYS);
    const horizonStr = horizonDate.toISOString().slice(0, 10);

    // Materialize all future hitsChecking events within the lookahead window
    const materializedEvents: { date: string; amount: number }[] = [];
    for (const t of scheduledTransactions) {
      if (!t.hitsChecking) continue;
      if (t.frequency === 'never') {
        if (t.dateNext > today && t.dateNext <= horizonStr) {
          materializedEvents.push({ date: t.dateNext, amount: t.amount });
        }
      } else {
        const d = new Date(t.dateNext + 'T00:00:00');
        while (d.toISOString().slice(0, 10) <= today) {
          advanceByYnabFrequency(d, t.frequency);
        }
        let dateStr = d.toISOString().slice(0, 10);
        while (dateStr <= horizonStr) {
          materializedEvents.push({ date: dateStr, amount: t.amount });
          advanceByYnabFrequency(d, t.frequency);
          dateStr = d.toISOString().slice(0, 10);
        }
      }
    }

    const sortedDates = [...new Set(materializedEvents.map((e) => e.date))].sort();
    const nextIncomeDate = sortedDates.find((date) =>
      materializedEvents.some((e) => e.date === date && e.amount > 0),
    );
    if (nextIncomeDate) {
      const billsBefore = materializedEvents
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

  return {
    checkingBalance,
    totalBudgeted,
    cashflowWarning,
    scheduledCount,
    hasRecurringIncome,
    projection,
  };
}
