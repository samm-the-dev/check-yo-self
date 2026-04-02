import { useState } from 'react';
import { ChevronDown, ExternalLink, Info } from 'lucide-react';
import { formatCurrency, todayISO, cn } from '@/lib/utils';
import { computeBalanceCoverageDays, LOOKBACK_DAYS } from '@/lib/budget-math';
import type { FlexibleCategoryDaily } from '@/types/budget';

interface CategoryBreakdownProps {
  categories: FlexibleCategoryDaily[];
  planId: string | null;
}

function formatCoverDate(daysCovered: number): string {
  const d = new Date(todayISO() + 'T00:00:00');
  d.setDate(d.getDate() + daysCovered);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function paceLabel(cat: FlexibleCategoryDaily): string {
  if (cat.goalDisplay) {
    const suffix = cat.goalDisplay.cadence === 'weekly' ? '/wk' : '/mo';
    return `${formatCurrency(cat.goalDisplay.amount)}${suffix}`;
  }
  return `${formatCurrency(cat.balance)} left`;
}

export function CategoryBreakdown({ categories, planId }: CategoryBreakdownProps) {
  const [methodologyOpen, setMethodologyOpen] = useState(false);

  if (categories.length === 0) return null;

  const catsWithoutGoals = categories.filter((c) => c.weeklyTarget == null);

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-muted-foreground flex items-center gap-1.5 text-sm font-medium">
          By category
        </h2>
        <button
          onClick={() => setMethodologyOpen(!methodologyOpen)}
          className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs transition-colors"
        >
          <Info className="h-3 w-3" />
          How this works
          <ChevronDown
            className={cn('h-3 w-3 transition-transform', methodologyOpen && 'rotate-180')}
          />
        </button>
      </div>

      {methodologyOpen && (
        <div className="text-muted-foreground space-y-2 text-xs leading-relaxed">
          <p>
            Each bar shows how much of your budget you've used. For categories with a spending goal,
            the bar compares your recent spending against your weekly or monthly target. The marker
            shows today — left means room to spend, right means you've spent ahead of pace.
          </p>
          <p>
            <strong>Weekly goals</strong> look at your last 7 days of spending.{' '}
            <strong>Monthly goals</strong> look at the last 30 days. Categories without a goal show
            how much of the envelope balance has been used this month.
          </p>
          {catsWithoutGoals.length > 0 && (
            <div className="border-warning/30 bg-warning/5 rounded-md border px-3 py-2">
              <p className="text-warning text-xs font-medium">No spending goal set</p>
              <p className="mt-1">
                {catsWithoutGoals.map((c) => c.name).join(', ')} — set a weekly or monthly "Needed
                for Spending" goal in YNAB for more accurate pace tracking.
              </p>
            </div>
          )}
        </div>
      )}

      <div className="space-y-1">
        {categories.map((cat) => (
          <CategoryBar key={`${cat.groupName}-${cat.name}`} cat={cat} categories={categories} planId={planId} />
        ))}
      </div>
    </section>
  );
}

