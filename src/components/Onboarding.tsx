import { useState } from 'react';
import { ChevronRight, Shield } from 'lucide-react';
import { initiateLogin, getYnabToken, setPlanId, fetchPlans } from '@/services/ynab';

interface OnboardingProps {
  onComplete: () => void;
}

type Step = 'intro' | 'connecting' | 'select-budget';

export function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState<Step>(() => {
    // If we already have a token (OAuth redirect back) but no plan, go straight to connecting
    return getYnabToken() ? 'connecting' : 'intro';
  });
  const [plans, setPlans] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // After OAuth redirect, we have a token — fetch plans and proceed
  const handlePostAuth = async () => {
    setLoading(true);
    setError(null);

    try {
      const fetched = await fetchPlans();
      if (fetched.length === 0) {
        setError('No budgets found. Try signing in again.');
        setLoading(false);
        return;
      }
      if (fetched.length === 1) {
        setPlanId(fetched[0]!.id);
        onComplete();
      } else {
        setPlans(fetched);
        setStep('select-budget');
      }
    } catch {
      setError('Could not connect to YNAB. Try signing in again.');
    } finally {
      setLoading(false);
    }
  };

  // If we landed here with a token already (OAuth callback), auto-fetch plans
  if (step === 'connecting' && !loading && !error && plans.length === 0) {
    handlePostAuth();
  }

  const handleSelectPlan = (id: string) => {
    setPlanId(id);
    onComplete();
  };

  return (
    <div className="mx-auto max-w-lg space-y-6 py-8">
      <header className="text-center">
        <h1 className="font-display text-primary text-3xl font-bold tracking-wide uppercase">
          Check Yo Self!
        </h1>
        <p className="text-muted-foreground mt-2">Budget tracking powered by YNAB</p>
      </header>

      {step === 'intro' && (
        <div className="space-y-6">
          <div className="border-border bg-card space-y-4 rounded-2xl border p-6">
            <p className="text-sm leading-relaxed">
              This app reads your YNAB budget to show you one simple number each morning:{' '}
              <span className="text-primary font-semibold">what you can spend today.</span>
            </p>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Sign in with your YNAB account to get started. Check Yo Self only needs read-only
              access to your budget data.
            </p>
          </div>

          {/* Security note */}
          <div className="border-border bg-card/50 flex gap-3 rounded-xl border p-4">
            <Shield className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-1">
              <p className="text-xs font-medium">About your data</p>
              <p className="text-muted-foreground text-xs leading-relaxed">
                Check Yo Self connects via YNAB&apos;s official OAuth. Your credentials are never
                shared with this app — you sign in directly on YNAB&apos;s site. You can revoke
                access anytime from your YNAB settings.
              </p>
            </div>
          </div>

          <button
            onClick={() => initiateLogin()}
            className="bg-primary text-primary-foreground hover:bg-primary-hover flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium transition-colors"
          >
            Sign in with YNAB
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {step === 'connecting' && (
        <div className="space-y-6">
          <div className="border-border bg-card space-y-4 rounded-2xl border p-6 text-center">
            {loading && (
              <p className="text-muted-foreground text-sm">Connecting to your YNAB account...</p>
            )}
            {error && (
              <div className="space-y-3">
                <p className="text-destructive text-sm">{error}</p>
                <button
                  onClick={() => initiateLogin()}
                  className="bg-primary text-primary-foreground hover:bg-primary-hover rounded-xl px-4 py-2 text-sm font-medium transition-colors"
                >
                  Try again
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {step === 'select-budget' && (
        <div className="space-y-6">
          <div className="border-border bg-card space-y-4 rounded-2xl border p-6">
            <h2 className="font-semibold">Which budget?</h2>
            <p className="text-muted-foreground text-sm">
              You have multiple budgets. Pick the one you want to track.
            </p>
            <div className="space-y-2">
              {plans.map((plan) => (
                <button
                  key={plan.id}
                  onClick={() => handleSelectPlan(plan.id)}
                  className="border-border bg-background hover:bg-accent flex w-full items-center justify-between rounded-lg border px-4 py-3 text-sm transition-colors"
                >
                  {plan.name}
                  <ChevronRight className="text-muted-foreground h-4 w-4" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
