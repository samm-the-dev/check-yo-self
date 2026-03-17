/** Cached YNAB API response — avoids hitting rate limits on every render */
export interface YnabCache {
  /** Cache key: 'categories' | 'accounts' | 'transactions' | 'month' | 'scheduled' */
  key: string;
  /** JSON-serialized YNAB API response */
  data: string;
  /** ISO timestamp of last successful fetch */
  lastSyncAt: string;
}

/** Minimum interval between YNAB API syncs (ms) */
export const SYNC_DEBOUNCE_MS = 15 * 60 * 1000; // 15 minutes
