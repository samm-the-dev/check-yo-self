import { useState } from 'react';
import { ChevronDown, ExternalLink, Info } from 'lucide-react';
import { formatCurrency, todayISO, cn } from '@/lib/utils';
import {
  computePaceOverspend,
  computeCoverageDays,
  computeBalanceCoverageDays,
  LOOKBACK_DAYS,
  LOOKAHEAD_DAYS,
} from '@/lib/budget-math';
import type { FlexibleCategoryDaily } from '@/types/budget';

const WINDOW = LOOKBACK_DAYS + LOOKAHEAD_DAYS;

/** Today marker position as percentage from the left */
const TODAY_PERCENT = (LOOKBACK_DAYS / WINDOW) * 100;

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
            Each bar shows how far your spending has carried you on a {WINDOW}-day timeline. The
            marker is today. Left of it is the past two weeks; right is the next two.
          </p>
          <p>
            <strong>On pace</strong> means your spending rate matches your budget — the bar reaches
            today. Past today means you've spent ahead (covered more days). Short of today means you
            have room to spend and stay on track.
          </p>
          <p>
            <strong>Goal-based categories</strong> use your YNAB weekly or monthly spending goal as
            the pace target. Categories without a goal fall back to an estimate based on their
            current balance.
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
        {categories.map((cat) => {
          const coverageDays = computeCoverageDays(cat.balance, cat.spentInWindow, cat.dailyAmount);
          const overspent = cat.balance < 0;
          // coverageDays = days of the 28-day window consumed by spending.
          // 0 = no spending, 14 = on pace (today marker), >14 = ahead of pace.
          // Clamp to [0,1] for CSS width — uncapped coverageDays can exceed WINDOW.
          const coverFill = overspent ? 1 : Math.min(coverageDays / WINDOW, 1);
          return (
            <div key={`${cat.groupName}-${cat.name}`} className="py-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm">{cat.name}</span>
                <span className="text-muted-foreground text-xs tabular-nums">{paceLabel(cat)}</span>
              </div>
              <div className="relative mt-1.5 h-1.5 rounded-full">
                {/* Track — full-width gradient at low opacity */}
                <div
                  className="absolute inset-0 rounded-full"
                  style={{
                    background: `linear-gradient(to right, hsl(152 60% 50%), hsl(38 92% 50%) ${TODAY_PERCENT}%, hsl(0 65% 50%))`,
                    opacity: 0.2,
                  }}
                />
                {/* Fill — clips the same full-width gradient at full opacity */}
                {overspent ? (
                  <div
                    className="absolute inset-0 rounded-full"
                    style={{ background: 'hsl(0 65% 50%)' }}
                  />
                ) : coverFill > 0 ? (
                  <div
                    className="absolute inset-y-0 left-0 overflow-hidden rounded-full transition-all"
                    style={{ width: `${coverFill * 100}%` }}
                  >
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${100 / Math.max(coverFill, 0.05)}%`,
                        background: `linear-gradient(to right, hsl(152 60% 50%), hsl(38 92% 50%) ${TODAY_PERCENT}%, hsl(0 65% 50%))`,
                      }}
                    />
                  </div>
                ) : null}
                {/* Today marker — triangle above + line through */}
                <div
                  className="absolute top-0 bottom-0"
                  style={{ left: `${TODAY_PERCENT}%`, transform: 'translateX(-50%)' }}
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
              </div>
              {(() => {
                // YNAB-computed shortfall: how much more needs to be budgeted to meet the goal
                const warningEl =
                  cat.goalUnderFunded != null && cat.goalUnderFunded > 0 && !cat.goalSnoozed ? (
                    <span className="text-warning text-[10px]">
                      Budget {formatCurrency(cat.goalUnderFunded)} under target
                    </span>
                  ) : null;

                if (overspent) {
                  const paceOverspend = computePaceOverspend(
                    cat.spentInWindow,
                    cat.dailyAmount,
                    LOOKBACK_DAYS,
                  );
                  const overspendAmt = paceOverspend > 0 ? paceOverspend : Math.abs(cat.balance);
                  const overspendLabel =
                    paceOverspend > 0 ? `over last ${LOOKBACK_DAYS} days` : 'in category';
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
                          Overspent by {formatCurrency(overspendAmt)} {overspendLabel}
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

                // Balance-based coverage: how many future days the remaining balance
                // covers at the budgeted rate. Stable (only moves when balance changes
                // via YNAB sync, not when the sliding lookback window shifts).
                const balanceDays = computeBalanceCoverageDays(cat.balance, cat.dailyAmount);

                const label =
                  balanceDays > LOOKBACK_DAYS
                    ? `Should cover through ${formatCoverDate(Math.floor(balanceDays))}`
                    : `Can spend ${formatCurrency((cat.windowAmount - cat.spentInWindow) / LOOKBACK_DAYS)} today and stay on pace`;

                return (
                  <div className="mt-1 flex items-baseline justify-between">
                    <p className="text-muted-foreground text-xs">{label}</p>
                    {warningEl}
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>
    </section>
  );
}
