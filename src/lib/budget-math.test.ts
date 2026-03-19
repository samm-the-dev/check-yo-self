/**
 * budget-math.test.ts — Contract tests for the canonical math module.
 *
 * These tests define the expected behavior of the pure functions in
 * budget-math.ts that power Check Yo Self's budget and cashflow math.
 */
import { describe, it, expect } from 'vitest';
import {
  computeDaysRemaining,
  computeDailyAmount,
  computeTotalAvailable,
  computeFlexibleBreakdown,
  computeSpendingVelocity,
  computePaceOverspend,
  computeCoverageDays,
  buildCashflowProjection,
  advanceByYnabFrequency,
  materializeFutureEvents,
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
// daysRemaining
// ---------------------------------------------------------------------------

describe('computeDaysRemaining', () => {
  it('returns days remaining including today', () => {
    // March 19 → 31 - 19 + 1 = 13
    const result = computeDaysRemaining(2026, 2, 19); // 0-indexed month
    expect(result).toBe(13);
  });

  it('returns 1 on the last day of the month', () => {
    // March 31 → 31 - 31 + 1 = 1
    const result = computeDaysRemaining(2026, 2, 31);
    expect(result).toBe(1);
  });

  it('returns full month on the first day', () => {
    // March 1 → 31 - 1 + 1 = 31
    const result = computeDaysRemaining(2026, 2, 1);
    expect(result).toBe(31);
  });

  it('handles February correctly', () => {
    // Feb 2026 has 28 days. Feb 15 → 28 - 15 + 1 = 14
    const result = computeDaysRemaining(2026, 1, 15);
    expect(result).toBe(14);
  });

  it('never returns less than 1', () => {
    const result = computeDaysRemaining(2026, 2, 31);
    expect(result).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// dailyAmount
// ---------------------------------------------------------------------------

describe('computeDailyAmount', () => {
  it('divides total available by days remaining', () => {
    expect(computeDailyAmount(130, 13)).toBeCloseTo(10);
  });

  it('returns full balance on last day of month', () => {
    expect(computeDailyAmount(500, 1)).toBe(500);
  });

  it('returns 0 when total available is 0', () => {
    expect(computeDailyAmount(0, 15)).toBe(0);
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
});

// ---------------------------------------------------------------------------
// flexibleBreakdown
// ---------------------------------------------------------------------------

describe('computeFlexibleBreakdown', () => {
  it('computes per-category daily and weekly amounts', () => {
    const cats = [makeCategory({ id: '1', name: 'Groceries', balance: 260, tier: 'flexible' })];
    const txns: TransactionInput[] = [];
    const result = computeFlexibleBreakdown(cats, txns, 13, 20);
    expect(result).toHaveLength(1);
    expect(result[0].dailyAmount).toBeCloseTo(20); // 260 / 13
    // weeklyAmount should equal dailyAmount * 7
    expect(result[0].weeklyAmount).toBeCloseTo(20 * 7);
  });

  it('computes spentThisWeek from last 7 days of transactions', () => {
    const cats = [makeCategory({ id: '1', name: 'Dining Out', balance: 100, tier: 'flexible' })];
    const txns: TransactionInput[] = [
      makeTransaction({ date: '2026-03-18', amount: -15, categoryName: 'Dining Out' }),
      makeTransaction({ date: '2026-03-14', amount: -25, categoryName: 'Dining Out' }),
      // Outside 7-day window (> 7 days ago from March 19)
      makeTransaction({ date: '2026-03-10', amount: -50, categoryName: 'Dining Out' }),
    ];
    const result = computeFlexibleBreakdown(cats, txns, 13, 20, '2026-03-19');
    expect(result[0].spentThisWeek).toBeCloseTo(40); // 15 + 25
  });

  it('weeklyAmount is consistent with dailyAmount (dailyAmount * 7)', () => {
    const cats = [makeCategory({ id: '1', name: 'Fun', balance: 140, tier: 'flexible' })];
    const result = computeFlexibleBreakdown(cats, [], 14, 10);
    const daily = result[0].dailyAmount;
    const weekly = result[0].weeklyAmount;
    expect(weekly).toBeCloseTo(daily * 7);
  });

  it('includes negative-balance flexible categories in breakdown but not in total', () => {
    const cats = [makeCategory({ id: '1', name: 'Overspent', balance: -20, tier: 'flexible' })];
    const result = computeFlexibleBreakdown(cats, [], 13, 20);
    expect(result).toHaveLength(1);
    expect(result[0].balance).toBe(-20);
  });
});

// ---------------------------------------------------------------------------
// pace / overspend
// ---------------------------------------------------------------------------

describe('computePaceOverspend', () => {
  it('returns overspend when spending exceeds expected pace', () => {
    // dailyAmount=10, lookback=7: expected=70. spent=90 → overspend=20
    const result = computePaceOverspend(90, 10, 7);
    expect(result).toBeCloseTo(20);
  });

  it('returns 0 when spending is under pace', () => {
    const result = computePaceOverspend(50, 10, 7);
    expect(result).toBe(0);
  });

  it('returns full spend when dailyAmount is 0', () => {
    const result = computePaceOverspend(50, 0, 7);
    expect(result).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// coverageDays
// ---------------------------------------------------------------------------

describe('computeCoverageDays', () => {
  it('estimates days a balance will last at weekly spend rate', () => {
    // balance=100, spentThisWeek=70 → dailyRate=10 → coverage=10 days
    const result = computeCoverageDays(100, 70);
    expect(result).toBe(10);
  });

  it('caps at LOOKAHEAD (14) when balance outlasts the window', () => {
    const result = computeCoverageDays(1000, 7);
    expect(result).toBe(14);
  });

  it('returns LOOKAHEAD when balance is 0 or negative', () => {
    expect(computeCoverageDays(0, 50)).toBe(14);
    expect(computeCoverageDays(-10, 50)).toBe(14);
  });

  it('returns LOOKAHEAD when no spending this week', () => {
    expect(computeCoverageDays(100, 0)).toBe(14);
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

  it('CC-account charges only move committed line, not checking', () => {
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

    // March 22: committed = 2500 - 40*3 - 50 = 2330
    //           checking  = 2500 (CC charge doesn't touch checking)
    const mar22 = result.find((e) => e.date === '2026-03-22');
    expect(mar22).toBeDefined();
    expect(mar22!.balance).toBeCloseTo(2330);
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

    // March 22: committed = 2500 - 40*3 - 200 - 50 = 2130
    //           checking  = 2500 - 200 = 2300 (only rent hits checking)
    const mar22 = result.find((e) => e.date === '2026-03-22');
    expect(mar22).toBeDefined();
    expect(mar22!.balance).toBeCloseTo(2130);
    expect(mar22!.checkingBalance).toBeCloseTo(2300);

    // March 25: committed = 2130 - 40*3 - 500 = 1510
    //           checking  = 2300 - 500 = 1800 (CC payment hits checking)
    const mar25 = result.find((e) => e.date === '2026-03-25');
    expect(mar25).toBeDefined();
    expect(mar25!.balance).toBeCloseTo(1510);
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
});
