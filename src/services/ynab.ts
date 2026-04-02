import * as ynab from 'ynab';
import { db } from '@/db';
import { SYNC_DEBOUNCE_MS } from '@/types/ynab-cache';
import type {
  DailyBudgetSnapshot,
  CategoryBalance,
  CategoryOverrides,
  NecessityGateStatus,
  NecessityGateItem,
  TransactionSummary,
} from '@/types/budget';
import { todayISO } from '@/lib/utils';
import {
  computeDailyAmount,
  computeTotalAvailable,
  computeFlexibleBreakdown,
  deriveTierFromGoal,
  LOOKAHEAD_DAYS,
  MAX_LOOKBACK_DAYS,
  advanceByYnabFrequency,
  type CategoryInput,
} from '@/lib/budget-math';

const TOKEN_KEY = 'cys-ynab-token';
const PLAN_KEY = 'cys-ynab-plan-id';
const OVERRIDES_KEY = 'cys-category-overrides';
const STATE_KEY = 'cys-oauth-state';

// ---------------------------------------------------------------------------
// OAuth helpers (Implicit Grant)
// ---------------------------------------------------------------------------

/** Read the YNAB OAuth Client ID from env — throws if missing */
function getYnabClientId(): string {
  const id = import.meta.env.VITE_YNAB_CLIENT_ID;
  if (!id) throw new Error('VITE_YNAB_CLIENT_ID is not set — cannot build OAuth URL');
  return id;
}

/** Build the redirect URI for the current environment */
function getRedirectUri(): string {
  return window.location.origin + import.meta.env.BASE_URL;
}

/** Generate a cryptographic random state value and store it for CSRF validation */
function generateOAuthState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const state = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  sessionStorage.setItem(STATE_KEY, state);
  return state;
}

/** Build the YNAB OAuth authorize URL (Implicit Grant) */
export function buildAuthUrl(): string {
  const params = new URLSearchParams({
    client_id: getYnabClientId(),
    redirect_uri: getRedirectUri(),
    response_type: 'token',
    scope: 'read-only',
    state: generateOAuthState(),
  });
  return `https://app.ynab.com/oauth/authorize?${params.toString()}`;
}

/**
 * Check the URL hash for an OAuth access_token (redirect callback).
 * Validates the state parameter to prevent CSRF attacks.
 * If valid, stores the token in localStorage and clears the hash.
 * Returns the token string if extracted, null otherwise.
 */
export function extractTokenFromHash(): string | null {
  const hash = window.location.hash;
  if (!hash.includes('access_token')) return null;

  const params = new URLSearchParams(hash.replace(/^#/, ''));

  // Validate state parameter to prevent CSRF / login-injection attacks
  const returnedState = params.get('state');
  const expectedState = sessionStorage.getItem(STATE_KEY);
  sessionStorage.removeItem(STATE_KEY);

  if (!returnedState || returnedState !== expectedState) {
    // State mismatch — reject the token and clean up
    history.replaceState(null, '', window.location.pathname + window.location.search);
    return null;
  }

  const token = params.get('access_token');
  if (!token) return null;

  localStorage.setItem(TOKEN_KEY, token);
  // With default plan selection enabled in the YNAB OAuth app, the user
  // picks their budget on YNAB's consent screen. We use "default" as the
  // plan ID for API calls — YNAB resolves it server-side. The real UUID
  // is resolved on the first sync for deep links.
  localStorage.setItem(PLAN_KEY, 'default');
  // Clear the hash without triggering a navigation
  history.replaceState(null, '', window.location.pathname + window.location.search);
  return token;
}

/** Redirect the browser to YNAB's OAuth consent page */
export function initiateLogin(): void {
  window.location.href = buildAuthUrl();
}

/** Clear token, plan, overrides, and cached data (sign out) */
export async function logout(): Promise<void> {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(PLAN_KEY);
  localStorage.removeItem(OVERRIDES_KEY);
  // Clean up legacy tier key from pre-goal-derived era
  localStorage.removeItem('cys-category-tiers');
  // Clear cached YNAB data from IndexedDB
  await db.cache.clear();
}

// ---------------------------------------------------------------------------
// Token access (used internally + by other modules)
// ---------------------------------------------------------------------------

/** Get the stored YNAB access token */
export function getYnabToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function clearYnabToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/** Get or set the selected budget (plan) ID */
export function getPlanId(): string | null {
  return localStorage.getItem(PLAN_KEY);
}

/** Returns the resolved plan UUID, or null if still "default" (unresolved) */
export function getResolvedPlanId(): string | null {
  const id = getPlanId();
  return id && id !== 'default' ? id : null;
}

export function setPlanId(id: string): void {
  localStorage.setItem(PLAN_KEY, id);
}

/** Get per-category tier overrides */
export function getCategoryOverrides(): CategoryOverrides {
  const raw = localStorage.getItem(OVERRIDES_KEY);
  return raw ? (JSON.parse(raw) as CategoryOverrides) : {};
}

/** Set per-category tier overrides */
export function setCategoryOverrides(overrides: CategoryOverrides): void {
  localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides));
}

