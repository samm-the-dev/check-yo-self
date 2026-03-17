# Check Yo Self — Data Model (v2)

> Claude-powered daily budget coaching on top of YNAB. Standalone PWA on `apps.samm-the.dev/check-yo-self`. YNAB is the system of record for all financial data. Check Yo Self reads from it and wraps a morning/evening coaching ritual around it.

---

## Architecture

```
┌─────────────────────────────────────────┐
│  YNAB (system of record)                │
│  accounts · categories · transactions   │
│  scheduled transactions · month budgets │
└──────────────┬──────────────────────────┘
               │ YNAB JS SDK (ynab@4.x)
               │ Personal Access Token
               │ Poll on app open (rate-limited)
               ▼
┌─────────────────────────────────────────┐
│  Check Yo Self                          │
│                                         │
│  ┌─────────────┐   ┌────────────────┐  │
│  │ YNAB Cache   │   │ CheckIn Store  │  │
│  │ (IndexedDB)  │   │ (IndexedDB)    │  │
│  │              │   │                │  │
│  │ categories   │   │ id             │  │
│  │ accounts     │   │ date           │  │
│  │ transactions │   │ type           │  │
│  │ lastSyncAt   │   │ timestamp      │  │
│  └──────┬───────┘   │ note           │  │
│         │           └────────────────┘  │
│         ▼                               │
│  ┌─────────────────────────────────┐    │
│  │ Daily Budget Computation        │    │
│  │ (derived at render time)        │    │
│  └──────┬──────────────────────────┘    │
│         │                               │
│         ▼                               │
│  ┌─────────────────────────────────┐    │
│  │ Claude Coaching API             │    │
│  │ (Anthropic Messages API)        │    │
│  │                                 │    │
│  │ Input: budget snapshot +        │    │
│  │   recent transactions +         │    │
│  │   category balances +           │    │
│  │   check-in history              │    │
│  │                                 │    │
│  │ Output: personalized insight    │    │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
```

---

## What Check Yo Self Stores (Dexie)

Only two concerns live in local IndexedDB:

### 1. YNAB Cache

