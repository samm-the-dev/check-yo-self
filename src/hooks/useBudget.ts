import { useState, useEffect, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db';
import {
  syncYnabData,
  getDailyBudgetSnapshot,
  getRecentTransactions,
  getUpcomingScheduled,
  getYnabToken,
  getPlanId,
} from '@/services/ynab';
import type { DailyBudgetSnapshot, TransactionSummary } from '@/types/budget';

interface BudgetState {
  /** Whether YNAB is configured (token + plan selected) */
  connected: boolean;
  /** Currently syncing from YNAB */
  syncing: boolean;
  /** The daily budget snapshot (null if not yet loaded) */
  budget: DailyBudgetSnapshot | null;
  /** Recent transactions (last 7 days) */
  recentTransactions: TransactionSummary[];
  /** Scheduled bills in the next 14 days */
  upcomingBills: TransactionSummary[];
  /** Force a refresh from YNAB */
  refresh: () => Promise<void>;
  /** Error message if sync failed */
  error: string | null;
}

export function useBudget(): BudgetState {
  const connected = !!getYnabToken() && !!getPlanId();
  const [syncing, setSyncing] = useState(false);
  const [budget, setBudget] = useState<DailyBudgetSnapshot | null>(null);
  const [recentTransactions, setRecentTransactions] = useState<TransactionSummary[]>([]);
  const [upcomingBills, setUpcomingBills] = useState<TransactionSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  // React to cache changes — recompute when YNAB data updates
  const cacheEntries = useLiveQuery(() => db.cache.toArray());

  const loadFromCache = useCallback(async () => {
    const [snap, txns, bills] = await Promise.all([
      getDailyBudgetSnapshot(),
      getRecentTransactions(7),
      getUpcomingScheduled(14),
    ]);
    setBudget(snap);
    setRecentTransactions(txns);
    setUpcomingBills(bills);
  }, []);

  // Recompute derived state whenever cache changes
  useEffect(() => {
    if (cacheEntries && cacheEntries.length > 0) {
      loadFromCache();
    }
  }, [cacheEntries, loadFromCache]);

  // Sync on mount if connected
  useEffect(() => {
    if (!connected) return;
    setSyncing(true);
    setError(null);
    syncYnabData()
      .catch((e) => {
        const msg = e instanceof Error ? e.message : 'Failed to sync with YNAB';
        setError(msg);
      })
      .finally(() => setSyncing(false));
  }, [connected]);

  const refresh = useCallback(async () => {
    if (!connected) return;
    setSyncing(true);
    setError(null);
    try {
      await syncYnabData(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to sync with YNAB';
      setError(msg);
    } finally {
      setSyncing(false);
    }
  }, [connected]);

  return { connected, syncing, budget, recentTransactions, upcomingBills, refresh, error };
}
