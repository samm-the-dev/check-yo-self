/** Category tier — necessity must be budgeted before daily budget shows */
export type CategoryTier = 'necessity' | 'flexible';

/** Map of YNAB category ID → tier assignment */
export type CategoryTierMap = Record<string, CategoryTier>;

/** Gate status when necessity categories aren't budgeted */
export interface NecessityGateStatus {
  /** True if any necessity category has budgeted === 0 */
  blocked: boolean;
  /** Necessity categories with zero budgeted */
  unbudgetedNecessities: CategoryBalance[];
  /** Deep link to YNAB budget for current month */
  ynabBudgetLink: string;
}

/** Per-category budget breakdown for flexible categories */
export interface FlexibleCategoryDaily {
  name: string;
  groupName: string;
  balance: number;
  /** balance / daysRemaining */
  dailyAmount: number;
  /** Weekly budget (dailyAmount * 7) */
  weeklyAmount: number;
  /** Spent in the last 7 days */
  spentThisWeek: number;
  /** Today's transactions in this category */
  spentToday: number;
  /** dailyAmount - spentToday */
  remainingToday: number;
  /** Share of total flexible daily budget (0-1) */
  percentOfTotal: number;
}

/** Spending insight for a category after a notable purchase */
export interface SpendingInsight {
  categoryName: string;
  /** Amount spent in the last 7 days */
  spentThisWeek: number;
  /** Weekly budget (balance / weeks remaining) */
  weeklyBudget: number;
  /** Remaining category balance after this week's spending */
  remainingBalance: number;
  /** Estimated date the remaining balance covers at current weekly rate */
  coversUntil: string;
  /** True if this week's spending exceeds the weekly budget */
  overWeeklyBudget: boolean;
}

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
  /** Gate status — present when tiers are configured */
  gate?: NecessityGateStatus;
  /** Per-category daily breakdown — present when tiers are configured */
  flexibleBreakdown?: FlexibleCategoryDaily[];
  /** Spending insights — present when a category's weekly spend is notable */
  spendingInsights?: SpendingInsight[];
}

export interface CategoryBalance {
  /** YNAB category ID */
  id: string;
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
