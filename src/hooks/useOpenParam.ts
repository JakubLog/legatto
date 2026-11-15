import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Deep-link do rekordu: `?open=<id>` (używane przez wyszukiwarkę globalną).
 * Zwraca id rekordu do otwarcia i funkcję czyszczącą parametr (bez wpisu w historii).
 */
export function useOpenParam(): [string | null, () => void] {
  const [params, setParams] = useSearchParams();
  const openId = params.get('open');

  const clear = useCallback(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('open');
        return next;
      },
      { replace: true },
    );
  }, [setParams]);

  return [openId, clear];
}
