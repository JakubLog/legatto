import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';
import { PasswordSetupScreen } from './PasswordSetupScreen';
import { MfaEnrollmentScreen } from './MfaEnrollmentScreen';
import { MfaChallengeScreen } from './MfaChallengeScreen';

export function ProtectedRoute() {
  const { session, profile, loading, mfa, passwordRecovery } = useAuth();
  const location = useLocation();

  if (loading || mfa.loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (!profile) {
    return <Navigate to="/login?reason=no_profile" replace />;
  }

  if (!profile.is_active) {
    return <Navigate to="/login?reason=inactive" replace />;
  }

  // User zaproszony przez Edge Function albo wchodzący linkiem odzyskania hasła - wymuszamy
  // ustawienie hasła zanim dostanie się do reszty aplikacji.
  if (!profile.password_set || passwordRecovery) {
    return <PasswordSetupScreen />;
  }

  // 2FA wymuszone dla wszystkich. Brak verified factor → enrollment.
  if (!mfa.verifiedTotp) {
    return <MfaEnrollmentScreen />;
  }

  // Ma factor, ale session jest aal1 (po samym zalogowaniu hasłem) → challenge.
  if (mfa.currentLevel === 'aal1' && mfa.nextLevel === 'aal2') {
    return <MfaChallengeScreen />;
  }

  return <Outlet />;
}
