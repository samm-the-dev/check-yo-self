# Todo

## Setup

- [ ] Set up GDrive file sync (same approach as OHM — claude-gdrive-intake)
- [ ] Add a11y audit script (Playwright + axe-core)

## Polish

- [ ] Add dark/light mode toggle to SettingsPage
- [x] Test useBudget computation logic (pure math, critical path) — resolved by `budget-math.test.ts`
- [x] Test bill materialization from YNAB scheduled transactions — covered by `advanceByYnabFrequency` tests in `budget-math.test.ts`
- [x] Credit card nuance: surface scheduled CC payments in cashflow chart context — CC payment transfers (where `transferAccountId` is set) are now excluded from cashflow outflows in `buildCashflowProjection`
- [ ] Check for recurring expenses in Need categories to improve cashflow accuracy
- [ ] Prompt to set up next month's budget when window crosses month (nudge exists, needs testing)
- [ ] Node.js 24 migration for GitHub Actions (warnings on v20 deprecation, forced June 2026)

## Future

- [ ] AI coaching (parked on `feature/coaching` branch)
- [ ] Update privacy policy to disclose that budget data is sent to AI API for coaching (when coaching ships)
- [ ] OG meta image for social sharing
- [ ] "Recent transactions" total shows net (inflows dominate) — consider showing gross spend separately
