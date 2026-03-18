import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
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
  daysRemaining: number;
}

function coverageDays(balance: number, spentThisWeek: number, daysRemaining: number): number {
  if (balance <= 0 || spentThisWeek <= 0) return daysRemaining;
  const dailyRate = spentThisWeek / 7;
  return Math.min(Math.floor(balance / dailyRate), daysRemaining);
}

function formatCoverDate(daysCovered: number): string {
  const d = new Date(todayISO() + 'T00:00:00');
  d.setDate(d.getDate() + daysCovered);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function CategoryBreakdown({ categories, daysRemaining }: CategoryBreakdownProps) {
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
            const overspent = cat.balance <= 0;

            // How many days from today the balance covers at current pace
            const daysCovered = coverageDays(cat.balance, cat.spentThisWeek, daysRemaining);
            // Fill extends from left edge to coverage point on the 21-day timeline
            // Coverage of N days from today = (LOOKBACK + N) / WINDOW
            const coverFill = Math.min(1, (LOOKBACK + daysCovered) / WINDOW);

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
                  ) : (
                    <div
                      className="absolute inset-y-0 left-0 overflow-hidden rounded-full transition-all"
                      style={{ width: `${coverFill * 100}%` }}
                    >
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${100 / coverFill}%`,
                          background: `linear-gradient(to right, hsl(152 60% 50%), hsl(38 92% 50%) ${TODAY_PERCENT}%, hsl(0 65% 50%))`,
                        }}
                      />
                    </div>
                  )}
                  {/* Today marker */}
                  <div
                    className="bg-foreground/60 absolute top-[-1px] bottom-[-1px] w-[2px] rounded-full"
                    style={{ left: `${TODAY_PERCENT}%` }}
                  />
                </div>
                {overspent ? (
                  <p className="text-destructive mt-1 text-xs">
                    Overspent — consider rebalancing in YNAB
                  </p>
                ) : cat.spentThisWeek > cat.weeklyAmount ? (
                  <p className="text-muted-foreground mt-1 text-xs">
                    Should cover through {formatCoverDate(daysCovered)}
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
