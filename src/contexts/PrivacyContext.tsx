import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { isPrivacyLocked, setPrivacyLocked, subscribePrivacyLock } from '@/lib/privacyLock';

interface PrivacyContextValue {
  isPinSet: boolean;
  isLocked: boolean;
  lock: () => void;
  unlock: () => void;
}

const PrivacyContext = createContext<PrivacyContextValue | undefined>(undefined);

export function PrivacyProvider({ children }: { children: ReactNode }) {
  const { user, profile } = useAuth();
  const userId = user?.id ?? null;
  const isPinSet = profile?.has_privacy_pin === true;
  // Profil zaladowany dla biezacego usera - dopiero wtedy wiadomo czy PIN istnieje.
  const profileLoaded = profile != null && profile.id === userId;

  // Synchronicznie z localStorage - bez klatki, w ktorej tresc bylaby widoczna przed blokada.
  const persistedLocked = useSyncExternalStore(subscribePrivacyLock, () =>
    userId ? isPrivacyLocked(userId) : false,
  );

  // Brak PIN-u = nie ma czym odblokowac, wiec nie zaslaniamy. Flagi w localStorage NIE czyscimy
  // tutaj: lock() tuz po pierwszym ustawieniu PIN-u renderuje sie synchronicznie (external store),
  // zanim profil z has_privacy_pin=true trafi do stanu - efekt czyszczacy zdjalby wtedy blokade.
  // Flage zdejmuje jawnie unlock() (poprawny PIN, usuniecie PIN-u, wylogowanie).
  const noPinToUnlock = profileLoaded && !isPinSet;
  const isLocked = persistedLocked && !noPinToUnlock;

  const lock = useCallback(() => {
    if (userId) setPrivacyLocked(userId, true);
  }, [userId]);

  const unlock = useCallback(() => {
    if (userId) setPrivacyLocked(userId, false);
  }, [userId]);

  const value = useMemo<PrivacyContextValue>(
    () => ({ isPinSet, isLocked, lock, unlock }),
    [isPinSet, isLocked, lock, unlock],
  );

  return <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>;
}

export function usePrivacy() {
  const ctx = useContext(PrivacyContext);
  if (!ctx) throw new Error('usePrivacy musi byc uzyty wewnatrz <PrivacyProvider>');
  return ctx;
}
