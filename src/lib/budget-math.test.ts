/**
 * budget-math.test.ts — Contract tests for the canonical math module.
 *
 * These tests define the expected behavior of the pure functions in
 * budget-math.ts that power Check Yo Self's budget and cashflow math.
 */
import { describe, it, expect } from 'vitest';
import {
  computeDailyAmount,
  computeTotalAvailable,
  computeFlexibleBreakdown,
  computeSpendingVelocity,
  buildCashflowProjection,
  advanceByYnabFrequency,
  materializeFutureEvents,
  deriveTierFromGoal,
  LOOKAHEAD_DAYS,
  type CategoryInput,
  type ScheduledTransactionInput,
  type TransactionInput,
} from './budget-math';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCategory(overrides: Partial<CategoryInput> = {}): CategoryInput {
  return {
    id: 'cat-1',
    name: 'Test Category',
    groupName: 'Test Group',
    balance: 300,
    budgeted: 400,
    activity: 100,
    tier: 'flexible',
    ...overrides,
  };
}

function makeTransaction(overrides: Partial<TransactionInput> = {}): TransactionInput {
  return {
    date: '2026-03-15',
    amount: -25,
    categoryName: 'Test Category',
    payeeName: 'Test Payee',
    ...overrides,
  };
}

function makeScheduled(
  overrides: Partial<ScheduledTransactionInput> = {},
): ScheduledTransactionInput {
  return {
    dateNext: '2026-03-25',
    amount: -100,
    frequency: 'monthly',
    payeeName: 'Electric Co',
    categoryName: 'Utilities',
    transferAccountId: null,
    hitsChecking: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// deriveTierFromGoal
// ---------------------------------------------------------------------------

describe('deriveTierFromGoal', () => {
  it('NEED + Refill (false) → flexible', () => {
    expect(deriveTierFromGoal({ goalType: 'NEED', goalNeedsWholeAmount: false })).toBe('flexible');
  });

  it('NEED + Refill (null) → flexible (null treated as Refill)', () => {
    expect(deriveTierFromGoal({ goalType: 'NEED', goalNeedsWholeAmount: null })).toBe('flexible');
  });

  it('NEED + Set Aside (true) → necessity', () => {
    expect(deriveTierFromGoal({ goalType: 'NEED', goalNeedsWholeAmount: true })).toBe('necessity');
  });

  // Note: snoozed goals keep their derived tier — deriveTierFromGoal is snooze-agnostic.
  // The necessity gate (in ynab.ts) handles snoozed categories separately.

  it.each(['TB', 'TBD', 'MF', 'DEBT'])('%s goal type → undefined', (goalType) => {
    expect(deriveTierFromGoal({ goalType, goalNeedsWholeAmount: null })).toBeUndefined();
  });

  it('no goal (null) → undefined', () => {
    expect(deriveTierFromGoal({ goalType: null, goalNeedsWholeAmount: null })).toBeUndefined();
  });

  it('no goal (undefined) → undefined', () => {
    expect(
      deriveTierFromGoal({ goalType: undefined, goalNeedsWholeAmount: undefined }),
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// dailyAmount
// ---------------------------------------------------------------------------

describe('computeDailyAmount', () => {
  it('divides total available by LOOKAHEAD_DAYS', () => {
    expect(computeDailyAmount(140)).toBeCloseTo(10); // 140 / 14
  });

  it('returns 0 when total available is 0', () => {
    expect(computeDailyAmount(0)).toBe(0);
  });

  it('is month-agnostic (same result regardless of day-of-month)', () => {
    // The whole point: no month boundary dependency
    expect(computeDailyAmount(280)).toBeCloseTo(280 / LOOKAHEAD_DAYS);
  });
});

// ---------------------------------------------------------------------------
// totalAvailable
// ---------------------------------------------------------------------------

describe('computeTotalAvailable', () => {
  it('sums only flexible categories with positive balances', () => {
    const cats = [
      makeCategory({ id: '1', balance: 200, tier: 'flexible' }),
      makeCategory({ id: '2', balance: 100, tier: 'flexible' }),
      makeCategory({ id: '3', balance: 500, tier: 'necessity' }),
    ];
    expect(computeTotalAvailable(cats)).toBe(300);
  });

  it('excludes negative flexible balances (does not subtract them)', () => {
    const cats = [
      makeCategory({ id: '1', balance: 200, tier: 'flexible' }),
      makeCategory({ id: '2', balance: -50, tier: 'flexible' }),
    ];
    expect(computeTotalAvailable(cats)).toBe(200);
  });

  it('excludes zero-balance categories', () => {
    const cats = [
      makeCategory({ id: '1', balance: 0, tier: 'flexible' }),
      makeCategory({ id: '2', balance: 100, tier: 'flexible' }),
    ];
    expect(computeTotalAvailable(cats)).toBe(100);
  });

  it('returns 0 when all flexible balances are negative', () => {
    const cats = [
      makeCategory({ id: '1', balance: -50, tier: 'flexible' }),
      makeCategory({ id: '2', balance: -30, tier: 'flexible' }),
    ];
    expect(computeTotalAvailable(cats)).toBe(0);
  });

  it('returns 0 when no flexible categories exist', () => {
    const cats = [makeCategory({ id: '1', balance: 500, tier: 'necessity' })];
    expect(computeTotalAvailable(cats)).toBe(0);
  });

  it('uses weeklyTarget for targeted categories instead of balance', () => {
    const cats = [makeCategory({ id: '1', balance: 500, tier: 'flexible', weeklyTarget: 70 })];
    // (70 / 7) * 14 = 140
    expect(computeTotalAvailable(cats)).toBeCloseTo(140);
  });

  it('mixes targeted and non-targeted categories', () => {
    const cats = [
      makeCategory({ id: '1', balance: 200, tier: 'flexible', weeklyTarget: 70 }),
      makeCategory({ id: '2', balance: 100, tier: 'flexible' }),
    ];
    // targeted: (70/7)*14 = 140, non-targeted: 100
    expect(computeTotalAvailable(cats)).toBeCloseTo(240);
  });
});

// ---------------------------------------------------------------------------
// flexibleBreakdown
// ---------------------------------------------------------------------------

describe('computeFlexibleBreakdown', () => {
  it('computes per-category daily and window amounts using rolling horizon', () => {
    const cats = [makeCategory({ id: '1', name: 'Groceries', balance: 280, tier: 'flexible' })];
    const txns: TransactionInput[] = [];
    const totalDaily = 280 / LOOKAHEAD_DAYS; // 20
    const result = computeFlexibleBreakdown(cats, txns, totalDaily);
    expect(result).toHaveLength(1);
    expect(result[0].dailyAmount).toBeCloseTo(20); // 280 / 14
    // windowAmount should equal dailyAmount * LOOKBACK_DAYS (14)
    expect(result[0].windowAmount).toBeCloseTo(20 * 14);
  });

  it('computes spentInWindow from last 14 days of transactions', () => {
    const cats = [makeCategory({ id: '1', name: 'Dining Out', balance: 100, tier: 'flexible' })];
    const txns: TransactionInput[] = [
      makeTransaction({ date: '2026-03-18', amount: -15, categoryName: 'Dining Out' }),
      makeTransaction({ date: '2026-03-14', amount: -25, categoryName: 'Dining Out' }),
      makeTransaction({ date: '2026-03-10', amount: -30, categoryName: 'Dining Out' }),
      // Outside 14-day window (> 14 days ago from March 19)
      makeTransaction({ date: '2026-03-04', amount: -50, categoryName: 'Dining Out' }),
    ];
    const result = computeFlexibleBreakdown(cats, txns, 20, '2026-03-19');
    expect(result[0].spentInWindow).toBeCloseTo(70); // 15 + 25 + 30
  });

  it('windowAmount is consistent with dailyAmount (dailyAmount * LOOKBACK_DAYS)', () => {
    const cats = [makeCategory({ id: '1', name: 'Fun', balance: 140, tier: 'flexible' })];
    const result = computeFlexibleBreakdown(cats, [], 10);
    const daily = result[0].dailyAmount;
    const window = result[0].windowAmount;
    expect(window).toBeCloseTo(daily * 14);
  });

  it('includes negative-balance flexible categories in breakdown but not in total', () => {
    const cats = [makeCategory({ id: '1', name: 'Overspent', balance: -20, tier: 'flexible' })];
    const result = computeFlexibleBreakdown(cats, [], 20);
    expect(result).toHaveLength(1);
    expect(result[0].balance).toBe(-20);
  });

  it('uses weeklyTarget when set, ignoring balance for dailyAmount', () => {
    const cats = [
      makeCategory({
        id: '1',
        name: 'Groceries',
        balance: 500,
        tier: 'flexible',
        weeklyTarget: 70,
      }),
    ];
    const result = computeFlexibleBreakdown(cats, [], 10);
    expect(result[0].dailyAmount).toBeCloseTo(10); // 70 / 7
    expect(result[0].windowAmount).toBeCloseTo(10 * 14);
  });

  it('falls back to balance-derived dailyAmount when no weeklyTarget', () => {
    const cats = [makeCategory({ id: '1', name: 'Dining', balance: 140, tier: 'flexible' })];
    const result = computeFlexibleBreakdown(cats, [], 10);
    expect(result[0].dailyAmount).toBeCloseTo(10); // 140 / 14
  });

  it('mixes targeted and non-targeted categories', () => {
    const cats = [
      makeCategory({
        id: '1',
        name: 'Groceries',
        balance: 500,
        tier: 'flexible',
        weeklyTarget: 70,
      }),
      makeCategory({ id: '2', name: 'Fun', balance: 140, tier: 'flexible' }),
    ];
    const result = computeFlexibleBreakdown(cats, [], 20);
    expect(result[0].dailyAmount).toBeCloseTo(10); // target: 70/7
    expect(result[1].dailyAmount).toBeCloseTo(10); // balance: 140/14
  });

  // --- Bar data tests ---

  it('weekly goal: bar uses 7-day window vs weekly target', () => {
    const cats = [
      makeCategory({
        id: '1',
        name: 'Dining Out',
        balance: 100,
        tier: 'flexible',
        weeklyTarget: 30,
        goalDisplay: { amount: 30, cadence: 'weekly' },
      }),
    ];
    const txns: TransactionInput[] = [
      // Within 7 days of March 19
      makeTransaction({ date: '2026-03-18', amount: -10, categoryName: 'Dining Out' }),
      makeTransaction({ date: '2026-03-15', amount: -5, categoryName: 'Dining Out' }),
      // Within 14 days but outside 7 days
      makeTransaction({ date: '2026-03-10', amount: -20, categoryName: 'Dining Out' }),
    ];
    const result = computeFlexibleBreakdown(cats, txns, 10, '2026-03-19');
    const { bar } = result[0];
    expect(bar.mode).toBe('weekly');
    expect(bar.periodSpent).toBeCloseTo(15); // raw: 10 + 5
    // Decay: 10×(6/7) + 5×(3/7) ≈ 8.57 + 2.14 = 10.71
    expect(bar.effectiveSpent).toBeCloseTo(10.71, 1);
    expect(bar.periodBudget).toBe(30);
    expect(bar.fill).toBeCloseTo(10.71 / 30, 1); // decay-weighted fill
    expect(bar.todayPosition).toBe(0.5);
  });

  it('monthly goal: bar uses 30-day window vs monthly target', () => {
    const cats = [
      makeCategory({
        id: '1',
        name: 'Transport',
        balance: 60,
        tier: 'flexible',
        weeklyTarget: (90 * 12) / 52, // normalized weekly from $90/mo
        goalDisplay: { amount: 90, cadence: 'monthly' },
        activity: 30, // MTD from YNAB (not used for bar anymore)
      }),
    ];
    const txns: TransactionInput[] = [
      makeTransaction({ date: '2026-03-18', amount: -20, categoryName: 'Transport' }),
      makeTransaction({ date: '2026-03-01', amount: -15, categoryName: 'Transport' }),
      // Outside 30 days from March 19
      makeTransaction({ date: '2026-02-10', amount: -50, categoryName: 'Transport' }),
    ];
    const result = computeFlexibleBreakdown(cats, txns, 10, '2026-03-19');
    const { bar } = result[0];
    expect(bar.mode).toBe('monthly');
    expect(bar.periodSpent).toBeCloseTo(35); // raw: 20 + 15
    // Decay: 20×(29/30) + 15×(12/30) ≈ 19.33 + 6 = 25.33
    expect(bar.effectiveSpent).toBeCloseTo(25.33, 0);
    expect(bar.periodBudget).toBe(90);
    expect(bar.fill).toBeCloseTo(25.33 / 90, 1); // decay-weighted fill
    expect(bar.todayPosition).toBe(0.5);
  });

  it('no-goal: bar shows depletion (activity / (activity + balance))', () => {
    const cats = [
      makeCategory({
        id: '1',
        name: 'Misc',
        balance: 70,
        tier: 'flexible',
        activity: 30,
      }),
    ];
    const result = computeFlexibleBreakdown(cats, [], 10, '2026-03-19');
    const { bar } = result[0];
    expect(bar.mode).toBe('depletion');
    expect(bar.periodSpent).toBe(30); // activity
    expect(bar.periodBudget).toBe(100); // activity + balance
    expect(bar.fill).toBeCloseTo(0.3); // 30/100
    expect(bar.todayPosition).toBeNull();
  });

  it('bar includes scheduled transaction amounts', () => {
    const cats = [
      makeCategory({
        id: '1',
        name: 'Groceries',
        balance: 500,
        tier: 'flexible',
        weeklyTarget: 70,
        goalDisplay: { amount: 70, cadence: 'weekly' },
      }),
    ];
    const scheduled: ScheduledTransactionInput[] = [
      makeScheduled({
        dateNext: '2026-03-22',
        amount: -50,
        frequency: 'never',
        categoryName: 'Groceries',
        payeeName: 'Grocery Store',
      }),
    ];
    const result = computeFlexibleBreakdown(cats, [], 10, '2026-03-19', scheduled);
    expect(result[0].bar.scheduledEvents).toHaveLength(1);
    expect(result[0].bar.scheduledEvents[0].date).toBe('2026-03-22');
    expect(result[0].bar.scheduledEvents[0].amount).toBeCloseTo(50);
  });

  it('depletion bar subtracts scheduled outflows from remaining balance', () => {
    const cats = [
      makeCategory({
        id: '1',
        name: 'Misc',
        balance: 70,
        tier: 'flexible',
        activity: 30,
      }),
    ];
    const scheduled: ScheduledTransactionInput[] = [
      makeScheduled({
        dateNext: '2026-03-22',
        amount: -20,
        frequency: 'never',
        categoryName: 'Misc',
        payeeName: 'Subscription',
      }),
    ];
    const result = computeFlexibleBreakdown(cats, [], 10, '2026-03-19', scheduled);
    const { bar } = result[0];
    expect(bar.mode).toBe('depletion');
    // totalEnvelope = activity + balance = 30 + 70 = 100 (original, not reduced)
    // usedPortion = activity + scheduled = 30 + 20 = 50
    expect(bar.periodBudget).toBe(100);
    expect(bar.fill).toBeCloseTo(50 / 100); // scheduled counts as committed spending
  });
});

// ---------------------------------------------------------------------------
// spendingVelocity
// ---------------------------------------------------------------------------

describe('computeSpendingVelocity', () => {
  const flexNames = new Set(['Groceries', 'Dining Out', 'Fun']);

  it('computes average daily spend from flex outflows over 14 days', () => {
    const txns: TransactionInput[] = [
      makeTransaction({ date: '2026-03-18', amount: -70, categoryName: 'Groceries' }),
      makeTransaction({ date: '2026-03-11', amount: -70, categoryName: 'Groceries' }),
      makeTransaction({ date: '2026-03-15', amount: -28, categoryName: 'Dining Out' }),
    ];
    // Total: 168 over 14 days = 12/day
    const result = computeSpendingVelocity(txns, flexNames, '2026-03-19');
    expect(result).toBeCloseTo(12);
  });

  it('excludes non-flexible categories', () => {
    const txns: TransactionInput[] = [
      makeTransaction({ date: '2026-03-18', amount: -50, categoryName: 'Groceries' }),
      makeTransaction({ date: '2026-03-18', amount: -200, categoryName: 'Rent' }),
    ];
    // Only Groceries counts: 50 / 14
    const result = computeSpendingVelocity(txns, flexNames, '2026-03-19');
    expect(result).toBeCloseTo(50 / 14);
  });

  it('ignores inflows (positive amounts)', () => {
    const txns: TransactionInput[] = [
      makeTransaction({ date: '2026-03-18', amount: -50, categoryName: 'Groceries' }),
      makeTransaction({ date: '2026-03-18', amount: 30, categoryName: 'Groceries' }), // refund
    ];
    const result = computeSpendingVelocity(txns, flexNames, '2026-03-19');
    expect(result).toBeCloseTo(50 / 14);
  });

  it('excludes transactions outside the lookback window', () => {
    const txns: TransactionInput[] = [
      makeTransaction({ date: '2026-03-18', amount: -50, categoryName: 'Groceries' }),
      makeTransaction({ date: '2026-03-01', amount: -100, categoryName: 'Groceries' }), // 18 days ago
    ];
    // Only the -50 is within 14 days of March 19
    const result = computeSpendingVelocity(txns, flexNames, '2026-03-19');
    expect(result).toBeCloseTo(50 / 14);
  });

  it('returns 0 when no qualifying transactions exist', () => {
    const result = computeSpendingVelocity([], flexNames, '2026-03-19');
    expect(result).toBe(0);
  });

  it('returns 0 when all transactions are outside the window', () => {
    const txns: TransactionInput[] = [
      makeTransaction({ date: '2026-02-01', amount: -50, categoryName: 'Groceries' }),
    ];
    const result = computeSpendingVelocity(txns, flexNames, '2026-03-19');
    expect(result).toBe(0);
  });

  it('includes transactions on the boundary (today) but excludes windowStart', () => {
    const txns: TransactionInput[] = [
      makeTransaction({ date: '2026-03-19', amount: -14, categoryName: 'Fun' }), // today: included
      makeTransaction({ date: '2026-03-05', amount: -14, categoryName: 'Fun' }), // exactly 14 days ago: excluded
    ];
    // Window is (Mar 5, Mar 19] — Mar 5 excluded, Mar 19 included
    const result = computeSpendingVelocity(txns, flexNames, '2026-03-19');
    expect(result).toBeCloseTo(14 / 14);
  });

  it('respects custom lookback window', () => {
    const txns: TransactionInput[] = [
      makeTransaction({ date: '2026-03-18', amount: -35, categoryName: 'Dining Out' }),
    ];
    const result = computeSpendingVelocity(txns, flexNames, '2026-03-19', 7);
    expect(result).toBeCloseTo(5); // 35 / 7
  });
});

// ---------------------------------------------------------------------------
// advanceByYnabFrequency
// ---------------------------------------------------------------------------

describe('advanceByYnabFrequency', () => {
  it('advances daily by 1 day', () => {
    const d = new Date('2026-03-19T00:00:00');
    advanceByYnabFrequency(d, 'daily');
    expect(d.toISOString().slice(0, 10)).toBe('2026-03-20');
  });

  it('advances weekly by 7 days', () => {
    const d = new Date('2026-03-19T00:00:00');
    advanceByYnabFrequency(d, 'weekly');
    expect(d.toISOString().slice(0, 10)).toBe('2026-03-26');
  });

  it('twiceAMonth: before 15th advances to 15th', () => {
    const d = new Date('2026-03-10T00:00:00');
    advanceByYnabFrequency(d, 'twiceAMonth');
    expect(d.toISOString().slice(0, 10)).toBe('2026-03-15');
  });

  it('twiceAMonth: on or after 15th advances to 1st of next month', () => {
    const d = new Date('2026-03-15T00:00:00');
    advanceByYnabFrequency(d, 'twiceAMonth');
    expect(d.toISOString().slice(0, 10)).toBe('2026-04-01');
  });

  it('twiceAMonth: on the 20th advances to 1st of next month', () => {
    const d = new Date('2026-03-20T00:00:00');
    advanceByYnabFrequency(d, 'twiceAMonth');
    expect(d.toISOString().slice(0, 10)).toBe('2026-04-01');
  });

  it('monthly advances by one month', () => {
    const d = new Date('2026-03-15T00:00:00');
    advanceByYnabFrequency(d, 'monthly');
    expect(d.toISOString().slice(0, 10)).toBe('2026-04-15');
  });

  it('never does not advance the date and returns false', () => {
    const d = new Date('2026-03-15T00:00:00');
    const original = d.toISOString();
    expect(advanceByYnabFrequency(d, 'never')).toBe(false);
    expect(d.toISOString()).toBe(original);
  });

  it('returns true for known frequencies', () => {
    const d = new Date('2026-03-15T00:00:00');
    expect(advanceByYnabFrequency(d, 'monthly')).toBe(true);
  });

  it('returns false for unknown frequencies', () => {
    const d = new Date('2026-03-15T00:00:00');
    const original = d.toISOString();
    expect(advanceByYnabFrequency(d, 'unknownFrequency')).toBe(false);
    expect(d.toISOString()).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// materializeFutureEvents
// ---------------------------------------------------------------------------

describe('materializeFutureEvents', () => {
  it('materializes a one-off event within the window', () => {
    const scheduled = [makeScheduled({ dateNext: '2026-03-25', frequency: 'never' })];
    const events = materializeFutureEvents(scheduled, '2026-03-19', '2026-04-02');
    expect(events).toHaveLength(1);
    expect(events[0].date).toBe('2026-03-25');
  });

  it('excludes one-off events outside the window', () => {
    const scheduled = [makeScheduled({ dateNext: '2026-04-10', frequency: 'never' })];
    const events = materializeFutureEvents(scheduled, '2026-03-19', '2026-04-02');
    expect(events).toHaveLength(0);
  });

  it('materializes recurring events across the window', () => {
    const scheduled = [
      makeScheduled({ dateNext: '2026-03-22', frequency: 'weekly', amount: -100 }),
    ];
    const events = materializeFutureEvents(scheduled, '2026-03-19', '2026-04-05');
    // Should appear on March 22, March 29, April 5
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.date)).toEqual(['2026-03-22', '2026-03-29', '2026-04-05']);
  });

  it('does not infinite-loop on unknown frequencies', () => {
    const scheduled = [
      makeScheduled({ dateNext: '2026-03-22', frequency: 'unknownFrequency' as string }),
    ];
    // Should return without hanging
    const events = materializeFutureEvents(scheduled, '2026-03-19', '2026-04-02');
    expect(events.length).toBeLessThanOrEqual(1);
  });

  it('preserves hitsChecking flag on materialized events', () => {
    const scheduled = [
      makeScheduled({ dateNext: '2026-03-25', frequency: 'never', hitsChecking: false }),
    ];
    const events = materializeFutureEvents(scheduled, '2026-03-19', '2026-04-02');
    expect(events[0].hitsChecking).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// cashflow projection
// ---------------------------------------------------------------------------

describe('buildCashflowProjection', () => {
  const baseParams = {
    checkingBalance: 2500,
    projectedDailySpend: 40,
    today: '2026-03-19',
    lookbackDays: 7,
    lookaheadDays: 14,
    transactions: [] as TransactionInput[],
    scheduledTransactions: [] as ScheduledTransactionInput[],
  };

  it("anchors on today's checking balance (both lines)", () => {
    const result = buildCashflowProjection(baseParams);
    const todayEntry = result.find((e) => e.date === '2026-03-19');
    expect(todayEntry).toBeDefined();
    expect(todayEntry!.balance).toBe(2500);
    expect(todayEntry!.checkingBalance).toBe(2500);
  });

  it('subtracts projectedDailySpend from committed balance only', () => {
    const result = buildCashflowProjection(baseParams);
    const tomorrow = result.find((e) => e.date === '2026-03-20');
    expect(tomorrow).toBeDefined();
    expect(tomorrow!.balance).toBeCloseTo(2500 - 40);
    expect(tomorrow!.checkingBalance).toBe(2500); // no scheduled events — unchanged
  });

  it('scheduled events move both lines, projectedDailySpend only moves committed', () => {
    const result = buildCashflowProjection({
      ...baseParams,
      scheduledTransactions: [
        makeScheduled({
          dateNext: '2026-03-22',
          amount: -200,
          frequency: 'never',
          transferAccountId: null,
        }),
        makeScheduled({
          dateNext: '2026-03-25',
          amount: 3000,
          frequency: 'never',
          payeeName: 'Paycheck',
          transferAccountId: null,
        }),
      ],
    });

    // March 22: committed = 2500 - 40*3 - 200 = 2180
    //           checking  = 2500 - 200 = 2300 (no daily drawdown)
    const mar22 = result.find((e) => e.date === '2026-03-22');
    expect(mar22).toBeDefined();
    expect(mar22!.balance).toBeCloseTo(2180);
    expect(mar22!.checkingBalance).toBeCloseTo(2300);

    // March 25: committed = 2180 - 40*3 + 3000 = 5060
    //           checking  = 2300 + 3000 = 5300
    const mar25 = result.find((e) => e.date === '2026-03-25');
    expect(mar25).toBeDefined();
    expect(mar25!.balance).toBeCloseTo(5060);
    expect(mar25!.checkingBalance).toBeCloseTo(5300);
  });

  it('CC payment transfers hit both lines (real checking outflow)', () => {
    const result = buildCashflowProjection({
      ...baseParams,
      scheduledTransactions: [
        // CC payment transfer — reduces checking balance
        makeScheduled({
          dateNext: '2026-03-22',
          amount: -500,
          frequency: 'monthly',
          payeeName: 'Transfer: Credit Card',
          transferAccountId: 'cc-account-123',
        }),
      ],
    });

    // March 22: committed = 2500 - 40*3 - 500 = 1880
    //           checking  = 2500 - 500 = 2000 (CC payment hits checking, no drawdown)
    const mar22 = result.find((e) => e.date === '2026-03-22');
    expect(mar22).toBeDefined();
    expect(mar22!.balance).toBeCloseTo(1880);
    expect(mar22!.checkingBalance).toBeCloseTo(2000);
  });

  it('past balances are identical on both lines (already cleared)', () => {
    const txns: TransactionInput[] = [
      makeTransaction({ date: '2026-03-18', amount: -50, categoryName: 'Groceries' }),
      makeTransaction({ date: '2026-03-17', amount: -30, categoryName: 'Dining' }),
    ];
    const result = buildCashflowProjection({
      ...baseParams,
      transactions: txns,
    });
    // startBalance = 2500 - (-50) - (-30) = 2580
    // Walk forward: March 17: 2580 - 30 = 2550, March 18: 2550 - 50 = 2500
    const mar18 = result.find((e) => e.date === '2026-03-18');
    expect(mar18).toBeDefined();
    expect(mar18!.balance).toBeCloseTo(2500);
    expect(mar18!.checkingBalance).toBeCloseTo(2500);
  });

  it('continues projectedDailySpend drawdown past month boundary (committed only)', () => {
    // March 25 + 14 = April 8. Spending velocity continues as best-guess estimate.
    const result = buildCashflowProjection({
      ...baseParams,
      today: '2026-03-25',
      projectedDailySpend: 40,
      lookaheadDays: 14,
    });

    const aprilEntries = result.filter((e) => e.date > '2026-03-31');
    expect(aprilEntries.length).toBeGreaterThan(0);
    // April 1: committed = 2500 - 40*7 = 2220, checking = 2500 (no events)
    const apr1 = result.find((e) => e.date === '2026-04-01');
    expect(apr1).toBeDefined();
    expect(apr1!.balance).toBeCloseTo(2500 - 40 * 7);
    expect(apr1!.checkingBalance).toBe(2500);
  });

  it('CC-account charges move neither line (they manifest via CC payment transfers)', () => {
    const result = buildCashflowProjection({
      ...baseParams,
      scheduledTransactions: [
        // Subscription billed to credit card — doesn't hit checking directly
        makeScheduled({
          dateNext: '2026-03-22',
          amount: -50,
          frequency: 'monthly',
          payeeName: 'Netflix',
          hitsChecking: false,
        }),
      ],
    });

    // March 22: projected = 2500 - 40*3 = 2380 (CC charge excluded from cashflow)
    //           checking  = 2500 (unchanged)
    const mar22 = result.find((e) => e.date === '2026-03-22');
    expect(mar22).toBeDefined();
    expect(mar22!.balance).toBeCloseTo(2380);
    expect(mar22!.checkingBalance).toBe(2500);
  });

  it('mixes hitsChecking and CC-only events correctly', () => {
    const result = buildCashflowProjection({
      ...baseParams,
      scheduledTransactions: [
        // Direct debit from checking
        makeScheduled({
          dateNext: '2026-03-22',
          amount: -200,
          frequency: 'never',
          payeeName: 'Rent',
          hitsChecking: true,
        }),
        // CC charge — only committed
        makeScheduled({
          dateNext: '2026-03-22',
          amount: -50,
          frequency: 'never',
          payeeName: 'Streaming',
          hitsChecking: false,
        }),
        // CC payment transfer — hits checking
        makeScheduled({
          dateNext: '2026-03-25',
          amount: -500,
          frequency: 'never',
          payeeName: 'Transfer: Credit Card',
          transferAccountId: 'cc-account-123',
          hitsChecking: true,
        }),
      ],
    });

    // March 22: projected = 2500 - 40*3 - 200 = 2180 (CC charge excluded)
    //           checking  = 2500 - 200 = 2300 (only rent hits checking)
    const mar22 = result.find((e) => e.date === '2026-03-22');
    expect(mar22).toBeDefined();
    expect(mar22!.balance).toBeCloseTo(2180);
    expect(mar22!.checkingBalance).toBeCloseTo(2300);

    // March 25: projected = 2180 - 40*3 - 500 = 1560
    //           checking  = 2300 - 500 = 1800 (CC payment hits checking)
    const mar25 = result.find((e) => e.date === '2026-03-25');
    expect(mar25).toBeDefined();
    expect(mar25!.balance).toBeCloseTo(1560);
    expect(mar25!.checkingBalance).toBeCloseTo(1800);
  });

  it('materializes recurring scheduled transactions across the window', () => {
    const result = buildCashflowProjection({
      ...baseParams,
      scheduledTransactions: [
        makeScheduled({
          dateNext: '2026-03-22',
          amount: -100,
          frequency: 'weekly',
          transferAccountId: null,
        }),
      ],
    });

    // Should appear on March 22 and March 29
    const mar22 = result.find((e) => e.date === '2026-03-22');
    const mar29 = result.find((e) => e.date === '2026-03-29');
    expect(mar22?.dayEvents?.some((e) => e.amount === -100)).toBe(true);
    expect(mar29?.dayEvents?.some((e) => e.amount === -100)).toBe(true);
  });

  it('startingBalance reflects balance before day events and drawdown', () => {
    const txns: TransactionInput[] = [
      makeTransaction({ date: '2026-03-18', amount: -50, categoryName: 'Groceries' }),
    ];
    const result = buildCashflowProjection({
      ...baseParams,
      transactions: txns,
      scheduledTransactions: [
        makeScheduled({
          dateNext: '2026-03-22',
          amount: -200,
          frequency: 'never',
          transferAccountId: null,
        }),
      ],
    });

    // Past: Mar 18 had a -50 txn. startBalance = 2500+50 = 2550, after txn = 2500.
    const mar18 = result.find((e) => e.date === '2026-03-18');
    expect(mar18).toBeDefined();
    expect(mar18!.startingBalance).toBeCloseTo(2550);
    expect(mar18!.checkingBalance).toBeCloseTo(2500);

    // Today: anchor at 2500, no today events in this test
    const today = result.find((e) => e.date === '2026-03-19');
    expect(today).toBeDefined();
    expect(today!.startingBalance).toBeCloseTo(2500);

    // Future: Mar 20 starts at 2500 (yesterday's committed ending balance)
    const mar20 = result.find((e) => e.date === '2026-03-20');
    expect(mar20).toBeDefined();
    expect(mar20!.startingBalance).toBe(2500);

    // Future: Mar 22 has a -200 event. startingBalance = committed before event.
    // Mar 21 committed = 2500, Mar 22 starts at 2500, then -200 → 2300
    const mar22 = result.find((e) => e.date === '2026-03-22');
    expect(mar22).toBeDefined();
    expect(mar22!.startingBalance).toBe(2500);
    expect(mar22!.checkingBalance).toBeCloseTo(2300);
  });
});
