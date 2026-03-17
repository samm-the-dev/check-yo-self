import { Outlet, Link, useLocation } from 'react-router-dom';
import { Home, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { to: '/', icon: Home, label: 'Today' },
  { to: '/settings', icon: Settings, label: 'Settings' },
] as const;

export function Layout() {
  const { pathname } = useLocation();

  return (
    <div className="bg-background text-foreground flex min-h-dvh flex-col">
      <main className="flex-1 px-4 pt-6 pb-20">
        <Outlet />
      </main>

      {/* Bottom tab bar — mobile-first PWA nav */}
      <nav className="border-border bg-background/80 fixed inset-x-0 bottom-0 z-50 border-t backdrop-blur-lg">
        <div className="mx-auto flex max-w-lg items-center justify-around py-2">
          {NAV_ITEMS.map(({ to, icon: Icon, label }) => {
            const active = to === '/' ? pathname === '/' : pathname.startsWith(to);
            return (
              <Link
                key={to}
                to={to}
                className={cn(
                  'flex flex-col items-center gap-0.5 rounded-lg px-3 py-1.5 text-xs transition-colors',
                  active ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
                )}
                aria-current={active ? 'page' : undefined}
              >
                <Icon className="h-5 w-5" />
                <span>{label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
