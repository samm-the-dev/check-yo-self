import { useState } from 'react';
import { ChevronDown, ExternalLink } from 'lucide-react';
import { formatCurrency, todayISO, cn } from '@/lib/utils';
import type { FlexibleCategoryDaily } from '@/types/budget';

/** Window: 7 days back + 14 days forward = 21 days total */
const LOOKBACK = 7;
const LOOKAHEAD = 14;
const WINDOW = LOOKBACK + LOOKAHEAD;

/** Today marker position: 7/21 = ~33% from the left */
const TODAY_PERCENT = (LOOKBACK / WINDOW) * 100;

interface CategoryBreakdownProps {
  categories: FlexibleCategoryDaily[];
  planId: string;
}

function coverageDays(balance: number, spentThisWeek: number): number {
  if (balance <= 0 || spentThisWeek <= 0) return LOOKAHEAD;
  const dailyRate = spentThisWeek / 7;
  return Math.min(Math.floor(balance / dailyRate), LOOKAHEAD);
}

function formatCoverDate(daysCovered: number): string {
  const d = new Date(todayISO() + 'T00:00:00');
  d.setDate(d.getDate() + daysCovered);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function CategoryBreakdown({ categories, planId }: CategoryBreakdownProps) {
  const [expanded, setExpanded] = useState(true);

  if (categories.length === 0) return null;

  return (
    <section className="border-border bg-card overflow-hidden rounded-2xl border">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-muted-foreground text-sm font-medium">By category</span>
        <ChevronDown
          className={cn(
            'text-muted-foreground h-4 w-4 transition-transform',
            expanded && 'rotate-180',
          )}
        />
      </button>

      {expanded && (
        <div className="border-border space-y-1 border-t px-4 pt-2 pb-3">
          {categories.map((cat) => {
            // How many days of budget this week's spending has consumed
            const dailyBudget = cat.dailyAmount;
            const daysConsumed =
              dailyBudget > 0 && cat.spentThisWeek > 0 ? cat.spentThisWeek / dailyBudget : 0;
            const overspent = cat.balance <= 0 || daysConsumed >= WINDOW;
            // Fill maps consumed days onto the 21-day timeline:
            // 0 days = empty, LOOKBACK (7) = at today marker, WINDOW (21) = full
            const coverFill = overspent ? 1 : daysConsumed / WINDOW;

            return (
              <div key={`${cat.groupName}-${cat.name}`} className="py-1.5">
                <span className="text-sm">{cat.name}</span>
                <div className="relative mt-1 h-1.5 overflow-hidden rounded-full">
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
                  {/* Today marker */}
                  <div
                    className="bg-foreground/60 absolute top-[-1px] bottom-[-1px] w-[2px] rounded-full"
                    style={{ left: `${TODAY_PERCENT}%` }}
                  />
                </div>
                {overspent ? (
                  <div className="mt-1 space-y-0.5">
                    {(() => {
                      const overspendAmt =
                        dailyBudget > 0
                          ? Math.max(0, cat.spentThisWeek - dailyBudget * LOOKBACK)
                          : cat.spentThisWeek;
                      const donor = categories
                        .filter(
                          (c) =>
                            c.name !== cat.name &&
                            c.balance > 0 &&
                            c.balance >= overspendAmt * 0.25,
                        )
                        .sort((a, b) => b.balance - a.balance)[0];
                      return (
                        <>
                          <p className="text-destructive text-xs">
                            Overspent by {formatCurrency(overspendAmt)} this week
                          </p>
                          {donor && (
                            <p className="text-muted-foreground text-xs">
                              {donor.name} has {formatCurrency(donor.balance)} available
                            </p>
                          )}
                        </>
                      );
                    })()}
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
                ) : daysConsumed > LOOKBACK ? (
                  <p className="text-muted-foreground mt-1 text-xs">
                    Should cover through{' '}
                    {formatCoverDate(coverageDays(cat.balance, cat.spentThisWeek))}
                  </p>
                ) : (
                  <p className="text-muted-foreground mt-1 text-xs">
                    Can spend {formatCurrency((cat.weeklyAmount - cat.spentThisWeek) / 7)} today and
                    stay on pace
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
