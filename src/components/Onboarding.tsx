import { ChevronRight, Shield } from 'lucide-react';
import { initiateLogin } from '@/services/ynab';

export function Onboarding() {
  return (
    <div className="mx-auto max-w-lg space-y-6 py-8">
      <header className="text-center">
        <h1 className="font-display text-primary text-3xl font-bold tracking-wide uppercase">
          Check Yo Self!
        </h1>
        <p className="text-muted-foreground mt-2">Budget tracking powered by YNAB</p>
      </header>

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

        <p className="text-muted-foreground text-center text-xs">
          By signing in you agree to our{' '}
          <a
            href={`${import.meta.env.BASE_URL}privacy.html`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2"
          >
            Privacy Policy
          </a>
        </p>
      </div>
    </div>
  );
}
