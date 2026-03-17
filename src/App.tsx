import { useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Toaster } from 'sonner';
import { Layout } from '@/components/Layout';
import { Onboarding } from '@/components/Onboarding';
import { DashboardPage } from '@/pages/DashboardPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { getYnabToken, getPlanId } from '@/services/ynab';

export default function App() {
  const [ready, setReady] = useState(!!getYnabToken() && !!getPlanId());

  if (!ready) {
    return (
      <div className="bg-background text-foreground min-h-dvh px-4">
        <Onboarding onComplete={() => setReady(true)} />
        <Toaster position="top-center" />
      </div>
    );
  }

  return (
    <BrowserRouter>
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