function CategoryBar({
  cat,
  categories,
  planId,
}: {
  cat: FlexibleCategoryDaily;
  categories: FlexibleCategoryDaily[];
  planId: string | null;
}) {
  const { bar } = cat;
  const overspent = cat.balance < 0;

  // Bar fill: clamp to [0,1] for CSS width
  const fillPercent = overspent ? 100 : Math.min(bar.fill, 1) * 100;
  const todayPercent = bar.todayPosition != null ? bar.todayPosition * 100 : null;

  // For goal-based bars: gradient from green → yellow (at today) → red
  // For depletion bars: solid fill from green to yellow based on usage
  const hasToday = todayPercent != null;

  return (
    <div className="py-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm">{cat.name}</span>
        <span className="text-muted-foreground text-xs tabular-nums">{paceLabel(cat)}</span>
      </div>
      <div className="relative mt-1.5 h-1.5 rounded-full">
        {/* Track — full-width gradient at low opacity */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: hasToday
              ? `linear-gradient(to right, hsl(152 60% 50%), hsl(38 92% 50%) ${todayPercent}%, hsl(0 65% 50%))`
              : 'linear-gradient(to right, hsl(152 60% 50%), hsl(38 92% 50%))',
            opacity: 0.2,
          }}
        />
        {/* Fill — clips the same full-width gradient at full opacity */}
        {overspent ? (
          <div
            className="absolute inset-0 rounded-full"
            style={{ background: 'hsl(0 65% 50%)' }}
          />
        ) : fillPercent > 0 ? (
          <div
            className="absolute inset-y-0 left-0 overflow-hidden rounded-full transition-all"
            style={{ width: `${fillPercent}%` }}
          >
            <div
              className="h-full rounded-full"
              style={{
                width: `${100 / Math.max(fillPercent / 100, 0.05)}%`,
                background: hasToday
                  ? `linear-gradient(to right, hsl(152 60% 50%), hsl(38 92% 50%) ${todayPercent}%, hsl(0 65% 50%))`
                  : 'linear-gradient(to right, hsl(152 60% 50%), hsl(38 92% 50%))',
              }}
            />
          </div>
        ) : null}
        {/* Today marker — only for goal-based bars */}
        {hasToday && (
          <div
            className="absolute top-0 bottom-0"
            style={{ left: `${todayPercent}%`, transform: 'translateX(-50%)' }}
          >
            <div
              className="absolute bottom-full"
              style={{
                width: 0,
                height: 0,
                borderLeft: '4px solid transparent',
                borderRight: '4px solid transparent',
                borderTop: '5px solid currentColor',
                left: '50%',
                transform: 'translateX(-50%)',
              }}
            />
            <div
              className="bg-foreground/70 absolute inset-y-0 w-[1.5px]"
              style={{ left: '50%', transform: 'translateX(-50%)' }}
            />
          </div>
        )}
      </div>
      <BarLabel cat={cat} categories={categories} planId={planId} />
    </div>
  );
}

function BarLabel({
  cat,
  categories,
  planId,
}: {
  cat: FlexibleCategoryDaily;
  categories: FlexibleCategoryDaily[];
  planId: string | null;
}) {
  const { bar } = cat;
  const overspent = cat.balance < 0;

  // YNAB-computed shortfall: how much more needs to be budgeted to meet the goal
  const warningEl =
    cat.goalUnderFunded != null && cat.goalUnderFunded > 0 && !cat.goalSnoozed ? (
      <span className="text-warning text-[10px]">
        Budget {formatCurrency(cat.goalUnderFunded)} under target
      </span>
    ) : null;

  if (overspent) {
    const overspendAmt = Math.abs(cat.balance);
    const catKey = `${cat.groupName}-${cat.name}`;
    const donor = categories
      .filter(
        (c) =>
          `${c.groupName}-${c.name}` !== catKey &&
          c.balance > 0 &&
          c.balance >= overspendAmt * 0.25,
      )
      .sort((a, b) => b.balance - a.balance)[0];
    return (
      <div className="mt-1 space-y-0.5">
        <div className="flex items-baseline justify-between">
          <p className="text-destructive text-xs">
            Overspent by {formatCurrency(overspendAmt)} in category
          </p>
          {warningEl}
        </div>
        {donor && (
          <p className="text-muted-foreground text-xs">
            {donor.name} has {formatCurrency(donor.balance)} available
          </p>
        )}
        {planId && (
          <a
            href={`https://app.ynab.com/${planId}/budget`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary inline-flex items-center gap-1 text-xs hover:underline"
          >
            Rebalance in YNAB
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    );
  }

  // Balance-based coverage date
  const balanceDays = computeBalanceCoverageDays(cat.balance, cat.dailyAmount);

  let label: string;
  if (bar.mode === 'depletion') {
    // No-goal: show remaining balance context
    label =
      balanceDays > 0
        ? `Balance will last through ${formatCoverDate(Math.floor(balanceDays))}`
        : `${formatCurrency(cat.balance)} remaining`;
  } else if (bar.fill > 1) {
    // Over pace — show what date the overspending covers through
    label = `Over pace — balance will last through ${formatCoverDate(Math.floor(balanceDays))}`;
  } else {
    // Under/on pace — show daily allowance
    const remaining = bar.periodBudget - bar.periodSpent;
    const periodLabel = bar.mode === 'weekly' ? 7 : 30;
    const dailyRemaining = Math.max(0, remaining / periodLabel);
    label = `Can spend ${formatCurrency(dailyRemaining)} today and stay on pace`;
  }

  return (
    <div className="mt-1 flex items-baseline justify-between">
      <p className="text-muted-foreground text-xs">{label}</p>
      {warningEl}
    </div>
  );
}
