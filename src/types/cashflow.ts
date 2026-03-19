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

/** Where a cashflow day event originated */
export type CashflowEventSource = 'scheduled' | 'goal';

/** A discrete event (bill/paycheck) on a given day */
export interface CashflowDayEvent {
  label: string;
  amount: number;
  type: 'income' | 'bill';
  /** Origin: 'scheduled' = YNAB scheduled transaction, 'goal' = TBD goal target date */
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
