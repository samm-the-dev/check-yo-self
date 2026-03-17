/** Computed daily budget — derived from YNAB category balances */
export interface DailyBudgetSnapshot {
  /** Total available across all spending categories */
  totalAvailable: number;
  /** Days remaining in the month (including today) */
  daysRemaining: number;
  /** totalAvailable / daysRemaining */
  dailyAmount: number;
  /** Sum of today's transactions */
  spentToday: number;
  /** dailyAmount - spentToday */
  remainingToday: number;
  /** Per-category breakdown for coaching context */
  categoryBreakdown: CategoryBalance[];
}

export interface CategoryBalance {
  name: string;
  groupName: string;
  /** Available balance in this category (milliunits converted to dollars) */
  balance: number;
  /** Budgeted this month */
  budgeted: number;
  /** Spent this month (activity — negative in YNAB, we store as positive) */
  activity: number;
}

/** Lightweight transaction summary for coaching context */
export interface TransactionSummary {
  payee: string;
  amount: number;
  category: string;
  date: string;
}
