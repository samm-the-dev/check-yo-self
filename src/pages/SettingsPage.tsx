import { useState, useEffect } from 'react';
import {
  getYnabToken,
  setYnabToken,
  clearYnabToken,
  getPlanId,
  setPlanId,
  fetchPlans,
} from '@/services/ynab';
import { ExternalLink, Check, Trash2 } from 'lucide-react';

export function SettingsPage() {
  const [token, setToken] = useState(getYnabToken() ?? '');
  const [plans, setPlans] = useState<{ id: string; name: string }[]>([]);
  const [selectedPlan, setSelectedPlan] = useState(getPlanId() ?? '');
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isConnected = !!getYnabToken() && !!getPlanId();

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

  // Load plans on mount if already connected
  useEffect(() => {
    if (getYnabToken()) {
      fetchPlans()
        .then(setPlans)
        .catch(() => {});
    }
  }, []);

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
