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

- `src/types/` — Data model types. `StoredSchedule` mirrors toolbox shared-schema. `BillStatus` aligns with schema.org `ActionStatusType`.
- `src/db/` — Dexie database definition. Single database `check-yo-self` with five tables.
- `src/hooks/` — React hooks. `useDailyBudget` is the core computation hook.
- `src/pages/` — Route-level page components (DashboardPage, TransactionsPage, BillsPage, SettingsPage).
- `src/components/` — Shared UI. `Layout.tsx` is the app shell with bottom tab nav.

### Conventions

- GUIDs everywhere (`crypto.randomUUID()`) — same as ohm.
- ISO dates as strings (`YYYY-MM-DD`) for Dexie indexing — same as ohm.
- ISO timestamps for event recording (`new Date().toISOString()`).
- `DailyBudget` is computed, not stored — derived fresh on each render.
- Transactions are source-agnostic: `source: 'manual' | 'plaid'`. Phase 3 adds Plaid without schema changes.
- Dark mode default, class-based toggle via `useTheme` hook.

### Phases

- **Phase 1 (current):** Core MVP — manual entry, bill tracking, daily budget, Calendar notifications.
- **Phase 2:** Claude API coaching — spending pattern detection, budget insights on check-in.
- **Phase 3:** Plaid bank integration — auto-import transactions from Wells Fargo.

### Testing

Follow toolbox testing conventions. Priority:

1. `useDailyBudget` computation logic (pure math, critical path)
2. Bill instance materialization from schedule
3. Transaction CRUD operations
