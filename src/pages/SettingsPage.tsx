import { useState, useEffect } from 'react';
import { useInstallPrompt } from '@/hooks/useInstallPrompt';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db';
import {
  getYnabToken,
  logout,
  initiateLogin,
  getPlanId,
  setPlanId,
  fetchPlans,
  getCategoryTiers,
  setCategoryTiers,
} from '@/services/ynab';
import type { CategoryTier, CategoryTierMap } from '@/types/budget';
import type { CategoryGroupWithCategories } from 'ynab';
import { Check, Trash2, ChevronDown, Download } from 'lucide-react';

import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function SettingsPage() {
  const [plans, setPlans] = useState<{ id: string; name: string }[]>([]);
  const [selectedPlan, setSelectedPlan] = useState(getPlanId() ?? '');
  const [saved, setSaved] = useState(false);
  const [tiers, setTiers] = useState<CategoryTierMap>(getCategoryTiers);
  const [reserve, setReserveState] = useState(() => {
    const raw = localStorage.getItem('cys-reserve-amount');
    return raw ? parseFloat(raw) : 0;
  });
  const [tiersExpanded, setTiersExpanded] = useState(false);
  const { isInstallable, installApp } = useInstallPrompt();

  const updateReserve = (val: number) => {
    setReserveState(val);
    if (val > 0) {
      localStorage.setItem('cys-reserve-amount', String(val));
    } else {
      localStorage.removeItem('cys-reserve-amount');
    }
  };

  const isConnected = !!getYnabToken() && !!getPlanId();

  // Load cached YNAB categories for tier assignment
  const cachedCategories = useLiveQuery(async () => {
    const cached = await db.cache.get('categories');
    if (!cached) return null;
    return JSON.parse(cached.data) as CategoryGroupWithCategories[];
  });

  const handleSelectPlan = (id: string) => {
    setPlanId(id);
    setSelectedPlan(id);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleDisconnect = () => {
    logout();
    window.location.reload();
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
              Connect your YNAB account to start tracking your daily budget.
            </p>
            <button
              onClick={() => initiateLogin()}
              className="bg-primary text-primary-foreground hover:bg-primary-hover rounded-lg px-4 py-2 text-sm font-medium transition-colors"
            >
              Sign in with YNAB
            </button>
          </div>
        )}

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
        <section className="border-border bg-card overflow-hidden rounded-2xl border">
          <button
            onClick={() => setTiersExpanded(!tiersExpanded)}
            className="flex w-full items-center justify-between px-4 py-3 text-left"
          >
            <h2 className="text-lg font-semibold">Category Tiers</h2>
            <ChevronDown
              className={cn(
                'text-muted-foreground h-5 w-5 shrink-0 transition-transform',
                tiersExpanded && 'rotate-180',
              )}
            />
          </button>

          {tiersExpanded && (
            <div className="border-border border-t px-4 pt-3 pb-4">
              <dl className="text-muted-foreground mb-4 space-y-1 text-sm">
                <div>
                  <dt className="text-warning inline font-semibold">Need</dt>
                  {' - '}
                  <dd className="inline">
                    Must be budgeted each month or the weekly budget won't show.
                  </dd>
                </div>
                <div>
                  <dt className="text-primary inline font-semibold">Flex</dt>
                  {' - '}
                  <dd className="inline">
                    Discretionary spending that feeds your weekly budget number.
                  </dd>
                </div>
                <div>
                  <dt className="text-foreground inline font-semibold">Skip</dt>
                  {' - '}
                  <dd className="inline">Not tracked.</dd>
                </div>
              </dl>

              <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5">
                {visibleGroups.map((group) => {
                  const visibleCats = group.categories.filter((c) => !c.hidden && !c.deleted);
                  if (visibleCats.length === 0) return null;

                  const groupTiers = visibleCats.map((c) => tiers[c.id] ?? 'excluded');
                  const allSame = groupTiers.every((t) => t === groupTiers[0]);
                  const groupTier = allSame ? groupTiers[0] : null;

                  return (
                    <div
                      key={group.id}
                      className="col-span-full grid grid-cols-subgrid gap-y-1.5 pt-3 first:pt-0"
                    >
                      {/* Group header */}
                      <h3 className="text-muted-foreground self-center text-xs font-semibold tracking-wider uppercase">
                        {group.name}
                      </h3>
                      <TierToggle
                        value={groupTier}
                        onChange={(tier) =>
                          handleGroupTierChange(
                            visibleCats.map((c) => c.id),
                            tier,
                          )
                        }
                      />

                      {/* Category rows */}
                      {visibleCats.map((cat) => (
                        <div
                          key={cat.id}
                          className="col-span-full grid grid-cols-subgrid items-center"
                        >
                          <span className="min-w-0 truncate text-sm">{cat.name}</span>
                          <TierToggle
                            value={tiers[cat.id] ?? 'excluded'}
                            onChange={(tier) => handleTierChange(cat.id, tier)}
                          />
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Reserve */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Reserve</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Minimum balance you want to keep available (e.g., next rent payment). Shows as a
            reference line on the cashflow chart.
          </p>
        </div>
        <div>
          <div className="border-input flex items-stretch overflow-hidden rounded-lg border">
            <button
              onClick={() => updateReserve(Math.max(0, reserve - 100))}
              className="bg-muted hover:bg-accent text-foreground border-input border-r px-4 text-sm font-semibold transition-colors"
            >
              -100
            </button>
            <div className="relative flex-1">
              <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm">
                $
              </span>
              <input
                type="number"
                value={reserve || ''}
                onChange={(e) => updateReserve(parseFloat(e.target.value) || 0)}
                placeholder="0"
                min="0"
                step="100"
                className="bg-background focus:ring-ring h-full w-full py-2.5 pr-3 pl-7 text-center text-sm font-medium focus:ring-2 focus:outline-none"
              />
            </div>
            <button
              onClick={() => updateReserve(reserve + 100)}
              className="bg-muted hover:bg-accent text-foreground border-input border-l px-4 text-sm font-semibold transition-colors"
            >
              +100
            </button>
          </div>
        </div>
      </section>

      {/* Install */}
      {isInstallable && (
        <button
          onClick={() => void installApp()}
          className="text-muted-foreground hover:text-foreground flex w-full items-center justify-center gap-2 rounded-lg py-3 text-sm transition-colors"
        >
          <Download className="h-4 w-4" />
          Install app
        </button>
      )}

      {/* Footer */}
      <p className="text-muted-foreground text-center text-xs">
        <a
          href={`${import.meta.env.BASE_URL}privacy.html`}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-foreground underline underline-offset-2 transition-colors"
        >
          Privacy Policy
        </a>
      </p>
    </div>
  );
}

const TIER_TOGGLE_OPTIONS: { value: CategoryTier | 'excluded'; label: string }[] = [
  { value: 'necessity', label: 'Need' },
  { value: 'flexible', label: 'Flex' },
  { value: 'excluded', label: 'Skip' },
];

function TierToggle({
  value,
  onChange,
}: {
  value: CategoryTier | 'excluded' | null | undefined;
  onChange: (tier: CategoryTier | 'excluded') => void;
}) {
  return (
    <div className="bg-muted inline-flex shrink-0 rounded-lg p-0.5 text-xs">
      {TIER_TOGGLE_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            'rounded-md px-3 py-1 font-medium transition-all',
            value === opt.value
              ? cn(
                  'shadow-sm',
                  opt.value === 'necessity'
                    ? 'bg-warning/15 text-warning'
                    : opt.value === 'flexible'
                      ? 'bg-primary/15 text-primary'
                      : 'bg-card text-foreground',
                )
              : 'text-muted-foreground/40 hover:text-muted-foreground',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