Cached responses from the YNAB API to avoid hitting rate limits on every render. Refreshed on app open, debounced to 15 minutes (same pattern as ohm's external connectors).

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

### 2. Check-Ins

The ritual log. Minimal — just records that Anthony opened the app and did his check-in.

```typescript
type CheckInType = 'morning' | 'evening';

interface CheckIn {
  /** GUID */
  id: string;
  /** ISO date */
  date: string;
  type: CheckInType;
  /** ISO timestamp */
  timestamp: string;
  /** Free-text note */
  note?: string;
}
```

### Dexie Schema

```typescript
import Dexie, { type EntityTable } from 'dexie';

const db = new Dexie('check-yo-self') as Dexie & {
  cache: EntityTable<YnabCache, 'key'>;
  checkIns: EntityTable<CheckIn, 'id'>;
};

db.version(1).stores({
  cache: 'key',
  checkIns: 'id, date, type',
});

export { db };
```

That's it. No incomes, no bills, no transactions tables. YNAB owns all of that.

---

## What Check Yo Self Reads from YNAB

The YNAB JS SDK (`ynab@4.x`) provides typed access to everything we need. Key calls on app open:

| SDK Call                                                  | What It Returns                   | What We Use It For                             |
| --------------------------------------------------------- | --------------------------------- | ---------------------------------------------- |
| `categories.getCategories(planId)`                        | All category groups with balances | "Available to spend" per category              |
| `months.getPlanMonth(planId, 'current')`                  | Current month budget summary      | Total available, total budgeted, age of money  |
| `transactions.getTransactions(planId, { sinceDate })`     | Recent transactions               | Today's spending, recent patterns for coaching |
| `accounts.getAccounts(planId)`                            | Account balances                  | Total cash on hand                             |
| `scheduled_transactions.getScheduledTransactions(planId)` | Upcoming scheduled transactions   | Bills coming up                                |

### Sync Strategy

Same pattern as the ohm ecosystem connectors:

- **On app open:** Check `lastSyncAt` for each cache key. If older than 15 minutes, re-fetch.
- **"Refresh" button:** Force re-fetch all keys, ignoring debounce.
- **Rate limit handling:** YNAB returns 429 if rate limited. Catch and show "try again in a moment" — don't retry automatically.
- **Milliunits:** YNAB stores amounts in milliunits (1000 = $1.00). Use `ynab.utils.convertMilliUnitsToCurrencyAmount()` for display.

---

## Daily Budget Computation (Derived)

No longer our own math — we lean on YNAB's category balances, which already account for income, budgeted amounts, and spending.

```typescript
interface DailyBudgetSnapshot {
  /** Total available across all spending categories (from YNAB month summary) */
  totalAvailable: number;
  /** Days remaining in the month */
  daysRemaining: number;
  /** Simple daily: totalAvailable / daysRemaining */
  dailyAmount: number;
  /** What Anthony spent today (sum of today's transactions) */
  spentToday: number;
  /** dailyAmount - spentToday */
  remainingToday: number;
  /** Category-level breakdown for coaching context */
  categoryBreakdown: CategoryBalance[];
}

interface CategoryBalance {
  name: string;
  groupName: string;
  /** Available balance in this category */
  balance: number;
  /** Budgeted this month */
  budgeted: number;
  /** Spent this month (activity) */
  activity: number;
}
```

The simplicity here is the point. YNAB does the hard budgeting math. Check Yo Self just divides the available amount by remaining days and wraps a coaching experience around it.

---

## Claude Coaching Layer

The coaching call sends a structured snapshot to the Anthropic Messages API and gets back a personalized insight.

### Coaching Prompt Structure

```typescript
interface CoachingContext {
  /** 'morning' or 'evening' */
  checkInType: CheckInType;
  /** The daily budget snapshot */
  budget: DailyBudgetSnapshot;
  /** Today's transactions (for evening review) */
  todayTransactions: { payee: string; amount: number; category: string }[];
  /** This week's spending by category (for pattern detection) */
  weeklySpending: { category: string; total: number; budgeted: number }[];
  /** Upcoming scheduled transactions in the next 7 days */
  upcomingBills: { payee: string; amount: number; date: string }[];
  /** Recent check-in notes (last 3) for continuity */
  recentNotes: string[];
}
```

### Morning vs Evening

**Morning:** "Here's what your day looks like. You have $X available today. Rent hits in 3 days. Your Dining Out category is running low — maybe pack lunch."

**Evening:** "You spent $X today across N transactions. That $14 at Whataburger came out of Dining Out which has $28 left for the rest of the month. Solid day overall."

### Implementation

- Call goes to Anthropic Messages API (not the in-artifact API — this is a server-side-style call proxied or made directly with the user's own API key)
- System prompt establishes the coaching persona: friendly, direct, not preachy
- Context window is small — just the structured snapshot, not raw YNAB data dumps
- Response is short — 2-4 sentences max
- Cache the coaching response for the current check-in (don't re-call on every render)

---

## Token Storage

| Token                      | Storage                                                                             | Notes                                                              |
| -------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| YNAB Personal Access Token | localStorage (encrypted at rest via user password, or plaintext with clear warning) | Single-user app. Token doesn't expire but can be revoked.          |
| Anthropic API Key          | localStorage (same treatment)                                                       | For Claude coaching calls.                                         |
| Google OAuth token         | Shared origin storage on `apps.samm-the.dev`                                        | For Calendar check-in reminders. Shared with other ecosystem apps. |

**Security note:** Storing API tokens in localStorage in a PWA is acceptable for a single-user personal tool. The YNAB token is read-only by default (no write scopes needed). If this ever becomes multi-user, tokens move server-side.

---

## Notification Strategy

Unchanged from earlier — Calendar-as-notification-bus pattern from the ohm ecosystem:

- On setup, create recurring Google Calendar tasks for morning + evening check-in times
- Calendar handles notification delivery
- Tapping opens Check Yo Self, which renders the coaching check-in
- Uses shared Google Auth on `apps.samm-the.dev`

---

## Phase Plan

| Phase                   | Scope                                                                                                                       | Dependency                                       |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| **Phase 1 — Dashboard** | YNAB connection, daily budget view, category balances, recent transactions. No coaching yet — just the numbers.             | Anthony has YNAB account + Personal Access Token |
| **Phase 2 — Coaching**  | Claude API integration, morning/evening check-in ritual, personalized insights, check-in history. Calendar notifications.   | Anthropic API key                                |
| **Phase 3 — Polish**    | Spending trends over time, streak tracking for check-in consistency, coaching tone preferences, potential ecosystem wiring. | —                                                |

Each phase is independently useful. Phase 1 alone gives Anthony a cleaner daily-budget view than YNAB's own UI provides.

---

## What We Removed

The v1 data model had five Dexie tables and a full budgeting engine. With YNAB as the source of truth, we dropped:

- ~~`incomes` table~~ — YNAB tracks income
- ~~`bills` / `billInstances` tables~~ — YNAB has scheduled transactions
- ~~`transactions` table~~ — YNAB is the system of record
- ~~`StoredSchedule` / `ActionStatusType` alignment~~ — no longer managing recurrence ourselves
- ~~`DailyBudget` computation from raw income/bills/transactions~~ — replaced by reading YNAB category balances

What survived: `checkIns` (the ritual log) and a cache layer. Everything else comes from the YNAB API.
