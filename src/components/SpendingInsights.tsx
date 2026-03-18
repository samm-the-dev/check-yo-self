import { Info } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import type { SpendingInsight } from '@/types/budget';

interface SpendingInsightsProps {
  insights: SpendingInsight[];
}

function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function SpendingInsights({ insights }: SpendingInsightsProps) {
  if (insights.length === 0) return null;

  return (
    <div className="space-y-2">
      {insights.map((insight) => (
        <div
          key={insight.categoryName}
          className="border-border bg-card flex items-center gap-3 rounded-lg border p-3"
        >
          <Info className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
          <p className="text-muted-foreground text-sm">
            {formatCurrency(insight.spentThisWeek)} on {insight.categoryName} this week.{' '}
            {formatCurrency(insight.remainingBalance)} left — should cover you through{' '}
            {formatDate(insight.coversUntil)}.
          </p>
        </div>
      ))}
    </div>
  );
}
