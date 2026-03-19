import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Toaster } from 'sonner';
import { Layout } from '@/components/Layout';
import { Onboarding } from '@/components/Onboarding';
import { DashboardPage } from '@/pages/DashboardPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { getYnabToken, getPlanId, extractTokenFromHash, setOnUnauthorized } from '@/services/ynab';

// Extract OAuth token from the URL hash before React mounts.
// Runs once at module load — no StrictMode double-invoke, no effect needed.
extractTokenFromHash();

export default function App() {
  const [ready, setReady] = useState(() => !!getYnabToken() && !!getPlanId());

  // Register 401 handler so the app returns to login when token is revoked/expired
  useEffect(() => {
    setOnUnauthorized(() => setReady(false));
  }, []);

  if (!ready) {
    return (
      <div className="bg-background text-foreground min-h-dvh px-4">
        <Onboarding />
        <Toaster position="top-center" />
      </div>
    );
  }

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
      <Toaster position="top-center" />
    </BrowserRouter>
  );
}
