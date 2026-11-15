import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePrivacy } from '@/contexts/PrivacyContext';

interface SearchContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const SearchContext = createContext<SearchContextValue | null>(null);

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * Stan palety wyszukiwania + globalne skróty: Ctrl/Cmd+K (zawsze) i "/" (poza polami
 * tekstowymi i otwartymi dialogami). Nieaktywne w trybie prywatnym (ekran zablokowany).
 */
export function SearchProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { isLocked } = usePrivacy();

  useEffect(() => {
    if (isLocked) setOpen(false);
  }, [isLocked]);

  useEffect(() => {
    if (isLocked) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
        return;
      }
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !isEditableTarget(e.target)) {
        if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"]')) return;
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isLocked]);

  const value = useMemo(() => ({ open, setOpen }), [open]);
  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>;
}

export function useSearch(): SearchContextValue {
  const ctx = useContext(SearchContext);
  if (!ctx) throw new Error('useSearch musi być użyte wewnątrz <SearchProvider>');
  return ctx;
}