/** Create an authenticated YNAB API client */
function getClient(): ynab.API | null {
  const token = getYnabToken();
  if (!token) return null;
  return new ynab.API(token);
}

/** Check if a cache key needs refreshing */
async function needsSync(key: string): Promise<boolean> {
  const cached = await db.cache.get(key);
  if (!cached) return true;
  const elapsed = Date.now() - new Date(cached.lastSyncAt).getTime();
  return elapsed > SYNC_DEBOUNCE_MS;
}

/** Read a cached value, parsed from JSON */
async function readCache<T>(key: string): Promise<T | null> {
  const cached = await db.cache.get(key);
  if (!cached) return null;
  return JSON.parse(cached.data) as T;
}

/** Write a value to cache */
async function writeCache(key: string, data: unknown): Promise<void> {
  await db.cache.put({
    key,
    data: JSON.stringify(data),
    lastSyncAt: new Date().toISOString(),
  });
}

/**
 * Check if an error is a YNAB 401 (token revoked / invalid).
 * If so, clear the stored token so the app returns to login.
 */
function isUnauthorized(err: unknown): boolean {
  if (err && typeof err === 'object' && 'error' in err) {
    const ynabErr = err as { error: { id: string } };
    if (ynabErr.error?.id === '401') return true;
  }
  return false;
}

/** Callback invoked when a 401 is detected — set by App.tsx */
let onUnauthorized: (() => void) | null = null;

/** Register a callback for 401 events (token revoked) */
export function setOnUnauthorized(cb: () => void): void {
  onUnauthorized = cb;
}

function handleUnauthorized(): void {
  clearYnabToken();
  onUnauthorized?.();
}

/** Sync all YNAB data needed for the dashboard. Respects debounce unless force=true. */
export async function syncYnabData(force = false): Promise<void> {
  const client = getClient();
  const planId = getPlanId();
  if (!client || !planId) return;

  const today = todayISO();
  // Fetch enough history for the longest lookback window (monthly goal bars
  // need 30 days). Also prevents month-rollover transaction loss.
  const lookbackDate = new Date(today + 'T00:00:00');
  lookbackDate.setDate(lookbackDate.getDate() - MAX_LOOKBACK_DAYS);
  // Format as local date to avoid UTC timezone shift (toISOString can be off by a day)
  const sinceDate = [
    lookbackDate.getFullYear(),
    String(lookbackDate.getMonth() + 1).padStart(2, '0'),
    String(lookbackDate.getDate()).padStart(2, '0'),
  ].join('-');

  const tasks: Promise<void>[] = [];

  if (force || (await needsSync('categories'))) {
    tasks.push(
      client.categories
        .getCategories(planId)
        .then((r) => writeCache('categories', r.data.category_groups)),
    );
  }

  if (force || (await needsSync('accounts'))) {
    tasks.push(
      client.accounts.getAccounts(planId).then((r) => writeCache('accounts', r.data.accounts)),
    );
  }

  if (force || (await needsSync('transactions'))) {
    tasks.push(
      client.transactions
        .getTransactions(planId, sinceDate)
        .then((r) => writeCache('transactions', r.data.transactions)),
    );
  }

  if (force || (await needsSync('month'))) {
    tasks.push(
      client.months.getPlanMonth(planId, 'current').then((r) => writeCache('month', r.data.month)),
    );
  }

  if (force || (await needsSync('scheduled'))) {
    tasks.push(
      client.scheduledTransactions
        .getScheduledTransactions(planId)
        .then((r) => writeCache('scheduled', r.data.scheduled_transactions)),
    );
  }

  const results = await Promise.allSettled(tasks);
  for (const result of results) {
    if (result.status === 'rejected' && isUnauthorized(result.reason)) {
      handleUnauthorized();
      return;
    }
  }

  // Resolve "default" plan ID to the real UUID (needed for YNAB deep links)
  if (planId === 'default') {
    try {
      const resp = await client.plans.getPlanById('default');
      setPlanId(resp.data.plan.id);
    } catch {
      // Non-critical — deep links will just not work until next sync
    }
  }
}

