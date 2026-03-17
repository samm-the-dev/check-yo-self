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

/** Seed localStorage and IndexedDB so the app thinks YNAB is connected */
async function seedAppState(page: import('@playwright/test').Page, { withTiers = false } = {}) {
  await page.goto('/');

  // Seed localStorage
  await page.evaluate(
    ({ tiers, withTiers }) => {
      localStorage.setItem('cys-ynab-token', 'fake-token');
      localStorage.setItem('cys-ynab-plan-id', 'fake-plan-id');
      if (withTiers) {
        localStorage.setItem('cys-category-tiers', JSON.stringify(tiers));
      }
    },
    { tiers: MOCK_TIERS, withTiers },
  );

  // Seed IndexedDB cache
  await page.evaluate((categories) => {
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
  }, MOCK_CATEGORIES);

  // Reload so the app picks up seeded state
  await page.reload();
  await page.waitForLoadState('networkidle');
}

test('settings - category tiers', async ({ page }) => {
  await seedAppState(page, { withTiers: true });
  await page.goto('/settings');
  await page.waitForLoadState('networkidle');
  // Wait for categories to render
  await page.waitForSelector('text=Category Tiers');
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
