# Check Yo Self — Claude Context

## Universal Guidance

@.toolbox/ai-context/CLAUDE.md

> _[View shared context](.toolbox/ai-context/CLAUDE.md) — git, testing, PR workflows_

---

## Project Context

Daily budgeting PWA for a single user (Anthony). Standalone app on `apps.samm-the.dev/check-yo-self`. Not an ohm companion — no shared-origin DB writes.

### Stack

- React 19 + TypeScript (strict) + Vite
- Tailwind CSS v3 with CSS variable theming + shadcn/ui (new-york style)
- Dexie (IndexedDB) for persistence + dexie-react-hooks for reactive queries
- schema-dts (devDependency) for compile-time schema.org type validation
- vite-plugin-pwa for installable PWA
- sonner for toasts
- lucide-react for icons

### Architecture

- `src/types/` — Data model types. Budget types, cashflow types, YNAB cache schema.
- `src/db/` — Dexie database definition. Single database `check-yo-self` with YNAB cache table.
- `src/lib/budget-math.ts` — **Canonical math module.** All budget and cashflow computation lives here as pure functions, fully tested, no side effects. See `budget-math.test.ts`.
- `src/services/ynab.ts` — YNAB OAuth, API sync, cache management. Thin layer that fetches data and delegates computation to `budget-math.ts`.
- `src/services/cashflow.ts` — Cashflow snapshot assembly. Fetches from cache, delegates projection to `budget-math.ts`.
- `src/hooks/` — React hooks. `useDailyBudget` drives the dashboard.
- `src/pages/` — Route-level page components (DashboardPage, TransactionsPage, BillsPage, SettingsPage).
- `src/components/` — Shared UI. `Layout.tsx` is the app shell with bottom tab nav. `CategoryBreakdown.tsx` uses pace/coverage math from `budget-math.ts`.

### Conventions

- GUIDs everywhere (`crypto.randomUUID()`) — same as ohm.
- ISO dates as strings (`YYYY-MM-DD`) for Dexie indexing — same as ohm.
- ISO timestamps for event recording (`new Date().toISOString()`).
- `DailyBudget` is computed, not stored — derived fresh on each render.
- Dark mode default, class-based toggle via `useTheme` hook.

### Phases

- **Phase 1 (live):** YNAB OAuth, daily budget from category balances, category tiers (necessity/flexible), flexible breakdown with weekly pace, overspend detection with move-money recommendations, cashflow chart with 14-day lookback + 14-day lookahead, scheduled transaction materialization.
- **Phase 2 (parked on `feature/coaching`):** AI coaching — spending pattern detection, morning/evening check-in ritual, personalized budget insights.
- **Phase 3 (planned):** Spending trends, streak tracking, polish.
  - TODO: Optional "show credit balance" toggle on cashflow chart — opt in to offset the committed line by outstanding CC balance. Off by default (chart focuses on checking cashflow, not debt position). Useful for users who want visibility into how CC debt affects effective cash.

### Testing

Follow toolbox testing conventions. Priority:

1. `budget-math.ts` computation logic — pure functions, fully tested in `budget-math.test.ts`
2. Scheduled transaction materialization via `advanceByYnabFrequency`
3. Cashflow projection (past reconstruction + future drawdown)
