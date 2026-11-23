import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { RUNTIME_CONFIG } from '@/lib/runtime-config';

// Cloudflare Turnstile (explicit render). Token weryfikuje public-submit-case po stronie serwera
// (TURNSTILE_SECRET); bez site key formularz nie moze zostac wyslany (serwer fail-closed).

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export const TURNSTILE_SITE_KEY = RUNTIME_CONFIG.turnstileKey;

interface TurnstileRenderOptions {
  sitekey: string;
  language?: string;
  theme?: 'light' | 'dark' | 'auto';
  size?: 'normal' | 'flexible' | 'compact';
  /** Nazwa akcji w tokenie (siteverify zwraca ją w `action`). */
  action?: string;
  callback: (token: string) => void;
  'expired-callback': () => void;
  'error-callback': () => void;
}

interface TurnstileApi {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!scriptPromise) {
    scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SCRIPT_SRC;
      script.async = true;
      script.onload = () => {
        if (window.turnstile) resolve(window.turnstile);
        else reject(new Error('Turnstile niedostepny'));
      };
      script.onerror = () => {
        scriptPromise = null;
        script.remove();
        reject(new Error('Nie udalo sie zaladowac Turnstile'));
      };
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
}

export interface TurnstileHandle {
  /** Nowe wyzwanie - token jest jednorazowy, wiec reset po kazdej probie wysylki. */
  reset: () => void;
}

interface TurnstileWidgetProps {
  /** Nowy token albo null, gdy token wygasl / wystapil blad / reset. */
  onTokenChange: (token: string | null) => void;
  onLoadError?: () => void;
  /** Kolorystyka widżetu - jak szablon strony publicznej. */
  theme: 'light' | 'dark';
  /** Site key; domyślnie z konfiguracji runtime SPA. Strona statyczna podaje własny (site-config). */
  siteKey?: string;
}

export const TurnstileWidget = forwardRef<TurnstileHandle, TurnstileWidgetProps>(function TurnstileWidget(
  { onTokenChange, onLoadError, theme, siteKey = TURNSTILE_SITE_KEY },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  // Callbacki przez ref - widget renderujemy raz, a rodzic moze podac nowe funkcje.
  const onTokenChangeRef = useRef(onTokenChange);
  const onLoadErrorRef = useRef(onLoadError);
  onTokenChangeRef.current = onTokenChange;
  onLoadErrorRef.current = onLoadError;

  useImperativeHandle(ref, () => ({
    reset: () => {
      onTokenChangeRef.current(null);
      if (widgetIdRef.current && window.turnstile) window.turnstile.reset(widgetIdRef.current);
    },
  }));

  useEffect(() => {
    let cancelled = false;
    loadTurnstile()
      .then((turnstile) => {
        if (cancelled || !containerRef.current) return;
        widgetIdRef.current = turnstile.render(containerRef.current, {
          sitekey: siteKey,
          language: 'pl',
          theme,
          size: 'flexible',
          action: 'submit_case',
          callback: (token) => onTokenChangeRef.current(token),
          'expired-callback': () => onTokenChangeRef.current(null),
          'error-callback': () => onTokenChangeRef.current(null),
        });
      })
      .catch(() => {
        if (!cancelled) onLoadErrorRef.current?.();
      });
    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) window.turnstile.remove(widgetIdRef.current);
      widgetIdRef.current = null;
    };
  }, [theme, siteKey]);

  return <div ref={containerRef} className="h-[65px] w-full rounded-lg bg-cream" />;
});
