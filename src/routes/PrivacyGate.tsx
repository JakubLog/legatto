import type { ReactNode } from 'react';
import { PrivacyProvider, usePrivacy } from '@/contexts/PrivacyContext';
import { PrivacyOverlay } from '@/components/privacy/PrivacyOverlay';

// Tryb prywatny dla tras zalogowanego użytkownika poza AppShell (np. /oauth/consent):
// przy blokadzie treść nie jest renderowana, a PIN odblokowuje ją jak w portalu.
function GateContent({ children }: { children: ReactNode }) {
  const { isLocked } = usePrivacy();
  return isLocked ? null : <>{children}</>;
}

export function PrivacyGate({ children }: { children: ReactNode }) {
  return (
    <PrivacyProvider>
      <GateContent>{children}</GateContent>
      <PrivacyOverlay />
    </PrivacyProvider>
  );
}
