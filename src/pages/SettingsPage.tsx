import { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db';
import {
  getYnabToken,
  setYnabToken,
  clearYnabToken,
  getPlanId,
  setPlanId,
  fetchPlans,
  getCategoryTiers,
  setCategoryTiers,
} from '@/services/ynab';
import type { CategoryTier, CategoryTierMap } from '@/types/budget';
import type { CategoryGroupWithCategories } from 'ynab';
import { ExternalLink, Check, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const TIER_OPTIONS: { value: CategoryTier | 'excluded'; label: string }[] = [
  { value: 'necessity', label: 'Necessity' },
  { value: 'flexible', label: 'Flexible' },
  { value: 'excluded', label: '\u2014' },
];

export function SettingsPage() {
  const [token, setToken] = useState(getYnabToken() ?? '');
  const [plans, setPlans] = useState<{ id: string; name: string }[]>([]);
  const [selectedPlan, setSelectedPlan] = useState(getPlanId() ?? '');
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tiers, setTiers] = useState<CategoryTierMap>(getCategoryTiers);

  const isConnected = !!getYnabToken() && !!getPlanId();

  // Load cached YNAB categories for tier assignment
  const cachedCategories = useLiveQuery(async () => {
    const cached = await db.cache.get('categories');
    if (!cached) return null;
    return JSON.parse(cached.data) as CategoryGroupWithCategories[];
  });

  const handleSaveToken = async () => {
    if (!token.trim()) return;
    setLoading(true);
    setError(null);
    setYnabToken(token.trim());

    try {
      const fetched = await fetchPlans();
      if (fetched.length === 0) {
        setError('No budgets found. Check your token and try again.');
        clearYnabToken();
        return;
      }
      setPlans(fetched);
      // Auto-select if only one budget
      if (fetched.length === 1) {
        setPlanId(fetched[0]!.id);
        setSelectedPlan(fetched[0]!.id);
      }
    } catch {
      setError('Could not connect to YNAB. Check your token and try again.');
      clearYnabToken();
    } finally {
      setLoading(false);
    }
  };

  const handleSelectPlan = (id: string) => {
    setPlanId(id);
    setSelectedPlan(id);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleDisconnect = () => {
    clearYnabToken();
    setToken('');
    setPlans([]);
    setSelectedPlan('');
  };

  const handleTierChange = (categoryId: string, tier: CategoryTier | 'excluded') => {
    const next = { ...tiers };
    if (tier === 'excluded') {
      delete next[categoryId];
    } else {
      next[categoryId] = tier;
    }
    setTiers(next);
    setCategoryTiers(next);
  };

  const handleGroupTierChange = (categoryIds: string[], tier: CategoryTier | 'excluded') => {
    const next = { ...tiers };
    for (const id of categoryIds) {
      if (tier === 'excluded') {
        delete next[id];
      } else {
        next[id] = tier;
      }
    }
    setTiers(next);
    setCategoryTiers(next);
    toast.success('Category tiers updated');
  };

  // Load plans on mount if already connected
  useEffect(() => {
    if (getYnabToken()) {
      fetchPlans()
        .then(setPlans)
        .catch(() => {});
    }
  }, []);

  // Filter visible category groups (skip internal/hidden)
  const visibleGroups = cachedCategories?.filter(
    (g) => !g.hidden && g.name !== 'Internal Master Category',
  );

  return (
    <div className="mx-auto max-w-lg space-y-8">
      <h1 className="text-2xl font-bold">Settings</h1>

      {/* YNAB Connection */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">YNAB Connection</h2>

        {isConnected ? (
          <div className="border-positive/30 bg-positive/5 rounded-xl border p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Check className="text-positive h-4 w-4" />
                <p className="text-sm font-medium">Connected to YNAB</p>
              </div>
              <button
                onClick={handleDisconnect}
                className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive rounded-lg p-2 transition-colors"
                aria-label="Disconnect YNAB"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            {plans.length > 0 && (
              <p className="text-muted-foreground mt-1 text-xs">
                Budget: {plans.find((p) => p.id === selectedPlan)?.name ?? 'Unknown'}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-muted-foreground text-sm">
              Enter your YNAB Personal Access Token to connect. You can create one in{' '}
              <a
                href="https://app.ynab.com/settings/developer"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary inline-flex items-center gap-1 underline underline-offset-2"
              >
                YNAB Settings <ExternalLink className="h-3 w-3" />
              </a>
            </p>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste your Personal Access Token"
              className="border-input bg-background placeholder:text-muted-foreground focus:ring-ring w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
            />
            <button
              onClick={handleSaveToken}
              disabled={loading || !token.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary-hover rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
            >
              {loading ? 'Connecting...' : 'Connect'}
            </button>
          </div>
        )}

        {error && <p className="text-destructive text-sm">{error}</p>}

        {/* Budget selection (if multiple) */}
        {plans.length > 1 && (
          <div className="space-y-2">
            <span className="text-sm font-medium">Select Budget</span>
            <div className="space-y-1">
              {plans.map((plan) => (
                <button
                  key={plan.id}
                  onClick={() => handleSelectPlan(plan.id)}
                  className={`w-full rounded-lg border px-4 py-3 text-left text-sm transition-colors ${
                    selectedPlan === plan.id
                      ? 'border-primary bg-primary/10 font-medium'
                      : 'border-border bg-card hover:bg-accent'
                  }`}
                >
                  {plan.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {saved && <p className="text-positive text-sm">Saved!</p>}
      </section>

      {/* Category Tiers */}
      {isConnected && visibleGroups && visibleGroups.length > 0 && (
        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Category Tiers</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Mark categories as <strong>Necessity</strong> (must be budgeted monthly) or{' '}
              <strong>Flexible</strong> (feeds your daily spending amount). Unmarked categories are
              excluded.
            </p>
          </div>

          <div className="space-y-6">
            {visibleGroups.map((group) => {
              const visibleCats = group.categories.filter((c) => !c.hidden && !c.deleted);
              if (visibleCats.length === 0) return null;

              return (
                <div
                  key={group.id}
                  className="grid grid-cols-[1fr_repeat(3,4.5rem)] items-center gap-x-1.5 gap-y-1.5"
                >
                  {/* Group header row */}
                  <h3 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                    {group.name}
                  </h3>
                  {TIER_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() =>
                        handleGroupTierChange(
                          visibleCats.map((c) => c.id),
                          opt.value,
                        )
                      }
                      className="text-muted-foreground/60 hover:bg-muted rounded-md py-0.5 text-center text-xs transition-colors"
                      aria-label={`Set all ${group.name} to ${opt.value}`}
                    >
                      {opt.label}
                    </button>
                  ))}

                  {/* Category rows */}
                  {visibleCats.map((cat) => {
                    const currentTier = tiers[cat.id] ?? 'excluded';
                    return (
                      <div
                        key={cat.id}
                        className="col-span-full grid grid-cols-subgrid items-center"
                      >
                        <span className="border-border bg-card rounded-lg border px-3 py-2 text-sm">
                          {cat.name}
                        </span>
                        {TIER_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            onClick={() => handleTierChange(cat.id, opt.value)}
                            className={cn(
                              'rounded-md py-1 text-center text-xs font-medium transition-colors',
                              currentTier === opt.value
                                ? opt.value === 'necessity'
                                  ? 'bg-warning/20 text-warning'
                                  : opt.value === 'flexible'
                                    ? 'bg-primary/20 text-primary'
                                    : 'bg-muted text-muted-foreground'
                                : 'text-muted-foreground/60 hover:bg-muted',
                            )}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Check-in Reminders */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Check-in Reminders</h2>
        <p className="text-muted-foreground text-sm">
          Set morning and evening check-in times. Calendar reminders nudge you to open the app.
        </p>
        {/* TODO: Phase 2 — Time pickers + Google Calendar integration */}
        <div className="border-border bg-card/50 text-muted-foreground rounded-lg border border-dashed p-4 text-center text-sm">
          Coming in Phase 2
        </div>
      </section>

      {/* Coaching API Key */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Coaching</h2>
        <p className="text-muted-foreground text-sm">
          Budget coaching powered by Claude. Requires an Anthropic API key.
        </p>
        {/* TODO: Phase 2 — Anthropic API key input + coaching preferences */}
        <div className="border-border bg-card/50 text-muted-foreground rounded-lg border border-dashed p-4 text-center text-sm">
          Coming in Phase 2
        </div>
      </section>
    </div>
  );
}
