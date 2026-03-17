# Todo

## Setup

- [ ] Set `ANTHROPIC_API_KEY` repo secret (`gh secret set ANTHROPIC_API_KEY`)
- [ ] Make repo public when ready (enables Pages deploy + branch protection rulesets)
- [ ] Generate PWA icons (Lucide candidates: wallet, piggy-bank, hand-coins, circle-dollar-sign)
- [ ] Add a11y audit script (Playwright + axe-core) after Phase 1 MVP

## Phase 1: Core MVP

- [ ] Wire up YNAB token onboarding flow end-to-end (token save, budget select, cache sync)
- [ ] Implement daily budget computation in useBudget hook (totalAvailable / daysRemaining)
- [ ] Build DashboardPage: daily budget display, today's transactions, upcoming bills
- [ ] Build transaction list with YNAB data (payee, category, amount, date)
- [ ] Add refresh button with sync debounce (15-minute cache, force refresh)
- [ ] Handle YNAB rate limiting (429 response, user-friendly message)
- [ ] Add dark/light mode toggle to SettingsPage
- [ ] Test useBudget computation logic (pure math, critical path)
- [ ] Test bill materialization from YNAB scheduled transactions
