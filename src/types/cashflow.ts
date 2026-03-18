/** Computed cashflow snapshot for coaching context */
export interface CashflowSnapshot {
  /** Current checking balance from YNAB accounts (if available) */
  checkingBalance: number | null;
  /** Total unspent budget across all categories */
  totalBudgeted: number;
  /** True if checking balance won't cover bills due before next paycheck */
  cashflowWarning: boolean;
  /** Chronological projection of balance changes */
  projection: CashflowEvent[];
}

/** A single point in the cashflow timeline (one per day) */
export interface CashflowEvent {
  date: string;
  label: string;
  amount: number;
  /** Running balance after this event */
  balance: number;
  type: 'income' | 'bill';
  /** Discrete events (bills/paychecks) on this day, if any */
  dayEvents?: { label: string; amount: number; type: 'income' | 'bill' }[];
}
