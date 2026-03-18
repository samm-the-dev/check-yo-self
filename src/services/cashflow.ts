import * as ynab from 'ynab';
import { db } from '@/db';
import { todayISO } from '@/lib/utils';
import type { CashflowSnapshot, CashflowEvent } from '@/types/cashflow';
import type { DailyBudgetSnapshot } from '@/types/budget';

/** Days of history to show before today */
const LOOKBACK_DAYS = 7;
/** Days of projection to show after today */
const LOOKAHEAD_DAYS = 14;

function milliToDollars(milliunits: number): number {
  return ynab.utils.convertMilliUnitsToCurrencyAmount(milliunits, 2);
}

/** Advance a date by the YNAB scheduled transaction frequency */
function advanceByYnabFrequency(
  date: Date,
  frequency: ynab.ScheduledTransactionDetailFrequencyEnum,
): void {
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
      break;
  }
}

type DayEvent = { label: string; amount: number; type: 'income' | 'bill' };

/**
 * Build a cashflow snapshot with past actuals + future projection.
 *
 * - Past (LOOKBACK_DAYS): actual transactions from YNAB cache
 * - Today: current checking balance (anchor point)
 * - Future (LOOKAHEAD_DAYS): scheduled transactions (bills + income) + linear budget drawdown
 */
export async function getCashflowSnapshot(
  budget?: DailyBudgetSnapshot | null,
): Promise<CashflowSnapshot> {
  const today = todayISO();

  // Date boundaries
  const lookbackDate = new Date(today + 'T00:00:00');
  lookbackDate.setDate(lookbackDate.getDate() - LOOKBACK_DAYS);
  const lookbackStr = lookbackDate.toISOString().slice(0, 10);

  const horizonDate = new Date(today + 'T00:00:00');
  horizonDate.setDate(horizonDate.getDate() + LOOKAHEAD_DAYS);
  const horizonStr = horizonDate.toISOString().slice(0, 10);

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

  // Past transactions (for lookback period)
  const pastTransactions = await db.cache.get('transactions');
  const pastByDate = new Map<string, DayEvent[]>();
  if (pastTransactions) {
    const txns = JSON.parse(pastTransactions.data) as ynab.TransactionDetail[];
    for (const t of txns) {
      if (t.date >= lookbackStr && t.date <= today) {
        const list = pastByDate.get(t.date) ?? [];
        list.push({
          label: t.payee_name ?? 'Unknown',
          amount: milliToDollars(t.amount), // negative for outflows
          type: t.amount < 0 ? 'bill' : 'income',
        });
        pastByDate.set(t.date, list);
      }
    }
  }

  // Scheduled transactions — both bills (negative) and income (positive)
  const scheduledCached = await db.cache.get('scheduled');
  const futureByDate = new Map<string, DayEvent[]>();
  if (scheduledCached) {
    const scheduled = JSON.parse(scheduledCached.data) as ynab.ScheduledTransactionDetail[];
    for (const t of scheduled) {
      const dollars = milliToDollars(t.amount);
      const event: DayEvent = {
        label: t.payee_name ?? 'Unknown',
        amount: dollars, // already signed: negative = bill, positive = income
        type: t.amount < 0 ? 'bill' : 'income',
      };

      if (t.frequency === 'never') {
        if (t.date_next > today && t.date_next <= horizonStr) {
          const list = futureByDate.get(t.date_next) ?? [];
          list.push(event);
          futureByDate.set(t.date_next, list);
        }
      } else {
        const d = new Date(t.date_next + 'T00:00:00');
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
  }

  // --- Build projection ---
  const projection: CashflowEvent[] = [];

  if (checkingBalance !== null) {
    const dailySpend = budget?.dailyAmount ?? 0;

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
        type: 'bill',
        dayEvents: events,
      });
    }

    // TODAY: anchor point
    projection.push({
      date: today,
      label: 'Today',
      amount: 0,
      balance: checkingBalance,
      type: 'bill',
      dayEvents: todayEvents,
    });

    // FUTURE: linear drawdown + scheduled events
    let futureBalance = checkingBalance;
    const fd = new Date(today + 'T00:00:00');
    fd.setDate(fd.getDate() + 1);

    while (fd.toISOString().slice(0, 10) <= horizonStr) {
      const dateStr = fd.toISOString().slice(0, 10);
      futureBalance -= dailySpend;

      const events = futureByDate.get(dateStr);
      if (events) {
        for (const ev of events) {
          futureBalance += ev.amount;
        }
      }

      projection.push({
        date: dateStr,
        label: dateStr,
        amount: -dailySpend,
        balance: futureBalance,
        type: 'bill',
        dayEvents: events,
      });

      fd.setDate(fd.getDate() + 1);
    }
  }

  // Cashflow warning: bills due before next income exceed checking
  let cashflowWarning = false;
  if (checkingBalance !== null) {
    // Find the next income event
    const sortedDates = [...futureByDate.keys()].sort();
    const nextIncomeDate = sortedDates.find((date) =>
      futureByDate.get(date)?.some((e) => e.type === 'income'),
    );
    if (nextIncomeDate) {
      const billsBefore = sortedDates
        .filter((date) => date < nextIncomeDate)
        .flatMap((date) => futureByDate.get(date) ?? [])
        .filter((e) => e.type === 'bill')
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