/** Convert YNAB milliunits to dollars */
export function milliToDollars(milliunits: number): number {
  return ynab.utils.convertMilliUnitsToCurrencyAmount(milliunits, 2);
}

/** Build the daily budget snapshot from cached YNAB data */
export async function getDailyBudgetSnapshot(): Promise<DailyBudgetSnapshot | null> {
  const categoryGroups = await readCache<ynab.CategoryGroupWithCategories[]>('categories');
  const transactions = await readCache<ynab.TransactionDetail[]>('transactions');
  const monthDetail = await readCache<ynab.MonthDetail>('month');
  const scheduledRaw = await readCache<ynab.ScheduledTransactionDetail[]>('scheduled');

  if (!categoryGroups || !transactions) return null;

  const today = todayISO();
  const overrides = getCategoryOverrides();

  // Flatten categories, skip internal/hidden groups
  const categories: CategoryBalance[] = [];
  const categoryInputs: CategoryInput[] = [];

  for (const group of categoryGroups) {
    if (group.hidden || group.name === 'Internal Master Category') continue;

    for (const cat of group.categories) {
      if (cat.hidden || cat.deleted) continue;
      const balance = milliToDollars(cat.balance);
      const budgeted = milliToDollars(cat.budgeted);
      const activity = Math.abs(milliToDollars(cat.activity));
      const goalSnoozed = cat.goal_snoozed_at != null;

      categories.push({
        id: cat.id,
        name: cat.name,
        groupName: group.name,
        balance,
        budgeted,
        activity,
      });

      // Resolve tier: override wins, then goal-derived, then undefined (excluded)
      const override = overrides[cat.id];
      let tier: CategoryInput['tier'];
      if (override) {
        tier = override === 'skip' ? undefined : override;
      } else {
        tier = deriveTierFromGoal({
          goalType: cat.goal_type ?? null,
          goalNeedsWholeAmount: cat.goal_needs_whole_amount ?? null,
        });
      }

      // Extract spending target from YNAB "Needed for Spending" (NEED) goals only.
      // Other goal types (MF, TB, TBD) are funding/savings goals, not spending pace.
      let weeklyTarget: number | undefined;
      let goalDisplay: CategoryInput['goalDisplay'];
      if (cat.goal_type === 'NEED' && cat.goal_target != null && cat.goal_target > 0) {
        const targetDollars = milliToDollars(cat.goal_target);
        if (cat.goal_cadence === 2) {
          weeklyTarget = targetDollars;
          goalDisplay = { amount: targetDollars, cadence: 'weekly' };
        } else if (cat.goal_cadence === 1 && cat.goal_cadence_frequency === 1) {
          weeklyTarget = (targetDollars * 12) / 52;
          goalDisplay = { amount: targetDollars, cadence: 'monthly' };
        }
      }

      categoryInputs.push({
        id: cat.id,
        name: cat.name,
        groupName: group.name,
        balance,
        budgeted,
        activity,
        tier,
        weeklyTarget,
        goalDisplay,
        goalSnoozed,
        goalUnderFunded:
          cat.goal_under_funded != null && cat.goal_under_funded > 0
            ? milliToDollars(cat.goal_under_funded)
            : undefined,
      });
    }
  }

  // Check if any category has a derived or overridden tier
  const hasTiers = categoryInputs.some((c) => c.tier != null);

  // Compute totalAvailable via budget-math
  let totalAvailable: number;
  if (hasTiers) {
    totalAvailable = computeTotalAvailable(categoryInputs);
  } else {
    // Legacy: all positive balances (no NEED goals and no overrides)
    totalAvailable = categories.reduce((sum, c) => sum + (c.balance > 0 ? c.balance : 0), 0);
  }

  // Today's spending
  const todayTxns = transactions.filter((t) => t.date === today && t.amount < 0);
  const spentToday = Math.abs(todayTxns.reduce((sum, t) => sum + t.amount, 0));
  const spentTodayDollars = milliToDollars(spentToday);

  const dailyAmount = computeDailyAmount(totalAvailable);
  const remainingToday = dailyAmount - spentTodayDollars;

  const snapshot: DailyBudgetSnapshot = {
    totalAvailable,
    daysRemaining: LOOKAHEAD_DAYS,
    dailyAmount,
    spentToday: spentTodayDollars,
    remainingToday,
    categoryBreakdown: categories,
    readyToAssign: monthDetail ? milliToDollars(monthDetail.to_be_budgeted) : null,
  };

  if (hasTiers) {
    snapshot.gate = buildNecessityGate(categoryInputs);

    // Convert transactions to budget-math input format
    const txnInputs = transactions.map((t) => ({
      date: t.date,
      amount: milliToDollars(t.amount),
      categoryName: t.category_name ?? 'Uncategorized',
      payeeName: t.payee_name ?? 'Unknown',
    }));
    // Convert scheduled transactions for bar fill computation
    const scheduledInputs: import('@/lib/budget-math').ScheduledTransactionInput[] = [];
    if (scheduledRaw) {
      for (const t of scheduledRaw) {
        if (t.category_name == null) continue; // skip transfers without category
        scheduledInputs.push({
          dateNext: t.date_next,
          amount: milliToDollars(t.amount),
          frequency: t.frequency,
          payeeName: t.payee_name ?? 'Unknown',
          categoryName: t.category_name,
          categoryId: t.category_id ?? undefined,
          transferAccountId: t.transfer_account_id ?? null,
          hitsChecking: true, // not relevant for bar computation
        });
      }
    }

    snapshot.flexibleBreakdown = computeFlexibleBreakdown(
      categoryInputs,
      txnInputs,
      dailyAmount,
      today,
      scheduledInputs,
    );
  }

  return snapshot;
}

