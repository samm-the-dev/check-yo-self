import { AlertTriangle } from 'lucide-react';
import type { OverspendWarning as OverspendWarningType } from '@/types/budget';

interface OverspendWarningProps {
  warnings: OverspendWarningType[];
}

export function OverspendWarning({ warnings }: OverspendWarningProps) {
  if (warnings.length === 0) return null;

  // Show the most significant warning
  const worst = warnings.reduce((a, b) => (a.percentUsed > b.percentUsed ? a : b));

  return (
    <div className="border-warning/30 bg-warning/10 flex items-start gap-2 rounded-lg border px-4 py-3">
      <AlertTriangle className="text-warning mt-0.5 h-4 w-4 shrink-0" />
      <p className="text-warning text-sm">
        Heads up: {Math.round(worst.percentUsed * 100)}% of today's budget spent on{' '}
        {worst.categoryName}. Other categories may need adjusting.
      </p>
    </div>
  );
}
