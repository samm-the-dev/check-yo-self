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

/** Per-category daily budget breakdown for flexible categories */
export interface FlexibleCategoryDaily {
  name: string;
  groupName: string;
  balance: number;
  /** balance / daysRemaining */
  dailyAmount: number;
  /** Today's transactions in this category */
  spentToday: number;
  /** dailyAmount - spentToday */
  remainingToday: number;
  /** Share of total flexible daily budget (0–1) */
  percentOfTotal: number;
}

/** Warning when spending is concentrated in one category */
export interface OverspendWarning {
  categoryName: string;
  spentAmount: number;
  dailyBudget: number;
  /** Fraction of total daily budget used (0–1) */
  percentUsed: number;
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
  /** Overspend warnings — present when a single category dominates today's spend */
  overspendWarnings?: OverspendWarning[];
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
