/**
 * apps/web/src/App.tsx
 *
 * Root Application Router with Impeccable Architecture:
 * - 8 Authoritative Screens
 * - Dynamic auth status & role hydration
 * - QueryClientProvider for live caching
 */

import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UserProfile, getStoredUser, setStoredUser, api } from './api/client.js';
import { Layout } from './ui/Layout.js';
import { SignInScreen } from './screens/SignInScreen.js';
import { CockpitScreen } from './screens/CockpitScreen.js';
import { IntakeScreen } from './screens/IntakeScreen.js';
import { InvestigationScreen } from './screens/InvestigationScreen.js';
import { ImpactScreen } from './screens/ImpactScreen.js';
import { RecoveryScreen } from './screens/RecoveryScreen.js';
import { ApprovalsScreen } from './screens/ApprovalsScreen.js';
import { AuditScreen } from './screens/AuditScreen.js';
import { TrackingScreen } from './screens/TrackingScreen.js';
import { DriverScreen } from './screens/DriverScreen.js';
import { WarehouseLayoutScreen } from './screens/WarehouseLayoutScreen.js';
import { ClaimsScreen } from './screens/ClaimsScreen.js';
import { RoleHomeScreen } from './screens/RoleHomeScreen.js';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

export function App() {
  const [user, setUser] = useState<UserProfile | null>(getStoredUser());

  const refreshUser = () => {
    setUser(getStoredUser());
  };

  useEffect(() => {
    // If we have a token, verify and refresh user details from /auth/me
    const stored = getStoredUser();
    if (stored) {
      api.auth.getMe()
        .then((profile) => {
          setStoredUser(profile);
          setUser(profile);
        })
        .catch(() => {
          // Token expired or invalid
        });
    }

    const onExpired = () => {
      setUser(null);
    };

    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Layout user={user} onUserChange={refreshUser}>
          <Routes>
            <Route path="/login" element={<SignInScreen onLoginSuccess={refreshUser} />} />
            <Route path="/" element={<RoleHomeScreen />} />
            <Route path="/cockpit" element={<CockpitScreen />} />
            <Route path="/intake" element={<IntakeScreen />} />
            <Route path="/investigation" element={<InvestigationScreen />} />
            <Route path="/impact" element={<ImpactScreen />} />
            <Route path="/recovery" element={<RecoveryScreen />} />
            <Route path="/approvals" element={<ApprovalsScreen />} />
            <Route path="/audit" element={<AuditScreen />} />
            <Route path="/tracking" element={<TrackingScreen />} />
            <Route path="/driver" element={<DriverScreen />} />
            <Route path="/capacity" element={<WarehouseLayoutScreen />} />
            <Route path="/claims" element={<ClaimsScreen />} />
            {/* Catch-all redirect to Cockpit */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
