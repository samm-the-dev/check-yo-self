import { ShieldAlert, ExternalLink } from 'lucide-react';
import type { NecessityGateStatus } from '@/types/budget';

interface BudgetGateProps {
  gate: NecessityGateStatus;
}

export function BudgetGate({ gate }: BudgetGateProps) {
  return (
    <section className="border-warning/30 bg-warning/10 rounded-2xl border p-6">
      <div className="flex items-center gap-2">
        <ShieldAlert className="text-warning h-5 w-5 shrink-0" />
        <h2 className="text-warning text-lg font-semibold">Budget your necessities first</h2>
      </div>

      <p className="text-muted-foreground mt-2 text-sm">
        These categories need a budget for this month before your daily spending amount can be
        calculated.
      </p>

      <ul className="mt-3 space-y-1.5">
        {gate.unbudgetedNecessities.map((cat) => (
          <li
            key={cat.id}
            className="border-border bg-card flex items-center justify-between rounded-lg border px-3 py-2"
          >
            <div>
              <p className="text-sm font-medium">{cat.name}</p>
              <p className="text-muted-foreground text-xs">{cat.groupName}</p>
            </div>
            <span className="text-warning text-xs font-medium">Not budgeted</span>
          </li>
        ))}
      </ul>

      <a
        href={gate.ynabBudgetLink}
        target="_blank"
        rel="noopener noreferrer"
        className="bg-warning text-warning-foreground hover:bg-warning/90 mt-4 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
      >
        Open in YNAB <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </section>
  );
}
