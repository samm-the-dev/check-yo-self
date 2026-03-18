import { test } from '@playwright/test';

// Sample YNAB category data matching the SDK's CategoryGroupWithCategories shape
const MOCK_CATEGORIES = [
  {
    id: 'group-bills',
    name: 'Bills',
    hidden: false,
    deleted: false,
    categories: [
      {
        id: 'cat-1',
        name: 'Installment Loans',
        hidden: false,
        deleted: false,
        balance: -50000,
        budgeted: 100000,
        activity: -150000,
      },
      {
        id: 'cat-2',
        name: 'Mortgage',
        hidden: false,
        deleted: false,
        balance: -200000,
        budgeted: 1500000,
        activity: -1700000,
      },
      {
        id: 'cat-3',
        name: 'Utilities',
        hidden: false,
        deleted: false,
        balance: -30000,
        budgeted: 200000,
        activity: -230000,
      },
      {
        id: 'cat-4',
        name: 'TV, phone and internet',
        hidden: false,
        deleted: false,
        balance: -10000,
        budgeted: 150000,
        activity: -160000,
      },
    ],
  },
  {
    id: 'group-spending',
    name: 'Everyday Spending',
    hidden: false,
    deleted: false,
    categories: [
      {
        id: 'cat-5',
        name: 'Groceries',
        hidden: false,
        deleted: false,
        balance: 250000,
        budgeted: 400000,
        activity: -150000,
      },
      {
        id: 'cat-6',
        name: 'Dining Out',
        hidden: false,
        deleted: false,
        balance: 80000,
        budgeted: 150000,
        activity: -70000,
      },
      {
        id: 'cat-7',
        name: 'Fun Money',
        hidden: false,
        deleted: false,
        balance: 50000,
        budgeted: 100000,
        activity: -50000,
      },
      {
        id: 'cat-8',
        name: 'Transportation',
        hidden: false,
        deleted: false,
        balance: 120000,
        budgeted: 200000,
        activity: -80000,
      },
    ],
  },
  {
    id: 'group-savings',
    name: 'Savings Goals',
    hidden: false,
    deleted: false,
    categories: [
      {
        id: 'cat-9',
        name: 'Emergency Fund',
        hidden: false,
        deleted: false,
        balance: 500000,
        budgeted: 500000,
        activity: 0,
      },
      {
        id: 'cat-10',
        name: 'Vacation',
        hidden: false,
        deleted: false,
        balance: 200000,
        budgeted: 200000,
        activity: 0,
      },
    ],
  },
];

const MOCK_TIERS = {
  'cat-1': 'necessity',
  'cat-2': 'necessity',
  'cat-3': 'necessity',
  'cat-4': 'necessity',
  'cat-5': 'flexible',
  'cat-6': 'flexible',
  'cat-7': 'flexible',
  'cat-8': 'flexible',
};

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

const MOCK_ACCOUNTS = [
  {
    id: 'acc-1',
    name: 'Checking',
    type: 'checking',
    closed: false,
    deleted: false,
    balance: 2500000,
  },
];

const MOCK_SCHEDULED = [
  {
    id: 'st-1',
    date_first: '2026-01-15',
    date_next: daysFromNow(3),
    frequency: 'monthly',
    amount: -125000,
    payee_name: 'Electric Co',
    category_name: 'Utilities',
    deleted: false,
  },
  {
    id: 'st-2',
    date_first: '2026-01-01',
    date_next: daysFromNow(5),
    frequency: 'monthly',
    amount: -50000,
    payee_name: 'Internet',
    category_name: 'Utilities',
    deleted: false,
  },
  {
    id: 'st-3',
    date_first: '2026-01-01',
    date_next: daysFromNow(8),
    frequency: 'monthly',
    amount: -1500000,
    payee_name: 'Mortgage',
    category_name: 'Mortgage',
    deleted: false,
  },
];

const MOCK_TRANSACTIONS = [
  {
    id: 'tx-1',
    date: daysAgo(0),
    amount: -15000,
    payee_name: 'Coffee Shop',
    category_name: 'Dining Out',
    cleared: 'cleared',
    approved: true,
    deleted: false,
    account_id: 'acc-1',
    subtransactions: [],
  },
  {
    id: 'tx-2',
    date: daysAgo(0),
    amount: -45000,
    payee_name: 'Gas Station',
    category_name: 'Transportation',
    cleared: 'cleared',
    approved: true,
    deleted: false,
    account_id: 'acc-1',
    subtransactions: [],
  },
  {
    id: 'tx-3',
    date: daysAgo(1),
    amount: -82000,
    payee_name: 'Grocery Store',
    category_name: 'Groceries',
    cleared: 'cleared',
    approved: true,
    deleted: false,
    account_id: 'acc-1',
    subtransactions: [],
  },
  {
    id: 'tx-4',
    date: daysAgo(2),
    amount: -23000,
    payee_name: 'Lunch Spot',
    category_name: 'Dining Out',
    cleared: 'cleared',
    approved: true,
    deleted: false,
    account_id: 'acc-1',
    subtransactions: [],
  },
  {
    id: 'tx-5',
    date: daysAgo(4),
    amount: -35000,
    payee_name: 'Pharmacy',
    category_name: 'Groceries',
    cleared: 'cleared',
    approved: true,
    deleted: false,
    account_id: 'acc-1',
    subtransactions: [],
  },
  {
    id: 'tx-6',
    date: daysAgo(6),
    amount: 3200000,
    payee_name: 'Employer Direct Deposit',
    category_name: 'Ready to Assign',
    cleared: 'cleared',
    approved: true,
    deleted: false,
    account_id: 'acc-1',
    subtransactions: [],
  },
];

