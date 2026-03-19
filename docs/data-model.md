# Check Yo Self — Data Model (v2)

> YNAB-powered cashflow and daily budget tool. Standalone PWA on `apps.samm-the.dev/check-yo-self`. YNAB is the system of record for all financial data. Check Yo Self reads from it and provides a daily budget view, category-tier analysis, and cashflow projection.

---

## Architecture

```
┌─────────────────────────────────────────┐
│  YNAB (system of record)                │
│  accounts · categories · transactions   │
│  scheduled transactions · month budgets │
└──────────────┬──────────────────────────┘
               │ YNAB JS SDK (ynab@4.x)
               │ OAuth Implicit Grant
               │ Poll on app open (rate-limited)
               ▼
┌─────────────────────────────────────────┐
│  Check Yo Self                          │
│                                         │
│  ┌─────────────┐                        │
│  │ YNAB Cache   │                       │
│  │ (IndexedDB)  │                       │
│  │              │                       │
│  │ categories   │                       │
│  │ accounts     │                       │
│  │ transactions │                       │
│  │ scheduled    │                       │
│  │ month        │                       │
│  │ lastSyncAt   │                       │
│  └──────┬───────┘                       │
│         │                               │
│         ▼                               │
│  ┌─────────────────────────────────┐    │
│  │ budget-math.ts                  │    │
│  │ (pure functions, fully tested)  │    │
│  │                                 │    │
│  │ Daily budget · Category tiers   │    │
│  │ Flexible breakdown · Pace       │    │
│  │ Cashflow projection             │    │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
```

---

## What Check Yo Self Stores (Dexie)

### 1. YNAB Cache

Cached responses from the YNAB API to avoid hitting rate limits on every render. Refreshed on app open, debounced to 15 minutes.

```typescript
interface YnabCache {
  /** Cache key: 'categories' | 'accounts' | 'transactions' | 'month' | 'scheduled' */
  key: string;
  /** JSON-serialized YNAB API response */
  data: string;
  /** ISO timestamp of last successful fetch */
  lastSyncAt: string;
}
```

### Dexie Schema

```typescript
import Dexie, { type EntityTable } from 'dexie';

const db = new Dexie('check-yo-self') as Dexie & {
  cache: EntityTable<YnabCache, 'key'>;
};

// v1–v3 had checkIns and coachingMessages tables; v4 drops them.
db.version(4).stores({
  cache: 'key',
  checkIns: null,
  coachingMessages: null,
});

export { db };
```

---

## What Check Yo Self Reads from YNAB

The YNAB JS SDK (`ynab@4.x`) provides typed access to everything we need. Key calls on app open:

| SDK Call                                                  | What It Returns                   | What We Use It For                            |
| --------------------------------------------------------- | --------------------------------- | --------------------------------------------- |
| `categories.getCategories(planId)`                        | All category groups with balances | "Available to spend" per category             |
| `months.getPlanMonth(planId, 'current')`                  | Current month budget summary      | Total available, total budgeted, age of money |
| `transactions.getTransactions(planId, { sinceDate })`     | Recent transactions               | Today's spending, recent patterns             |
| `accounts.getAccounts(planId)`                            | Account balances                  | Checking balance for cashflow anchor          |
| `scheduled_transactions.getScheduledTransactions(planId)` | Upcoming scheduled transactions   | Bills and income for cashflow projection      |

### Sync Strategy

- **On app open:** Check `lastSyncAt` for each cache key. If older than 15 minutes, re-fetch.
- **"Refresh" button:** Force re-fetch all keys, ignoring debounce.
- **Rate limit handling:** YNAB returns 429 if rate limited. Catch and show "try again in a moment" — don't retry automatically.
- **Milliunits:** YNAB stores amounts in milliunits (1000 = $1.00). Use `ynab.utils.convertMilliUnitsToCurrencyAmount()` for display.

---

## Budget Math (`src/lib/budget-math.ts`)

All budget computation lives in `budget-math.ts` as pure functions — no React, no Dexie, no YNAB SDK. Fully tested in `budget-math.test.ts`.

### Mental Model

- YNAB owns all category balances. CYS never does its own budgeting math.
- `totalAvailable` = sum of flexible category balances > 0 (necessities excluded).
- `dailyAmount` = `totalAvailable / daysRemaining` (including today).
- `weeklyAmount` = `dailyAmount * 7` (same rate, expressed per-week).
- Cashflow projection anchors on today's checking balance. Past days are reconstructed from actual transactions. Future days subtract spending velocity (14-day rolling avg of actual flex outflows, falling back to `dailyAmount` when no data exists) and apply scheduled transactions (income +, bills −).
- CC payment transfers are included in cashflow — they represent real checking outflows.
- The 14-day lookahead continues the spending velocity past month-end as a best estimate.

### Key Functions

| Function                   | Purpose                                        |
| -------------------------- | ---------------------------------------------- |
| `computeDaysRemaining`     | Days left in month including today (floor 1)   |
| `computeDailyAmount`       | `totalAvailable / daysRemaining`               |
| `computeTotalAvailable`    | Sum flexible categories with positive balance  |
| `computeFlexibleBreakdown` | Per-category daily/weekly amounts, spending    |
| `computePaceOverspend`     | Spending vs expected pace over lookback window |
| `computeCoverageDays`      | How long a balance lasts at current spend rate |
| `buildCashflowProjection`  | Past + today + future balance walk             |
| `advanceByYnabFrequency`   | Date advancement for all YNAB recurrence types |

---

## Token Storage

| Token             | Storage      | Notes                                             |
| ----------------- | ------------ | ------------------------------------------------- |
| YNAB OAuth Token  | localStorage | Implicit grant. Read-only scope. Single-user app. |
| Category Tier Map | localStorage | User-configured necessity/flexible assignments.   |

**Security note:** Storing tokens in localStorage in a PWA is acceptable for a single-user personal tool. The YNAB token is read-only by default.

---

## Phase Plan

| Phase                   | Scope                                                                                                                        | Status                       |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| **Phase 1 — Dashboard** | YNAB OAuth, daily budget, category tiers, flexible breakdown, cashflow chart, overspend analysis, move-money recommendations | Live                         |
| **Phase 2 — Coaching**  | AI coaching, morning/evening check-in ritual, personalized insights                                                          | Parked on `feature/coaching` |
| **Phase 3 — Polish**    | Spending trends, streak tracking, ecosystem wiring                                                                           | Planned                      |

---

## Future: Coaching

AI coaching is planned but not yet implemented on main. The feature lives on the `feature/coaching` branch and includes:

- Claude/Gemini API integration for personalized spending insights
- Morning/evening check-in ritual with structured budget context
- Check-in history stored in the `checkIns` Dexie table
- Coaching messages stored in a `coachingMessages` table

This will be merged when ready for Phase 2, re-adding the `checkIns` and `coachingMessages` tables.

---

## What We Removed (from v1)

The v1 data model had five Dexie tables and a full budgeting engine. With YNAB as the source of truth, we dropped:

- ~~`incomes` table~~ — YNAB tracks income
- ~~`bills` / `billInstances` tables~~ — YNAB has scheduled transactions
- ~~`transactions` table~~ — YNAB is the system of record
- ~~`StoredSchedule` / `ActionStatusType` alignment~~ — no longer managing recurrence ourselves
- ~~`DailyBudget` computation from raw income/bills/transactions~~ — replaced by reading YNAB category balances
- ~~`checkIns` / `coachingMessages` tables~~ — moved to `feature/coaching` branch

What survived: a YNAB cache layer. Everything else comes from the YNAB API.
