import { useState } from 'react';
import { ChevronDown, ExternalLink, Info } from 'lucide-react';
import { formatCurrency, todayISO, cn } from '@/lib/utils';
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
            Each bar shows your spending pressure. For categories with a spending goal, the bar
            reflects how much budget your recent spending has consumed. The marker shows today —
            left means room to spend, right means you've spent ahead of pace.
          </p>
          <p>
            Spending impact fades over time — a grocery run today uses your full weekly budget, but
            each day that passes frees up a day's worth. This means your available amount gradually
            recovers as time passes, even without new spending.
          </p>
          <p>
            <strong>Weekly goals</strong> look at your last 7 days. <strong>Monthly goals</strong>{' '}
            look at the last 30 days. Categories without a goal show how much of the envelope
            balance has been used, including upcoming scheduled transactions.
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
          <CategoryBar
            key={`${cat.groupName}-${cat.name}`}
            cat={cat}
            categories={categories}
            planId={planId}
          />
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
  const isDepletion = bar.mode === 'depletion';
  // For depletion bars, fill is remaining ratio (1=full, 0=empty).
  // Overspent when scheduled txns push remaining negative (effectiveSpent > periodBudget).
  const overspent = isDepletion ? bar.effectiveSpent > bar.periodBudget : cat.balance < 0;

  const todayPercent = bar.todayPosition != null ? bar.todayPosition * 100 : null;
  const hasToday = todayPercent != null;

  // The bar is a symmetric window: periodDays back + periodDays forward.
  // A date d days from now maps to position 0.5 + d/(2*periodDays).
  // e.g. weekly: 7 back + 7 forward = 14 total, d=7 → 0.5 + 7/14 = 1.0 (bar end).
  const periodDays = bar.mode === 'weekly' ? 7 : bar.mode === 'monthly' ? 30 : 0;

  // Map scheduled events to bar positions.
  // The right edge of each segment aligns with the scheduled date (that's
  // when the money leaves). Width = how much budget it consumes.
  const todayStr = todayISO();
  const scheduledSegments =
    !isDepletion && !overspent && bar.scheduledEvents.length > 0
      ? bar.scheduledEvents
          .map((ev) => {
            // Use UTC to avoid DST-related 23/25-hour day shifts
            const [ey, em, ed] = ev.date.split('-').map(Number) as [number, number, number];
            const [ty, tm, td] = todayStr.split('-').map(Number) as [number, number, number];
            const daysFromToday =
              (Date.UTC(ey, em - 1, ed) - Date.UTC(ty, tm - 1, td)) / (1000 * 60 * 60 * 24);
            const right = (0.5 + daysFromToday / (2 * periodDays)) * 100;
            const width = bar.periodBudget > 0 ? (ev.amount / bar.periodBudget) * 100 : 0;
            const left = right - width;
            return { left, width };
          })
          .filter((s) => s.left + s.width > 0 && s.left < 100)
          .map((s) => ({
            left: Math.max(0, s.left),
            width: Math.min(s.left + s.width, 100) - Math.max(0, s.left),
          }))
      : [];

  // Iteratively expand the fill to jump over scheduled segments.
  // Each segment the fill reaches pushes it further, which may cause it
  // to reach the next segment, and so on.
  // For goal-based bars: fill 1.0 (on pace) = today marker (50%).
  // Over pace: extend to the coverage date position on the timeline
  // so the bar visually matches "spending should last through [date]".
  // Goal bars: fill 0–1 maps to 0–50% (under/on pace, left of today marker).
  // fill 1+ maps past the today marker. Over pace uses daysUntilFree to
  // position the fill at the coverage date on the timeline.
  // Depletion bars have their own render path.
  let baseFill: number;
  if (overspent) {
    baseFill = 100;
  } else if (isDepletion) {
    baseFill = 0; // depletion bar has its own render path
  } else if (bar.fill > 1 && bar.daysUntilFree != null) {
    baseFill = (0.5 + bar.daysUntilFree / (2 * periodDays)) * 100;
  } else {
    baseFill = Math.min(bar.fill, 2) * 50;
  }
  let fillPercent = baseFill;
  if (scheduledSegments.length > 0) {
    const sorted = [...scheduledSegments].sort((a, b) => a.left - b.left);
    let changed = true;
    while (changed) {
      changed = false;
      for (const seg of sorted) {
        if (seg.left < fillPercent && seg.left + seg.width > fillPercent) {
          // Fill reaches into this segment — push past it
          fillPercent = Math.min(seg.left + seg.width, 100);
          changed = true;
        }
      }
    }
  }

  return (
    <div className="py-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm">{cat.name}</span>
        <span className="text-muted-foreground text-xs tabular-nums">{paceLabel(cat)}</span>
      </div>
      <div className="relative mt-1.5 h-1.5 rounded-full">
        {isDepletion ? (
          <>
            {/* Depletion bar: red → yellow → green (left to right).
                Gradient is flipped vs goal bars because fill direction is
                opposite: fill starts full and decreases with spending.
                Remaining fill stays green (right side), exposed track is red. */}
            <div
              className="absolute inset-0 rounded-full"
              style={{
                background:
                  'linear-gradient(to right, hsl(0 65% 50%), hsl(38 92% 50%), hsl(152 60% 50%))',
                opacity: 0.2,
              }}
            />
            {overspent ? (
              <div
                className="absolute inset-0 rounded-full"
                style={{ background: 'hsl(0 65% 50%)' }}
              />
            ) : bar.fill <= 0 ? null : (
              <div
                className="absolute inset-y-0 left-0 overflow-hidden rounded-full transition-all"
                style={{ width: `${bar.fill * 100}%` }}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${100 / Math.max(bar.fill, 0.05)}%`,
                    background:
                      'linear-gradient(to right, hsl(0 65% 50%), hsl(38 92% 50%), hsl(152 60% 50%))',
                  }}
                />
              </div>
            )}
          </>
        ) : (
          <>
            {/* Goal-based bar: gradient from green → yellow (at today) → red */}
            <div
              className="absolute inset-0 rounded-full"
              style={{
                background: `linear-gradient(to right, hsl(152 60% 50%), hsl(38 92% 50%) ${todayPercent}%, hsl(0 65% 50%))`,
                opacity: 0.2,
              }}
            />
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
                    background: `linear-gradient(to right, hsl(152 60% 50%), hsl(38 92% 50%) ${todayPercent}%, hsl(0 65% 50%))`,
                  }}
                />
              </div>
            ) : null}
            {/* Scheduled transaction segments — positioned on the future timeline */}
            {scheduledSegments.map((seg, i) => (
              <div
                key={i}
                className="absolute inset-y-0 rounded-full"
                style={{
                  left: `${seg.left}%`,
                  width: `${seg.width}%`,
                  background: 'hsl(38 92% 50%)',
                  opacity: 0.35,
                }}
              />
            ))}
            {/* Today marker */}
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
          </>
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
        <p className="text-destructive text-xs">
          Overspent by {formatCurrency(overspendAmt)} in category
        </p>
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

  let label: string;
  if (bar.mode === 'depletion') {
    const scheduledTotal = bar.scheduledEvents.reduce((sum, ev) => sum + ev.amount, 0);
    const effective = cat.balance - scheduledTotal;
    if (scheduledTotal > 0) {
      label =
        effective >= 0
          ? `${formatCurrency(effective)} available after upcoming`
          : `${formatCurrency(Math.abs(effective))} short after upcoming`;
    } else {
      label = `${formatCurrency(cat.balance)} remaining`;
    }
  } else if (bar.fill > 1) {
    // Over pace — daysUntilFree is computed in budget-math from per-txn decay
    // simulation, so it's consistent with the fill calculation.
    label = `Spending should last through ${formatCoverDate(bar.daysUntilFree ?? 0)}`;
  } else {
    // Under/on pace — show available budget (periodBudget - effectiveSpent).
    // This is the total you can spend today: past spending has decayed,
    // freeing up budget as days pass.
    const available = Math.max(0, bar.periodBudget - bar.effectiveSpent);
    label = `Can spend ${formatCurrency(available)} today and stay on pace`;
  }

  return <p className="text-muted-foreground mt-1 text-xs">{label}</p>;
}