/** Seed localStorage and IndexedDB so the app thinks YNAB is connected */
async function seedAppState(
  page: import('@playwright/test').Page,
  { withTiers = false, withCoaching = false } = {},
) {
  await page.goto('/');

  // Seed localStorage
  await page.evaluate(
    ({ tiers, withTiers, withCoaching }) => {
      localStorage.setItem('cys-ynab-token', 'fake-token');
      localStorage.setItem('cys-ynab-plan-id', 'fake-plan-id');
      if (withTiers) {
        localStorage.setItem('cys-category-tiers', JSON.stringify(tiers));
      }
      if (withCoaching) {
        localStorage.setItem('cys-gemini-key', 'AIza-fake-key');
        localStorage.setItem('cys-coach-provider', 'gemini');
      }
    },
    { tiers: MOCK_TIERS, withTiers, withCoaching },
  );

  // Seed IndexedDB cache
  await page.evaluate(
    ({ categories, transactions, accounts, scheduled }) => {
      return new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('check-yo-self', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('cache')) {
            db.createObjectStore('cache', { keyPath: 'key' });
          }
          if (!db.objectStoreNames.contains('checkIns')) {
            db.createObjectStore('checkIns', { keyPath: 'id' });
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('cache', 'readwrite');
          const store = tx.objectStore('cache');
          const now = new Date().toISOString();
          store.put({ key: 'categories', data: JSON.stringify(categories), lastSyncAt: now });
          store.put({ key: 'transactions', data: JSON.stringify(transactions), lastSyncAt: now });
          store.put({ key: 'accounts', data: JSON.stringify(accounts), lastSyncAt: now });
          store.put({ key: 'scheduled', data: JSON.stringify(scheduled), lastSyncAt: now });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });
    },
    {
      categories: MOCK_CATEGORIES,
      transactions: MOCK_TRANSACTIONS,
      accounts: MOCK_ACCOUNTS,
      scheduled: MOCK_SCHEDULED,
    },
  );

  // Reload so the app picks up seeded state
  await page.reload();
  await page.waitForLoadState('networkidle');
}

test('settings - category tiers', async ({ page }) => {
  await seedAppState(page, { withTiers: true });
  await page.goto('/settings');
  await page.waitForLoadState('networkidle');
  // Wait for categories to render and expand
  await page.waitForSelector('text=Category Tiers');
  await page.getByText('Category Tiers').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'e2e/screenshots/settings-tiers.png', fullPage: true });
});

test('dashboard - budget gate', async ({ page }) => {
  // Seed with unbudgeted necessities to trigger the gate
  await page.goto('/');
  await page.evaluate(
    ({ tiers }) => {
      localStorage.setItem('cys-ynab-token', 'fake-token');
      localStorage.setItem('cys-ynab-plan-id', 'fake-plan-id');
      localStorage.setItem('cys-category-tiers', JSON.stringify(tiers));
    },
    { tiers: MOCK_TIERS },
  );

  // Seed categories with some necessities having budgeted: 0
  const unbudgetedCategories = JSON.parse(JSON.stringify(MOCK_CATEGORIES));
  unbudgetedCategories[0].categories[2].budgeted = 0; // Utilities
  unbudgetedCategories[0].categories[3].budgeted = 0; // TV, phone and internet

  await page.evaluate((categories) => {
    return new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('check-yo-self', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('cache'))
          db.createObjectStore('cache', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('checkIns'))
          db.createObjectStore('checkIns', { keyPath: 'id' });
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('cache', 'readwrite');
        const store = tx.objectStore('cache');
        store.put({
          key: 'categories',
          data: JSON.stringify(categories),
          lastSyncAt: new Date().toISOString(),
        });
        store.put({
          key: 'transactions',
          data: JSON.stringify([]),
          lastSyncAt: new Date().toISOString(),
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  }, unbudgetedCategories);

  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'e2e/screenshots/dashboard-gate.png', fullPage: true });
});

test('dashboard - with budget', async ({ page }) => {
  await seedAppState(page, { withTiers: true });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'e2e/screenshots/dashboard-budget.png', fullPage: true });
});

test('dashboard - no tiers nudge', async ({ page }) => {
  await seedAppState(page, { withTiers: false });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'e2e/screenshots/dashboard-nudge.png', fullPage: true });
});

test('dashboard - coaching check-in (no key)', async ({ page }) => {
  await seedAppState(page, { withTiers: true });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'e2e/screenshots/dashboard-coaching-nokey.png', fullPage: true });
});

test('dashboard - coaching check-in (with key)', async ({ page }) => {
  await seedAppState(page, { withTiers: true, withCoaching: true });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'e2e/screenshots/dashboard-coaching-ready.png', fullPage: true });
});

test('settings - coaching section', async ({ page }) => {
  await seedAppState(page, { withTiers: true, withCoaching: true });
  await page.goto('/settings');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'e2e/screenshots/settings-coaching.png', fullPage: true });
});
