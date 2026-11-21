import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';

import { AuthProvider } from '@/contexts/AuthContext';
import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { PrivacyGate } from '@/routes/PrivacyGate';
import { RoleGuard } from '@/routes/RoleGuard';
import { AppShell } from '@/components/layout/AppShell';
import { DesktopOnlyRoute } from '@/components/layout/DesktopOnlyRoute';
import { PublicLayout } from '@/components/layout/PublicLayout';
import { Toaster } from '@/components/ui/sonner';
import { isSupabaseConfigured } from '@/integrations/supabase/client';
import { isStandalonePwa } from '@/lib/pwa';
import { INSTANCE } from '@/lib/instance';

const HomePage = lazy(() => import('@/pages/HomePage'));
const Login = lazy(() => import('@/pages/Login'));
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const Kontakty = lazy(() => import('@/pages/Kontakty'));
const Sprawy = lazy(() => import('@/pages/Sprawy'));
const Kalendarz = lazy(() => import('@/pages/Kalendarz'));
const Teren = lazy(() => import('@/pages/Teren'));
const Interpelacje = lazy(() => import('@/pages/Interpelacje'));
const InterpellationDetail = lazy(() => import('@/pages/InterpellationDetail'));
const Dokumenty = lazy(() => import('@/pages/Dokumenty'));
const DokumentDetail = lazy(() => import('@/pages/DokumentDetail'));
const Budzet = lazy(() => import('@/pages/Budzet'));
const Profil = lazy(() => import('@/pages/Profil'));
const Kosz = lazy(() => import('@/pages/Kosz'));
const AdminUsers = lazy(() => import('@/pages/admin/Users'));
const AdminOffices = lazy(() => import('@/pages/admin/Offices'));
const AdminObowiazki = lazy(() => import('@/pages/admin/Obowiazki'));
const AdminStronaGlowna = lazy(() => import('@/pages/admin/StronaGlowna'));
const PulsBiura = lazy(() => import('@/pages/PulsBiura'));
const AdminAuditLog = lazy(() => import('@/pages/admin/AuditLog'));
const AdminIntegracje = lazy(() => import('@/pages/admin/Integracje'));
const AdminIntegracjeIndex = lazy(() => import('@/pages/admin/IntegracjeIndex'));
const AdminIntegracjeGetResponse = lazy(() => import('@/pages/admin/IntegracjeGetResponse'));
const AdminIntegracjeIcs = lazy(() => import('@/pages/admin/IntegracjeIcs'));
const AdminIntegracjeAi = lazy(() => import('@/pages/admin/IntegracjeAi'));
const AdminIntegracjePowiadomienia = lazy(() => import('@/pages/admin/IntegracjePowiadomienia'));
const OAuthConsent = lazy(() => import('@/pages/OAuthConsent'));
const ConfigError = lazy(() => import('@/pages/ConfigError'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function Fallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

export default function App() {
  if (!isSupabaseConfigured) {
    return (
      <Suspense fallback={<Fallback />}>
        <ConfigError />
      </Suspense>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Suspense fallback={<Fallback />}>
            <Routes>
              {/* Publiczne strony - strona główna + (w przyszłości) /zgłoś, /aktualności */}
              <Route element={<PublicLayout />}>
                <Route index element={<HomePage />} />
                {/* W Fazie 7: <Route path="zgłoś" element={<ZglosFormularz />} /> */}
              </Route>

              {/* Logowanie - bez layoutu */}
              <Route path="/login" element={<Login />} />

              {/* OAuth consent — auth obsługiwana wewnątrz komponentu; tryb prywatny zasłania też zgodę.
                  Tylko z włączonym AI (INSTANCE_AI=on): OAuth służy wyłącznie klientom MCP. */}
              {INSTANCE.ai && (
                <Route path="/oauth/consent" element={<PrivacyGate><OAuthConsent /></PrivacyGate>} />
              )}

              {/* Portal biura - chroniony, pod /biuro/* */}
              <Route path="/biuro" element={<ProtectedRoute />}>
                <Route element={<AppShell />}>
                  <Route index element={<Dashboard />} />
                  <Route path="sprawy" element={<Sprawy />} />
                  <Route path="kontakty" element={<Kontakty />} />
                  <Route path="kalendarz" element={<Kalendarz />} />
                  <Route path="teren" element={<Teren />} />
                  <Route path="interpelacje" element={<Interpelacje />} />
                  <Route path="interpelacje/:id" element={<InterpellationDetail />} />
                  <Route path="dokumenty" element={<Dokumenty />} />
                  <Route path="dokumenty/:id" element={<DokumentDetail />} />
                  <Route path="budzet" element={<Budzet />} />
                  <Route path="profil" element={<Profil />} />
                  <Route path="kosz" element={<Kosz />} />

                  {/* Integracje: każda rola; kafelki według roli. */}
                  <Route path="admin/integracje" element={<AdminIntegracjeIndex />} />

                  {/* Konfiguracja MCP: Poseł/Administrator + Pracownik (nie Asystent); tylko z włączonym AI */}
                  {INSTANCE.ai && (
                    <Route element={<RoleGuard allow={['posel', 'administrator', 'pracownik']} />}>
                      <Route element={<DesktopOnlyRoute />}>
                        <Route path="admin/integracje/mcp" element={<AdminIntegracje />} />
                      </Route>
                    </Route>
                  )}

                  {/* Admin panel: tylko Poseł i Administrator */}
                  <Route element={<RoleGuard allow={['posel', 'administrator']} />}>
                    <Route path="puls" element={<PulsBiura />} />
                    <Route path="admin/użytkownicy" element={<AdminUsers />} />
                    <Route path="admin/biura" element={<AdminOffices />} />
                    <Route path="admin/strona-główna" element={<AdminStronaGlowna />} />
                    {/* Konfiguracja i dzienniki - na telefonie tylko informacja "dostępne na komputerze" */}
                    <Route element={<DesktopOnlyRoute />}>
                      <Route path="admin/obowiązki" element={<AdminObowiazki />} />
                      <Route path="admin/audit" element={<AdminAuditLog />} />
                      <Route
                        path="admin/integracje/getresponse"
                        element={<AdminIntegracjeGetResponse />}
                      />
                      <Route path="admin/integracje/ics" element={<AdminIntegracjeIcs />} />
                      {INSTANCE.ai && <Route path="admin/integracje/ai" element={<AdminIntegracjeAi />} />}
                      <Route path="admin/integracje/powiadomienia" element={<AdminIntegracjePowiadomienia />} />
                    </Route>
                  </Route>
                </Route>
              </Route>

              <Route path="*" element={<Navigate to={isStandalonePwa() ? '/biuro' : '/'} replace />} />
            </Routes>
          </Suspense>
          <Toaster />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
