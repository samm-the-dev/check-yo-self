/** Per-category tier override — reclassify where YNAB goal doesn't match intent */
export type CategoryOverrides = Record<string, 'necessity' | 'flexible' | 'skip'>;

/** A necessity category that needs more funding */
export interface NecessityGateItem {
  id: string;
  name: string;
  groupName: string;
  /** YNAB-computed shortfall: dollars still needed to meet the goal */
  shortfall: number;
}

/** Gate status when necessity categories aren't fully funded */
export interface NecessityGateStatus {
  /** True if any non-snoozed necessity category is underfunded */
  blocked: boolean;
  /** Necessity categories with outstanding shortfall */
  underfundedNecessities: NecessityGateItem[];
  /** Deep link to YNAB budget for current month (null until plan UUID resolves) */
  ynabBudgetLink: string | null;
}

/** Per-category budget breakdown for flexible categories */
export interface FlexibleCategoryDaily {
  name: string;
  groupName: string;
  balance: number;
  /** Budgeted this month in YNAB */
  budgeted: number;
  /** Weekly spending target from YNAB goal (undefined = no goal, balance-derived) */
  weeklyTarget?: number;
  /** Original YNAB goal amount and cadence for display */
  goalDisplay?: { amount: number; cadence: 'weekly' | 'monthly' };
  /** True if the YNAB goal is snoozed */
  goalSnoozed?: boolean;
  /** YNAB-computed shortfall: how much more needs to be budgeted to meet the goal */
  goalUnderFunded?: number;
  /** Target-derived or balance-derived daily rate */
  dailyAmount: number;
  /** Window budget (dailyAmount * LOOKBACK_DAYS) */
  windowAmount: number;
  /** Spent in the lookback window */
  spentInWindow: number;
  /** Today's transactions in this category */
  spentToday: number;
  /** dailyAmount - spentToday */
  remainingToday: number;
  /** Share of total flexible daily budget (0-1) */
  percentOfTotal: number;
}

/** Computed daily budget — derived from YNAB category balances and spending goals */
export interface DailyBudgetSnapshot {
  /** Total spending envelope: goal-derived for targeted categories, balance for others */
  totalAvailable: number;
  /** Rolling lookahead horizon (days) */
  daysRemaining: number;
  /** totalAvailable / daysRemaining */
  dailyAmount: number;
  /** Sum of today's transactions */
  spentToday: number;
  /** dailyAmount - spentToday */
  remainingToday: number;
  /** Per-category breakdown */
  categoryBreakdown: CategoryBalance[];
  /** YNAB Ready to Assign (dollars). Positive = unassigned funds, negative = overassigned. */
  readyToAssign: number | null;
  /** Gate status — present when tiers are configured */
  gate?: NecessityGateStatus;
  /** Per-category daily breakdown — present when tiers are configured */
  flexibleBreakdown?: FlexibleCategoryDaily[];
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

/** Lightweight transaction summary */
export interface TransactionSummary {
  payee: string;
  amount: number;
  category: string;
  date: string;
}
