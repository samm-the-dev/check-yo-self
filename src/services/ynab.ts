import * as ynab from 'ynab';
import { db } from '@/db';
import { SYNC_DEBOUNCE_MS } from '@/types/ynab-cache';
import type { DailyBudgetSnapshot, CategoryBalance, TransactionSummary } from '@/types/budget';
import { todayISO } from '@/lib/utils';

const TOKEN_KEY = 'cys-ynab-token';
const PLAN_KEY = 'cys-ynab-plan-id';

/** Get or set the YNAB Personal Access Token */
export function getYnabToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setYnabToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearYnabToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/** Get or set the selected budget (plan) ID */
export function getPlanId(): string | null {
  return localStorage.getItem(PLAN_KEY);
}

export function setPlanId(id: string): void {
  localStorage.setItem(PLAN_KEY, id);
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

/** Fetch the user's budgets (plans) for initial setup */
export async function fetchPlans(): Promise<{ id: string; name: string }[]> {
  const client = getClient();
  if (!client) return [];
  const response = await client.plans.getPlans();
  return response.data.plans.map((p) => ({ id: p.id, name: p.name }));
}

/** Sync all YNAB data needed for the dashboard. Respects debounce unless force=true. */
export async function syncYnabData(force = false): Promise<void> {
  const client = getClient();
  const planId = getPlanId();
  if (!client || !planId) return;

  const today = todayISO();
  // Sync transactions for the current month
  const monthStart = today.slice(0, 8) + '01';

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
        .getTransactions(planId, monthStart)
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

  await Promise.allSettled(tasks);
}

/** Convert YNAB milliunits to dollars */
function milliToDollars(milliunits: number): number {
  return ynab.utils.convertMilliUnitsToCurrencyAmount(milliunits, 2);
}

/** Build the daily budget snapshot from cached YNAB data */
export async function getDailyBudgetSnapshot(): Promise<DailyBudgetSnapshot | null> {
  const categoryGroups = await readCache<ynab.CategoryGroupWithCategories[]>('categories');
  const transactions = await readCache<ynab.TransactionDetail[]>('transactions');

  if (!categoryGroups || !transactions) return null;

  const today = todayISO();
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysRemaining = Math.max(1, daysInMonth - now.getDate() + 1);

  // Flatten categories, skip internal/hidden groups
  const categories: CategoryBalance[] = [];
  let totalAvailable = 0;

  for (const group of categoryGroups) {
    // Skip internal YNAB groups (credit card payments, hidden, etc.)
    if (group.hidden || group.name === 'Internal Master Category') continue;

    for (const cat of group.categories) {
      if (cat.hidden || cat.deleted) continue;
      const balance = milliToDollars(cat.balance);
      const budgeted = milliToDollars(cat.budgeted);
      const activity = Math.abs(milliToDollars(cat.activity));

      categories.push({
        name: cat.name,
        groupName: group.name,
        balance,
        budgeted,
        activity,
      });

      // Only count positive balances toward available spending
      if (balance > 0) totalAvailable += balance;
    }
  }

  // Today's spending
  const todayTxns = transactions.filter((t) => t.date === today && t.amount < 0);
  const spentToday = Math.abs(todayTxns.reduce((sum, t) => sum + t.amount, 0));
  const spentTodayDollars = milliToDollars(spentToday);

  const dailyAmount = totalAvailable / daysRemaining;
  const remainingToday = dailyAmount - spentTodayDollars;

  return {
    totalAvailable,
    daysRemaining,
    dailyAmount,
    spentToday: spentTodayDollars,
    remainingToday,
    categoryBreakdown: categories,
  };
}

/** Get today's transactions as summaries for coaching */
export async function getTodayTransactions(): Promise<TransactionSummary[]> {
  const transactions = await readCache<ynab.TransactionDetail[]>('transactions');
  if (!transactions) return [];

  const today = todayISO();
  return transactions
    .filter((t) => t.date === today)
    .map((t) => ({
      payee: t.payee_name ?? 'Unknown',
      amount: Math.abs(milliToDollars(t.amount)),
      category: t.category_name ?? 'Uncategorized',
      date: t.date,
    }));
}

/** Get upcoming scheduled transactions in the next N days */
export async function getUpcomingScheduled(days = 7): Promise<TransactionSummary[]> {
  const scheduled = await readCache<ynab.ScheduledTransactionDetail[]>('scheduled');
  if (!scheduled) return [];

  const today = new Date(todayISO() + 'T00:00:00');
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() + days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const todayStr = todayISO();

  return scheduled
    .filter((t) => t.date_next >= todayStr && t.date_next <= cutoffStr)
    .map((t) => ({
      payee: t.payee_name ?? 'Unknown',
      amount: Math.abs(milliToDollars(t.amount)),
      category: t.category_name ?? 'Uncategorized',
      date: t.date_next,
    }));
}
