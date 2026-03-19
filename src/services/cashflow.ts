import * as ynab from 'ynab';
import { db } from '@/db';
import { todayISO } from '@/lib/utils';
import type { CashflowSnapshot } from '@/types/cashflow';
import type { DailyBudgetSnapshot } from '@/types/budget';
import {
  buildCashflowProjection,
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

  // Checking balance
  let checkingBalance: number | null = null;
  const accountsCached = await db.cache.get('accounts');
  if (accountsCached) {
    const accounts = JSON.parse(accountsCached.data) as ynab.Account[];
    const checkingAccounts = accounts.filter(
      (a) => a.type === 'checking' && !a.closed && !a.deleted,
    );
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
  const scheduledTransactions: ScheduledTransactionInput[] = [];
  const scheduledCached = await db.cache.get('scheduled');
  if (scheduledCached) {
    const scheduled = JSON.parse(scheduledCached.data) as ynab.ScheduledTransactionDetail[];
    for (const t of scheduled) {
      scheduledTransactions.push({
        dateNext: t.date_next,
        amount: milliToDollars(t.amount),
        frequency: t.frequency,
        payeeName: t.payee_name ?? 'Unknown',
        categoryName: t.category_name ?? 'Uncategorized',
        transferAccountId: t.transfer_account_id ?? null,
      });
    }
  }

  // Delegate projection to budget-math
  let projection: CashflowSnapshot['projection'] = [];
  if (checkingBalance !== null) {
    projection = buildCashflowProjection({
      checkingBalance,
      dailyAmount: budget?.dailyAmount ?? 0,
      today,
      lookbackDays: LOOKBACK_DAYS,
      lookaheadDays: LOOKAHEAD_DAYS,
      transactions,
      scheduledTransactions,
    });
  }

  // Cashflow warning: bills due before next income exceed checking
  let cashflowWarning = false;
  if (checkingBalance !== null) {
    // Build future events map from projection for warning check
    const futureEvents = projection
      .filter((e) => e.date > today && e.dayEvents)
      .flatMap((e) => e.dayEvents!.map((ev) => ({ ...ev, date: e.date })));

    const sortedDates = [...new Set(futureEvents.map((e) => e.date))].sort();
    const nextIncomeDate = sortedDates.find((date) =>
      futureEvents.some((e) => e.date === date && e.type === 'income'),
    );
    if (nextIncomeDate) {
      const billsBefore = futureEvents
        .filter((e) => e.date < nextIncomeDate && e.type === 'bill')
        .reduce((sum, e) => sum + Math.abs(e.amount), 0);
      cashflowWarning = billsBefore > checkingBalance;
    }
  }

  return {
    checkingBalance,
    totalBudgeted,
    cashflowWarning,
    projection,
  };
}