/** Check if necessity categories are fully funded via goal_under_funded */
function buildNecessityGate(categoryInputs: CategoryInput[]): NecessityGateStatus {
  const underfundedNecessities: NecessityGateItem[] = categoryInputs
    .filter(
      (cat) =>
        cat.tier === 'necessity' &&
        !cat.goalSnoozed &&
        // Goal-based: underfunded per YNAB. Override-without-goal fallback: unbudgeted.
        ((cat.goalUnderFunded != null && cat.goalUnderFunded > 0) ||
          (cat.goalUnderFunded == null && cat.budgeted === 0)),
    )
    .map((cat) => ({
      id: cat.id,
      name: cat.name,
      groupName: cat.groupName,
      shortfall: cat.goalUnderFunded != null && cat.goalUnderFunded > 0 ? cat.goalUnderFunded : 0,
    }));

  const planId = getResolvedPlanId();
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  return {
    blocked: underfundedNecessities.length > 0,
    underfundedNecessities,
    ynabBudgetLink: planId ? `https://app.ynab.com/${planId}/budget/${month}` : null,
  };
}

/** Get recent transactions within the lookback window (MAX_LOOKBACK_DAYS) as summaries */
export async function getRecentTransactions(days = MAX_LOOKBACK_DAYS): Promise<TransactionSummary[]> {
  const transactions = await readCache<ynab.TransactionDetail[]>('transactions');
  if (!transactions) return [];

  const cutoff = new Date(todayISO() + 'T00:00:00');
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = [
    cutoff.getFullYear(),
    String(cutoff.getMonth() + 1).padStart(2, '0'),
    String(cutoff.getDate()).padStart(2, '0'),
  ].join('-');

  return transactions
    .filter((t) => t.date >= cutoffStr)
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((t) => ({
      payee: t.payee_name ?? 'Unknown',
      amount: milliToDollars(t.amount),
      category: t.category_name ?? 'Uncategorized',
      date: t.date,
    }));
}

/**
 * Get upcoming scheduled transactions, materializing recurring occurrences
 * within the given window.
 */
export async function getUpcomingScheduled(days = 7): Promise<TransactionSummary[]> {
  const scheduled = await readCache<ynab.ScheduledTransactionDetail[]>('scheduled');
  if (!scheduled) return [];

  const todayStr = todayISO();
  const cutoff = new Date(todayStr + 'T00:00:00');
  cutoff.setDate(cutoff.getDate() + days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const results: TransactionSummary[] = [];

  for (const t of scheduled) {
    const amount = milliToDollars(t.amount);
    const base = {
      payee: t.payee_name ?? 'Unknown',
      amount,
      category: t.category_name ?? 'Uncategorized',
    };

    const d = new Date(t.date_next + 'T00:00:00');

    while (d.toISOString().slice(0, 10) < todayStr && t.frequency !== 'never') {
      if (!advanceByYnabFrequency(d, t.frequency)) break;
    }

    if (t.frequency === 'never') {
      const dateStr = t.date_next;
      if (dateStr >= todayStr && dateStr <= cutoffStr) {
        results.push({ ...base, date: dateStr });
      }
    } else {
      let dateStr = d.toISOString().slice(0, 10);
      while (dateStr <= cutoffStr) {
        if (dateStr >= todayStr) {
          results.push({ ...base, date: dateStr });
        }
        if (!advanceByYnabFrequency(d, t.frequency)) break;
        dateStr = d.toISOString().slice(0, 10);
      }
    }
  }

  results.sort((a, b) => a.date.localeCompare(b.date));
  return results;
}
