import { useState } from 'react';
import { ExternalLink, Eye, EyeOff, ChevronRight, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';
import { setYnabToken, clearYnabToken, setPlanId, fetchPlans } from '@/services/ynab';

interface OnboardingProps {
  onComplete: () => void;
}

type Step = 'intro' | 'create-token' | 'paste-token' | 'select-budget';

export function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState<Step>('intro');
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [plans, setPlans] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async () => {
    if (!token.trim()) return;
    setLoading(true);
    setError(null);
    setYnabToken(token.trim());

    try {
      const fetched = await fetchPlans();
      if (fetched.length === 0) {
        setError('No budgets found. Double-check your token and try again.');
        clearYnabToken();
        setLoading(false);
        return;
      }
      setPlans(fetched);
      if (fetched.length === 1) {
        // Auto-select single budget and finish
        setPlanId(fetched[0]!.id);
        onComplete();
      } else {
        setStep('select-budget');
      }
    } catch {
      setError('Could not connect to YNAB. Make sure you copied the full token and try again.');
      clearYnabToken();
    } finally {
      setLoading(false);
    }
  };

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
              To connect, you&apos;ll create a Personal Access Token in YNAB. This gives Check Yo
              Self read-only access to your budget data. It takes about 30 seconds.
            </p>
          </div>

          {/* Security note */}
          <div className="border-border bg-card/50 flex gap-3 rounded-xl border p-4">
            <Shield className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-1">
              <p className="text-xs font-medium">About your token</p>
              <p className="text-muted-foreground text-xs leading-relaxed">
                Your token stays on this device and is never sent anywhere except YNAB&apos;s own
                servers. It&apos;s read-only — it can view your budget but can&apos;t move money or
                change anything. You can revoke it anytime from YNAB settings.
              </p>
            </div>
          </div>

          <button
            onClick={() => setStep('create-token')}
            className="bg-primary text-primary-foreground hover:bg-primary-hover flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium transition-colors"
          >
            Let&apos;s connect YNAB
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {step === 'create-token' && (
        <div className="space-y-6">
          <StepIndicator current={1} total={2} />

          <div className="border-border bg-card space-y-4 rounded-2xl border p-6">
            <h2 className="font-semibold">Create your token</h2>
            <ol className="text-muted-foreground space-y-3 text-sm">
              <li className="flex gap-3">
                <StepNumber n={1} />
                <span>
                  Open{' '}
                  <a
                    href="https://app.ynab.com/settings/developer"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary inline-flex items-center gap-1 font-medium underline underline-offset-2"
                  >
                    YNAB Developer Settings
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </span>
              </li>
              <li className="flex gap-3">
                <StepNumber n={2} />
                <span>
                  Under <span className="text-foreground font-medium">Personal Access Tokens</span>,
                  click <span className="text-foreground font-medium">New Token</span>
                </span>
              </li>
              <li className="flex gap-3">
                <StepNumber n={3} />
                <span>Enter your YNAB password when prompted</span>
              </li>
              <li className="flex gap-3">
                <StepNumber n={4} />
                <span>
                  Copy the token that appears —{' '}
                  <span className="text-foreground font-medium">
                    you won&apos;t be able to see it again
                  </span>
                </span>
              </li>
            </ol>
          </div>

          <button
            onClick={() => setStep('paste-token')}
            className="bg-primary text-primary-foreground hover:bg-primary-hover flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium transition-colors"
          >
            I&apos;ve copied my token
            <ChevronRight className="h-4 w-4" />
          </button>

          <button
            onClick={() => setStep('intro')}
            className="text-muted-foreground hover:text-foreground w-full text-center text-xs"
          >
            Back
          </button>
        </div>
      )}

      {step === 'paste-token' && (
        <div className="space-y-6">
          <StepIndicator current={2} total={2} />

          <div className="border-border bg-card space-y-4 rounded-2xl border p-6">
            <h2 className="font-semibold">Paste your token</h2>
            <div className="relative">
              <input
                type={showToken ? 'text' : 'password'}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste your Personal Access Token"
                className="border-input bg-background placeholder:text-muted-foreground focus:ring-ring w-full rounded-lg border px-3 py-2.5 pr-10 text-sm focus:ring-2 focus:outline-none"
                // eslint-disable-next-line jsx-a11y/no-autofocus -- token paste is the sole purpose of this step
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2 rounded p-1"
                aria-label={showToken ? 'Hide token' : 'Show token'}
              >
                {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
          </div>

          <button
            onClick={handleConnect}
            disabled={loading || !token.trim()}
            className="bg-primary text-primary-foreground hover:bg-primary-hover flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium transition-colors disabled:opacity-50"
          >
            {loading ? 'Connecting...' : 'Connect to YNAB'}
          </button>

          <button
            onClick={() => setStep('create-token')}
            className="text-muted-foreground hover:text-foreground w-full text-center text-xs"
          >
            Back
          </button>
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

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center justify-center gap-2">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={cn(
            'h-1.5 rounded-full transition-all',
            i + 1 <= current ? 'bg-primary w-8' : 'bg-border w-4',
          )}
        />
      ))}
    </div>
  );
}

function StepNumber({ n }: { n: number }) {
  return (
    <span className="bg-primary/10 text-primary flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-medium">
      {n}
    </span>
  );
}
