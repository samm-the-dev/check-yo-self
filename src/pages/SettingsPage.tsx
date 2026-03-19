import { useState } from 'react';
import { useInstallPrompt } from '@/hooks/useInstallPrompt';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db';
import {
  getYnabToken,
  logout,
  initiateLogin,
  getPlanId,
  getCategoryOverrides,
  setCategoryOverrides,
} from '@/services/ynab';
import { deriveTierFromGoal } from '@/lib/budget-math';
import type { CategoryOverrides } from '@/types/budget';
import type { CategoryGroupWithCategories } from 'ynab';
import { Check, Trash2, ChevronDown, Download } from 'lucide-react';

import { cn } from '@/lib/utils';

type TierValue = 'necessity' | 'flexible' | 'skip';

export function SettingsPage() {
  const [overrides, setOverrides] = useState<CategoryOverrides>(getCategoryOverrides);
  const [reserve, setReserveState] = useState(() => {
    const raw = localStorage.getItem('cys-reserve-amount');
    return raw ? parseFloat(raw) : 0;
  });
  const [overridesExpanded, setOverridesExpanded] = useState(false);
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

  // Load cached YNAB categories for override display
  const cachedCategories = useLiveQuery(async () => {
    const cached = await db.cache.get('categories');
    if (!cached) return null;
    return JSON.parse(cached.data) as CategoryGroupWithCategories[];
  });

  const handleDisconnect = async () => {
    try {
      await logout();
    } finally {
      window.location.reload();
    }
  };

  const handleOverrideChange = (categoryId: string, tier: TierValue | 'auto') => {
    const next = { ...overrides };
    if (tier === 'auto') {
      delete next[categoryId];
    } else {
      next[categoryId] = tier;
    }
    setOverrides(next);
    setCategoryOverrides(next);
  };

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
      </section>

      {/* Category Overrides */}
      {isConnected && visibleGroups && visibleGroups.length > 0 && (
        <section className="border-border bg-card overflow-hidden rounded-2xl border">
          <button
            onClick={() => setOverridesExpanded(!overridesExpanded)}
            className="flex w-full items-center justify-between px-4 py-3 text-left"
          >
            <h2 className="text-lg font-semibold">Category Overrides</h2>
            <ChevronDown
              className={cn(
                'text-muted-foreground h-5 w-5 shrink-0 transition-transform',
                overridesExpanded && 'rotate-180',
              )}
            />
          </button>

          {overridesExpanded && (
            <div className="border-border border-t px-4 pt-3 pb-4">
              <p className="text-muted-foreground mb-4 text-sm">
                Tiers are derived from YNAB goals. Override categories where the default doesn't
                match your intent.
              </p>

              <div className="space-y-4">
                {visibleGroups.map((group) => {
                  const visibleCats = group.categories.filter((c) => !c.hidden && !c.deleted);
                  if (visibleCats.length === 0) return null;

                  return (
                    <div key={group.id}>
                      <h3 className="text-muted-foreground mb-1.5 text-xs font-semibold tracking-wider uppercase">
                        {group.name}
                      </h3>
                      <div className="space-y-1">
                        {visibleCats.map((cat) => {
                          const derived = deriveTierFromGoal({
                            goalType: cat.goal_type ?? null,
                            goalNeedsWholeAmount: cat.goal_needs_whole_amount ?? null,
                            goalSnoozed: cat.goal_snoozed_at != null,
                          });
                          const override = overrides[cat.id];
                          const effectiveTier = override
                            ? override === 'skip'
                              ? undefined
                              : override
                            : derived;

                          return (
                            <div
                              key={cat.id}
                              className="flex items-center justify-between gap-2 py-1"
                            >
                              <div className="min-w-0 flex-1">
                                <span className="truncate text-sm">{cat.name}</span>
                                <DerivedBadge derived={derived} hasOverride={!!override} />
                              </div>
                              <OverrideToggle
                                derived={derived}
                                override={override}
                                effectiveTier={effectiveTier}
                                onChange={(tier) => handleOverrideChange(cat.id, tier)}
                              />
                            </div>
                          );
                        })}
                      </div>
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

function DerivedBadge({
  derived,
  hasOverride,
}: {
  derived: 'flexible' | 'necessity' | undefined;
  hasOverride: boolean;
}) {
  if (hasOverride) {
    return (
      <span className="text-muted-foreground/60 ml-1.5 text-xs">
        (was: {derived ? (derived === 'necessity' ? 'Need' : 'Flex') : 'Excluded'})
      </span>
    );
  }
  return null;
}

const OVERRIDE_OPTIONS: { value: TierValue | 'auto'; label: string }[] = [
  { value: 'necessity', label: 'Need' },
  { value: 'flexible', label: 'Flex' },
  { value: 'skip', label: 'Skip' },
];

function OverrideToggle({
  derived,
  override,
  effectiveTier,
  onChange,
}: {
  derived: 'flexible' | 'necessity' | undefined;
  override: TierValue | undefined;
  effectiveTier: 'flexible' | 'necessity' | undefined;
  onChange: (tier: TierValue | 'auto') => void;
}) {
  return (
    <div className="bg-muted inline-flex shrink-0 rounded-lg p-0.5 text-xs">
      {OVERRIDE_OPTIONS.map((opt) => {
        // Determine if this button represents the current effective state
        const isActive =
          override === opt.value ||
          (!override &&
            ((opt.value === 'skip' && derived === undefined) ||
              (opt.value !== 'skip' && derived === opt.value)));

        return (
          <button
            key={opt.value}
            onClick={() => {
              // If clicking what's already the derived default, clear the override
              if (opt.value === 'skip' && derived === undefined && override) {
                onChange('auto');
              } else if (opt.value !== 'skip' && opt.value === derived && override) {
                onChange('auto');
              } else if (isActive && !override) {
                // Already at derived default, no-op
              } else {
                onChange(opt.value);
              }
            }}
            className={cn(
              'rounded-md px-3 py-1 font-medium transition-all',
              isActive
                ? cn(
                    'shadow-sm',
                    effectiveTier === 'necessity'
                      ? 'bg-warning/15 text-warning'
                      : effectiveTier === 'flexible'
                        ? 'bg-primary/15 text-primary'
                        : 'bg-card text-foreground',
                    override && 'ring-1 ring-offset-1 ring-offset-transparent',
                    override &&
                      (effectiveTier === 'necessity'
                        ? 'ring-warning/30'
                        : effectiveTier === 'flexible'
                          ? 'ring-primary/30'
                          : 'ring-border'),
                  )
                : 'text-muted-foreground/40 hover:text-muted-foreground',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
