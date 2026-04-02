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

### Category Bar Model

Two bar types, both anchored left with the same `green → yellow → red` color semantics:

- **Goal bars** (weekly/monthly): Fill starts at 0% and _increases_ left-to-right with spending. Gradient is `green → yellow → red` in the fill direction — more fill = more consumed = warmer colors. Today marker at 50%. Spending impact decays linearly over the goal period (`impact = amount * (periodDays - daysSince) / periodDays`).
- **No-goal (depletion) bars**: Fill starts at 100% and _decreases_ (shrinks from right) with spending. Gradient is _flipped_ to `red → yellow → green` so the remaining fill is always green and the exposed track on the right is red. No today marker. `fill` is a remaining ratio (1 = full, 0 = empty).

The gradient is flipped for no-goal bars because the change direction is opposite: goal bars grow with spending (green→red), depletion bars shrink with spending (need the remaining portion to stay green).

Scheduled transaction segments appear as amber blocks on goal bars, positioned at their date on the timeline. For depletion bars, scheduled outflows are added to the "used" portion of the fill calculation.

### Conventions

- GUIDs everywhere (`crypto.randomUUID()`) — same as ohm.
- ISO dates as strings (`YYYY-MM-DD`) for Dexie indexing — same as ohm.
- ISO timestamps for event recording (`new Date().toISOString()`).
- `DailyBudget` is computed, not stored — derived fresh on each render.
- Dark mode default, class-based toggle via `useTheme` hook.

### Phases

- **Phase 1 (live):** YNAB OAuth, daily budget from category balances, goal-derived category classification (NEED Refill → flexible, NEED Set Aside → necessity) with per-category overrides, flexible breakdown with weekly pace, overspend detection with move-money recommendations, cashflow chart with 14-day lookback + 14-day lookahead, scheduled transaction materialization, TBD goal synthetic cashflow events.
- **Phase 2 (parked on `feature/coaching`):** AI coaching — spending pattern detection, morning/evening check-in ritual, personalized budget insights.
- **Phase 3 (planned):** Spending trends, streak tracking, polish.
  - TODO: Optional "show credit balance" toggle on cashflow chart — opt in to offset the committed line by outstanding CC balance. Off by default (chart focuses on checking cashflow, not debt position). Useful for users who want visibility into how CC debt affects effective cash.

### Testing

Follow toolbox testing conventions. Priority:

1. `budget-math.ts` computation logic — pure functions, fully tested in `budget-math.test.ts`
2. Scheduled transaction materialization via `advanceByYnabFrequency`
3. Cashflow projection (past reconstruction + future drawdown)
