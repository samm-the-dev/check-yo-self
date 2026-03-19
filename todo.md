# Todo

## Setup

- [ ] Set up GDrive file sync (same approach as OHM — claude-gdrive-intake)
- [ ] Add a11y audit script (Playwright + axe-core)

## Polish

- [ ] Add dark/light mode toggle to SettingsPage
- [x] Test useBudget computation logic (pure math, critical path) — resolved by `budget-math.test.ts`
- [x] Test bill materialization from YNAB scheduled transactions — covered by `advanceByYnabFrequency` tests in `budget-math.test.ts`
- [x] Credit card nuance: surface scheduled CC payments in cashflow chart context — CC payments are included as checking outflows. Note: dailyAmount drawdown may slightly double-count flex spending done on credit cards; the chart is conservative mid-cycle but corrects at payment dates
- [x] Month-boundary dailyAmount inflection — resolved by switching to rolling LOOKAHEAD_DAYS horizon. dailyAmount is now month-agnostic; YNAB category balance resets handle the "what's left" while CYS handles "how fast to spend it" over a fixed window.
- [ ] Automated scheduled transaction coverage assessment: compare recent recurring outflows in transaction history against scheduled transactions to detect bills the user forgot to mark as scheduled in YNAB
- [ ] Check for recurring expenses in Need categories to improve cashflow accuracy
- [ ] Prompt to set up next month's budget when window crosses month (nudge exists, needs testing)
- [ ] Node.js 24 migration for GitHub Actions (warnings on v20 deprecation, forced June 2026)

## Future

- [ ] AI coaching (parked on `feature/coaching` branch)
- [ ] Update privacy policy to disclose that budget data is sent to AI API for coaching (when coaching ships)
- [ ] OG meta image for social sharing
- [ ] "Recent transactions" total shows net (inflows dominate) — consider showing gross spend separately
