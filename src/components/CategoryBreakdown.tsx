import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { formatCurrency, cn } from '@/lib/utils';
import type { FlexibleCategoryDaily } from '@/types/budget';

/** Warn if a single category holds this fraction of the total daily budget */
const CONCENTRATION_THRESHOLD = 0.6;

interface CategoryBreakdownProps {
  categories: FlexibleCategoryDaily[];
}

export function CategoryBreakdown({ categories }: CategoryBreakdownProps) {
  const [expanded, setExpanded] = useState(false);

  if (categories.length === 0) return null;

  const concentrated = categories.find((c) => c.percentOfTotal >= CONCENTRATION_THRESHOLD);

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
            const usedPercent =
              cat.dailyAmount > 0
                ? Math.min(1, cat.spentToday / cat.dailyAmount)
                : cat.spentToday > 0
                  ? 1
                  : 0;

            return (
              <div key={`${cat.groupName}-${cat.name}`} className="py-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm">{cat.name}</span>
                  <span className="text-muted-foreground text-xs">
                    {formatCurrency(cat.spentToday)} / {formatCurrency(cat.dailyAmount)}
                  </span>
                </div>
                <div className="bg-muted mt-1 h-1.5 overflow-hidden rounded-full">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all',
                      usedPercent >= 0.9
                        ? 'bg-destructive'
                        : usedPercent >= 0.7
                          ? 'bg-warning'
                          : 'bg-primary',
                    )}
                    style={{ width: `${usedPercent * 100}%` }}
                  />
                </div>
              </div>
            );
          })}

          {concentrated && (
            <p className="text-warning mt-2 text-xs">
              Most of your daily budget is in {concentrated.name} — consider spreading across
              categories.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
