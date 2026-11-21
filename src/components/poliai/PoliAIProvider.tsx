import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { canWrite } from '@/lib/permissions';
import { INSTANCE } from '@/lib/instance';
import { usePoliAI, type PoliAIConversation } from '@/hooks/usePoliAI';

interface PoliAIPanelContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

// Dwa konteksty: stan panelu (TopBar, układ) nie przerysowuje się przy każdym tokenie strumienia.
const PoliAIPanelContext = createContext<PoliAIPanelContextValue | null>(null);
const PoliAIConversationContext = createContext<PoliAIConversation | null>(null);

function PoliAIEnabledProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const conversation = usePoliAI();
  const toggle = useCallback(() => setOpen((prev) => !prev), []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggle]);

  const panel = useMemo(() => ({ open, setOpen, toggle }), [open, toggle]);
  return (
    <PoliAIPanelContext.Provider value={panel}>
      <PoliAIConversationContext.Provider value={conversation}>{children}</PoliAIConversationContext.Provider>
    </PoliAIPanelContext.Provider>
  );
}

/**
 * Asystent PoliAI: stan panelu + rozmowa (w pamięci, przetrwa nawigację) i skrót Ctrl/Cmd+J.
 * Tylko gdy operator włączył AI (INSTANCE_AI=on) i dla ról z zapisem (Poseł, Administrator,
 * Pracownik) - w pozostałych przypadkach same dzieci: bez panelu, przycisku i skrótu.
 */
export function PoliAIProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  if (!INSTANCE.ai || !canWrite(profile?.role)) return <>{children}</>;
  return <PoliAIEnabledProvider>{children}</PoliAIEnabledProvider>;
}

/** Stan panelu albo `null`, gdy PoliAI jest wyłączony na instancji lub niedostępny dla roli użytkownika. */
export function usePoliAIPanel(): PoliAIPanelContextValue | null {
  return useContext(PoliAIPanelContext);
}

export function usePoliAIConversation(): PoliAIConversation {
  const ctx = useContext(PoliAIConversationContext);
  if (!ctx) throw new Error('usePoliAIConversation musi być użyte wewnątrz <PoliAIProvider>');
  return ctx;
}
