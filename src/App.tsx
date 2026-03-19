import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Toaster } from 'sonner';
import { Layout } from '@/components/Layout';
import { Onboarding } from '@/components/Onboarding';
import { DashboardPage } from '@/pages/DashboardPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { getYnabToken, getPlanId, extractTokenFromHash, setOnUnauthorized } from '@/services/ynab';

export default function App() {
  const [ready, setReady] = useState(() => !!getYnabToken() && !!getPlanId());

  // Extract OAuth token from URL hash on mount (in useEffect to avoid
  // side-effects during render, which StrictMode may invoke twice).
  useEffect(() => {
    const token = extractTokenFromHash();
    if (token) setReady(true);
  }, []);

  // Register 401 handler so the app returns to login when token is revoked/expired
  useEffect(() => {
    setOnUnauthorized(() => setReady(false));
  }, []);

  if (!ready) {
    return (
      <div className="bg-background text-foreground min-h-dvh px-4">
        <Onboarding onComplete={() => setReady(true)} />
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
