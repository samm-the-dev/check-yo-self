import { useBudget } from '@/hooks/useBudget';
import { getCategoryTiers } from '@/services/ynab';
import { formatCurrency, todayISO, cn } from '@/lib/utils';
import { BudgetGate } from '@/components/BudgetGate';
import { CategoryBreakdown } from '@/components/CategoryBreakdown';
import { OverspendWarning } from '@/components/OverspendWarning';
import { RefreshCw, TrendingDown, Calendar, ArrowRight, Settings } from 'lucide-react';
import { Link } from 'react-router-dom';

const NUDGE_DISMISSED_KEY = 'cys-tier-nudge-dismissed';

export function DashboardPage() {
  const { connected, syncing, budget, todayTransactions, upcomingBills, refresh, error } =
    useBudget();
  const today = new Date(todayISO() + 'T00:00:00');
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const hasTiers = Object.keys(getCategoryTiers()).length > 0;
  const nudgeDismissed = localStorage.getItem(NUDGE_DISMISSED_KEY) === 'true';

  if (!connected) {
    return (
      <div className="mx-auto max-w-lg space-y-6">
        <h1 className="text-2xl font-bold">{greeting}</h1>
        <ConnectPrompt />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <header className="flex items-start justify-between">
        <div>
          <p className="text-muted-foreground text-sm">{greeting}</p>
          <p className="text-muted-foreground text-sm">
            {today.toLocaleDateString('en-US', {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
            })}
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={syncing}
          className="text-muted-foreground hover:bg-accent hover:text-foreground rounded-lg p-2 transition-colors disabled:opacity-50"
          aria-label="Refresh from YNAB"
        >
          <RefreshCw className={cn('h-4 w-4', syncing && 'animate-spin')} />
        </button>
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
              for a more accurate daily budget.
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

      {budget && (
        <>
          {budget.gate?.blocked ? (
            <BudgetGate gate={budget.gate} />
          ) : (
            <>
              {/* The Number */}
              <section className="border-border bg-card rounded-2xl border p-6 text-center">
                <p className="text-muted-foreground text-sm font-medium">You can spend today</p>
                <p
                  className={cn(
                    'mt-1 text-5xl font-bold tracking-tight',
                    budget.remainingToday < 0
                      ? 'text-destructive'
                      : budget.dailyAmount < 20
                        ? 'text-warning'
                        : 'text-primary',
                  )}
                >
                  {formatCurrency(budget.remainingToday)}
                </p>
                <p className="text-muted-foreground mt-2 text-xs">
                  {formatCurrency(budget.dailyAmount)}/day · {budget.daysRemaining} days left this
                  month
                </p>
              </section>

              {/* Overspend warning */}
              {budget.overspendWarnings && budget.overspendWarnings.length > 0 && (
                <OverspendWarning warnings={budget.overspendWarnings} />
              )}

              {/* Category breakdown */}
              {budget.flexibleBreakdown && (
                <CategoryBreakdown categories={budget.flexibleBreakdown} />
              )}

              {/* Quick stats */}
              <div className="grid grid-cols-2 gap-3">
                <div className="border-border bg-card rounded-xl border p-4">
                  <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
                    <TrendingDown className="h-3.5 w-3.5" />
                    Spent today
                  </div>
                  <p className="mt-1 text-lg font-semibold">{formatCurrency(budget.spentToday)}</p>
                </div>
                <div className="border-border bg-card rounded-xl border p-4">
                  <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
                    <Calendar className="h-3.5 w-3.5" />
                    {budget.daysRemaining} days left
                  </div>
                  <p className="mt-1 text-lg font-semibold">
                    {formatCurrency(budget.totalAvailable)}
                  </p>
                  <p className="text-muted-foreground text-xs">available</p>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* Today's transactions */}
      {todayTransactions.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-muted-foreground text-sm font-medium">Today</h2>
          <div className="space-y-1">
            {todayTransactions.map((t, i) => (
              <div
                key={i}
                className="border-border bg-card flex items-center justify-between rounded-lg border px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium">{t.payee}</p>
                  <p className="text-muted-foreground text-xs">{t.category}</p>
                </div>
                <p className="text-sm font-semibold">{formatCurrency(t.amount)}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Upcoming bills */}
      {upcomingBills.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-muted-foreground text-sm font-medium">Coming up</h2>
          <div className="space-y-1">
            {upcomingBills.slice(0, 3).map((b, i) => (
              <div
                key={i}
                className="border-border bg-card flex items-center justify-between rounded-lg border px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium">{b.payee}</p>
                  <p className="text-muted-foreground text-xs">{b.date}</p>
                </div>
                <p className="text-sm font-semibold">{formatCurrency(b.amount)}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Phase 2: Coaching */}
      <section className="border-primary/30 bg-primary/5 rounded-2xl border border-dashed p-5">
        <p className="text-primary text-sm font-medium">Coaching</p>
        <p className="text-muted-foreground mt-1 text-sm">
          Personalized budget insights will appear here in Phase 2.
        </p>
      </section>
    </div>
  );
}

function ConnectPrompt() {
  return (
    <div className="border-border bg-card/50 rounded-2xl border border-dashed p-8 text-center">
      <p className="text-lg font-semibold">Connect YNAB</p>
      <p className="text-muted-foreground mt-2 text-sm">
        Link your YNAB account to see your daily budget and get coaching insights.
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
