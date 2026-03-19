import { useBudget } from '@/hooks/useBudget';
import type { TransactionSummary } from '@/types/budget';
import { getCategoryTiers, getResolvedPlanId } from '@/services/ynab';
import { formatCurrency, todayISO, cn } from '@/lib/utils';
import { BudgetGate } from '@/components/BudgetGate';
import { CategoryBreakdown } from '@/components/CategoryBreakdown';
import { CashflowChart } from '@/components/CashflowChart';
import {
  RefreshCw,
  TrendingDown,
  ArrowRight,
  ExternalLink,
  Settings,
  CalendarClock,
  ChevronDown,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

const NUDGE_DISMISSED_KEY = 'cys-tier-nudge-dismissed';
const SCHEDULED_NUDGE_DISMISSED_KEY = 'cys-scheduled-nudge-dismissed';

export function DashboardPage() {
  const { connected, syncing, budget, recentTransactions, upcomingBills, refresh, error } =
    useBudget();
  const today = new Date(todayISO() + 'T00:00:00');

  const hasTiers = Object.keys(getCategoryTiers()).length > 0;
  const nudgeDismissed = localStorage.getItem(NUDGE_DISMISSED_KEY) === 'true';
  const scheduledNudgeDismissed = localStorage.getItem(SCHEDULED_NUDGE_DISMISSED_KEY) === 'true';
  // Month-specific key so it re-prompts each month
  const nextMonthKey = `cys-next-month-nudge-${today.getFullYear()}-${String(today.getMonth() + 2).padStart(2, '0')}`;
  const nextMonthNudgeDismissed = localStorage.getItem(nextMonthKey) === 'true';
  const planId = getResolvedPlanId();

  // Next month's name for the nudge
  const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1).toLocaleDateString(
    'en-US',
    { month: 'long' },
  );
  const windowCrossesMonth = budget && budget.daysRemaining <= 14;

  if (!connected) {
    return (
      <div className="mx-auto max-w-lg space-y-6">
        <ConnectPrompt />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-primary text-lg font-bold tracking-wide uppercase">
            Check Yo Self!
          </h1>
          <p className="text-muted-foreground text-sm">
            {today.toLocaleDateString('en-US', {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
            })}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {planId && (
            <a
              href={`https://app.ynab.com/${planId}/budget`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs transition-colors"
            >
              YNAB <ExternalLink className="h-3 w-3" />
            </a>
          )}
          <button
            onClick={refresh}
            disabled={syncing}
            className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            aria-label="Refresh from YNAB"
          >
            <RefreshCw className={cn('h-4 w-4', syncing && 'animate-spin')} />
          </button>
        </div>
      </header>

      {error && (
        <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Tier setup nudge */}
      {!hasTiers && !nudgeDismissed && budget && (
        <div className="border-border bg-card flex items-center justify-between rounded-lg border px-4 py-3">
          <div className="flex items-center gap-2">
            <Settings className="text-muted-foreground h-4 w-4" />
            <p className="text-muted-foreground text-sm">
              <Link to="/settings" className="text-primary hover:underline">
                Set up category tiers
              </Link>{' '}
              for more accurate budget tracking.
            </p>
          </div>
          <button
            onClick={() => localStorage.setItem(NUDGE_DISMISSED_KEY, 'true')}
            className="text-muted-foreground hover:text-foreground ml-2 text-xs"
            aria-label="Dismiss"
          >
            &times;
          </button>
        </div>
      )}

      {/* Scheduled transactions nudge */}
      {!scheduledNudgeDismissed && budget && upcomingBills.length === 0 && (
        <div className="border-border bg-card flex items-center justify-between rounded-lg border px-4 py-3">
          <div className="flex items-center gap-2">
            <CalendarClock className="text-muted-foreground h-4 w-4 shrink-0" />
            <p className="text-muted-foreground text-sm">
              {planId ? (
                <a
                  href={`https://app.ynab.com/${planId}/accounts`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Set up scheduled transactions
                </a>
              ) : (
                <span className="text-primary">Set up scheduled transactions</span>
              )}{' '}
              in YNAB so the coach can see upcoming bills.{' '}
              <a
                href="https://support.ynab.com/en_us/scheduled-transactions-a-guide-BygrAIFA9"
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground underline underline-offset-2"
              >
                How?
              </a>
            </p>
          </div>
          <button
            onClick={() => localStorage.setItem(SCHEDULED_NUDGE_DISMISSED_KEY, 'true')}
            className="text-muted-foreground hover:text-foreground ml-2 text-xs"
            aria-label="Dismiss"
          >
            &times;
          </button>
        </div>
      )}

      {/* Next month budget nudge */}
      {windowCrossesMonth && !nextMonthNudgeDismissed && (
        <div className="border-border bg-card flex items-center justify-between rounded-lg border px-4 py-3">
          <div className="flex items-center gap-2">
            <CalendarClock className="text-muted-foreground h-4 w-4 shrink-0" />
            <p className="text-muted-foreground text-sm">
              Your forecast extends into {nextMonth}.{' '}
              {planId ? (
                <a
                  href={`https://app.ynab.com/${planId}/budget`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Set up {nextMonth}'s budget
                </a>
              ) : (
                <span className="text-primary">Set up {nextMonth}'s budget</span>
              )}{' '}
              in YNAB for accurate projections.
            </p>
          </div>
          <button
            onClick={() => localStorage.setItem(nextMonthKey, 'true')}
            className="text-muted-foreground hover:text-foreground ml-2 text-xs"
            aria-label="Dismiss"
          >
            &times;
          </button>
        </div>
      )}

      {budget && (
        <>
          {budget.gate?.blocked ? (
            <BudgetGate gate={budget.gate} />
          ) : (
            <>
              {/* Recent transactions — collapsed by default */}
              {recentTransactions.length > 0 && (
                <RecentTransactions transactions={recentTransactions} />
              )}

              {/* Category breakdown */}
              {budget.flexibleBreakdown && (
                <CategoryBreakdown categories={budget.flexibleBreakdown} planId={planId} />
              )}
            </>
          )}
        </>
      )}

      {/* Projected cashflow */}
      {budget && <CashflowChart budget={budget} />}

      {/* Upcoming bills — collapsible */}
      {upcomingBills.length > 0 && <ScheduledTransactions bills={upcomingBills} />}
    </div>
  );
}

function RecentTransactions({ transactions }: { transactions: TransactionSummary[] }) {
  const [expanded, setExpanded] = useState(false);
  const total = transactions.reduce((sum, t) => sum + t.amount, 0);

  return (
    <section className="space-y-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-muted-foreground flex w-full items-center gap-1.5 text-sm font-medium"
      >
        <TrendingDown className="h-3.5 w-3.5" />
        Recent transactions
        <span className="ml-auto flex items-center gap-1.5">
          <SignedAmount amount={total} />
          <ChevronDown className={cn('h-4 w-4 transition-transform', expanded && 'rotate-180')} />
        </span>
      </button>
      {expanded && (
        <div className="space-y-1">
          {transactions.map((t, i) => (
            <div
              key={i}
              className="border-border bg-card flex items-center justify-between rounded-lg border px-4 py-3"
            >
              <div>
                <p className="text-sm font-medium">{t.payee}</p>
                <p className="text-muted-foreground text-xs">{t.category}</p>
              </div>
              <SignedAmount amount={t.amount} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function SignedAmount({ amount }: { amount: number }) {
  const positive = amount > 0;
  return (
    <span className={cn('text-sm font-semibold', positive ? 'text-primary' : '')}>
      {positive ? '+' : ''}
      {formatCurrency(amount)}
    </span>
  );
}

function ScheduledTransactions({ bills }: { bills: TransactionSummary[] }) {
  const [expanded, setExpanded] = useState(false);
  const total = bills.reduce((sum, b) => sum + b.amount, 0);

  return (
    <section className="space-y-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-muted-foreground flex w-full items-center gap-1.5 text-sm font-medium"
      >
        <CalendarClock className="h-3.5 w-3.5" />
        Scheduled ({bills.length})
        <span className="ml-auto flex items-center gap-1.5">
          <SignedAmount amount={total} />
          <ChevronDown className={cn('h-4 w-4 transition-transform', expanded && 'rotate-180')} />
        </span>
      </button>
      {expanded && (
        <div className="space-y-1">
          {bills.map((b, i) => (
            <div
              key={i}
              className="border-border bg-card flex items-center justify-between rounded-lg border px-4 py-3"
            >
              <div>
                <p className="text-sm font-medium">{b.payee}</p>
                <p className="text-muted-foreground text-xs">{b.date}</p>
              </div>
              <SignedAmount amount={b.amount} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ConnectPrompt() {
  return (
    <div className="border-border bg-card/50 rounded-2xl border border-dashed p-8 text-center">
      <p className="text-lg font-semibold">Connect YNAB</p>
      <p className="text-muted-foreground mt-2 text-sm">
        Link your YNAB account to track your spending and budget.
      </p>
      <Link
        to="/settings"
        className="bg-primary text-primary-foreground hover:bg-primary-hover mt-4 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
      >
        Get started <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}
