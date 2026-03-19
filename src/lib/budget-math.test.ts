/**
 * budget-math.test.ts — Design spec for budget-math.ts
 *
 * These tests describe the intended behavior of the pure math functions
 * that power Check Yo Self. The module under test doesn't exist yet;
 * these tests define the contract.
 */
import { describe, it, expect } from 'vitest';
import {
  computeDaysRemaining,
  computeDailyAmount,
  computeTotalAvailable,
  computeFlexibleBreakdown,
  computePaceOverspend,
  computeCoverageDays,
  buildCashflowProjection,
  advanceByYnabFrequency,
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

  it('never does not advance the date', () => {
    const d = new Date('2026-03-15T00:00:00');
    const original = d.toISOString();
    advanceByYnabFrequency(d, 'never');
    expect(d.toISOString()).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// cashflow projection
// ---------------------------------------------------------------------------

describe('buildCashflowProjection', () => {
  const baseParams = {
    checkingBalance: 2500,
    dailyAmount: 40,
    today: '2026-03-19',
    lookbackDays: 7,
    lookaheadDays: 14,
    transactions: [] as TransactionInput[],
    scheduledTransactions: [] as ScheduledTransactionInput[],
  };

  it("anchors on today's checking balance", () => {
    const result = buildCashflowProjection(baseParams);
    const todayEntry = result.find((e) => e.date === '2026-03-19');
    expect(todayEntry).toBeDefined();
    expect(todayEntry!.balance).toBe(2500);
  });

  it('subtracts dailyAmount for each future day', () => {
    const result = buildCashflowProjection(baseParams);
    const tomorrow = result.find((e) => e.date === '2026-03-20');
    expect(tomorrow).toBeDefined();
    expect(tomorrow!.balance).toBeCloseTo(2500 - 40);
  });

  it('adds income and subtracts bills from scheduled transactions', () => {
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

    // March 22: 2500 - 40*3 (3 days) - 200 = 2500 - 120 - 200 = 2180
    const mar22 = result.find((e) => e.date === '2026-03-22');
    expect(mar22).toBeDefined();
    expect(mar22!.balance).toBeCloseTo(2180);

    // March 25: 2180 - 40*3 - 0 + 3000 = 2180 - 120 + 3000 = 5060
    const mar25 = result.find((e) => e.date === '2026-03-25');
    expect(mar25).toBeDefined();
    expect(mar25!.balance).toBeCloseTo(5060);
  });

  it('excludes CC payment transfers from cashflow outflows', () => {
    const result = buildCashflowProjection({
      ...baseParams,
      scheduledTransactions: [
        // This is a CC payment transfer — should NOT reduce balance
        makeScheduled({
          dateNext: '2026-03-22',
          amount: -500,
          frequency: 'monthly',
          payeeName: 'Transfer: Credit Card',
          transferAccountId: 'cc-account-123',
        }),
      ],
    });

    // March 22 should only show dailyAmount drawdown, not the CC transfer
    const mar22 = result.find((e) => e.date === '2026-03-22');
    expect(mar22).toBeDefined();
    // 2500 - 40*3 = 2380 (no CC payment deducted)
    expect(mar22!.balance).toBeCloseTo(2380);
  });

  it('reconstructs past balances from actual transactions', () => {
    const txns: TransactionInput[] = [
      makeTransaction({ date: '2026-03-18', amount: -50, categoryName: 'Groceries' }),
      makeTransaction({ date: '2026-03-17', amount: -30, categoryName: 'Dining' }),
    ];
    const result = buildCashflowProjection({
      ...baseParams,
      transactions: txns,
    });
    // Yesterday (March 18): balance should be 2500 + 50 (before today's balance was reached) reversed
    // Actually: startBalance = 2500 - (-50) - (-30) = 2580 for start of lookback
    // Then walk forward: March 17: 2580 - 30 = 2550, March 18: 2550 - 50 = 2500
    const mar18 = result.find((e) => e.date === '2026-03-18');
    expect(mar18).toBeDefined();
    expect(mar18!.balance).toBeCloseTo(2500); // After the -50 txn, should match today - today's txns
  });

  it('handles month boundary in 14-day lookahead', () => {
    // March 19 + 14 = April 2. The projection should not blindly
    // apply March's dailyAmount past March 31.
    const result = buildCashflowProjection({
      ...baseParams,
      today: '2026-03-25',
      dailyAmount: 40,
      lookaheadDays: 14,
    });

    // The projection extends into April — verify it has entries past month-end
    const aprilEntries = result.filter((e) => e.date > '2026-03-31');
    expect(aprilEntries.length).toBeGreaterThan(0);
    // NOTE: Ideally dailyAmount would reset at month boundary, but at minimum
    // the projection should not crash or produce nonsensical balances
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
