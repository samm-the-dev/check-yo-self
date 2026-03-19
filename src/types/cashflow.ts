/** Computed cashflow snapshot */
export interface CashflowSnapshot {
  /** Current checking balance from YNAB accounts (if available) */
  checkingBalance: number | null;
  /** Total unspent budget across all categories */
  totalBudgeted: number;
  /** True if checking balance won't cover bills due before next paycheck */
  cashflowWarning: boolean;
  /** Number of scheduled transactions feeding the projection */
  scheduledCount: number;
  /** Whether at least one recurring income transaction exists */
  hasRecurringIncome: boolean;
  /** Chronological projection of balance changes */
  projection: CashflowEvent[];
}

/** Re-export from budget-math — single source of truth for this type */
export type { CashflowEventSource } from '@/lib/budget-math';

import type { CashflowEventSource } from '@/lib/budget-math';

/** A discrete event (bill/paycheck) on a given day */
export interface CashflowDayEvent {
  label: string;
  amount: number;
  type: 'income' | 'bill';
  /** Origin: 'scheduled' = non-goal event (actual or scheduled), 'goal' = TBD goal target date */
  source: CashflowEventSource;
}

/** A single point in the cashflow timeline (one per day) */
export interface CashflowEvent {
  date: string;
  label: string;
  amount: number;
  /** Committed balance: checking minus accumulated daily flex drawdown */
  balance: number;
  /** Cash-in-bank balance: only moves on scheduled events that directly hit checking */
  checkingBalance: number;
  type: 'income' | 'bill';
  /** Discrete events (bills/paychecks) on this day, if any */
  dayEvents?: CashflowDayEvent[];
}
