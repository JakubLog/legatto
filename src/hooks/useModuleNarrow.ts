import { useSyncExternalStore } from 'react';
import { APP_MAIN_ID } from '@/components/layout/constants';

// Te same progi co `containers` w tailwind.config.ts (px przy 16px rem).
const BREAKPOINTS = { sm: 640, md: 768, lg: 1024, xl: 1280 } as const;
export type ModuleBreakpoint = keyof typeof BREAKPOINTS;

function mainElement(): HTMLElement | null {
  return document.getElementById(APP_MAIN_ID);
}

function subscribe(onChange: () => void) {
  const main = mainElement();
  if (!main) return () => {};
  const observer = new ResizeObserver(onChange);
  observer.observe(main);
  return () => observer.disconnect();
}

/**
 * Czy obszar modułu (`<main>` w AppShell) jest węższy niż próg - JS-owy odpowiednik `@max-md:` itd.
 * Do decyzji zależnych od miejsca na treść (np. tabela vs karty), które zmieniają się też przy
 * otwartym PoliAI. Decyzje zależne od urządzenia (telefon, dotyk) zostają przy `useIsMobile`.
 */
export function useModuleNarrow(breakpoint: ModuleBreakpoint = 'md'): boolean {
  const limit = BREAKPOINTS[breakpoint];
  return useSyncExternalStore(
    subscribe,
    () => (mainElement()?.clientWidth ?? window.innerWidth) < limit,
    () => false,
  );
}
