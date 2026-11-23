import { useCallback, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { RUNTIME_CONFIG } from '@/lib/runtime-config';

// Eksport danych biura dla posła (A13): Edge Function admin-export-data (migracja
// 20261121250000_data_export.sql). Odpowiedź 200 to strumień application/zip (AES-256, hasło
// podaje poseł) - zapisujemy go strumieniowo przez File System Access API (showSaveFilePicker),
// a bez niego (Firefox, Safari) składamy Blob i pobieramy przez link. Błędy: JSON { error }.
// Funkcja działa tylko na powierzchni admin (proxy VPS) i dla Posła/Administratora z 2FA;
// każdy eksport trafia do dziennika zmian (data.export_*).

export const EXPORT_PASSWORD_MIN = 12;
export const EXPORT_PASSWORD_MAX = 128;

/** Prosta ocena siły hasła archiwum: 0 (za krótkie) … 4 (bardzo silne). */
export function exportPasswordStrength(password: string): 0 | 1 | 2 | 3 | 4 {
  const length = [...password].length;
  if (length < EXPORT_PASSWORD_MIN) return 0;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  const unique = new Set(password).size;
  // Powtórzenia ("aaaaaaaaaaaa", "abcabcabcabc") nie dodają siły.
  if (unique < 6) return 1;
  let score = 1;
  if (length >= 16) score += 1;
  if (length >= 20) score += 1;
  if (classes >= 3) score += 1;
  return Math.min(score, 4) as 1 | 2 | 3 | 4;
}

/** Nazwa pliku z nagłówka Content-Disposition (filename* ma pierwszeństwo); bez ścieżek i znaków sterujących. */
export function filenameFromContentDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  let name: string | null = null;
  const extended = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header);
  if (extended) {
    try {
      name = decodeURIComponent(extended[1].trim().replace(/^"|"$/g, ''));
    } catch {
      name = null;
    }
  }
  if (!name) {
    const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/.exec(header);
    name = plain ? (plain[2] ?? plain[1]).trim() : null;
  }
  // eslint-disable-next-line no-control-regex
  const safe = (name ?? '').replace(/[\u0000-\u001f\u007f/\\]/g, '_').replace(/^\.+/, '').trim();
  return safe || fallback;
}

export type ExportPhase = 'idle' | 'waiting' | 'downloading' | 'done';

export interface ExportState {
  phase: ExportPhase;
  /** Pobrane bajty archiwum (strumień, rozmiar całkowity nieznany). */
  bytes: number;
  /** Nazwa zapisanego pliku po sukcesie. */
  fileName: string | null;
}

interface SaveFilePickerWindow {
  showSaveFilePicker?: (options: {
    suggestedName?: string;
    types?: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<{ createWritable: () => Promise<WritableStream<Uint8Array>>; name: string }>;
}

class ExportAbortedError extends Error {
  constructor() {
    super('Eksport anulowany');
    this.name = 'ExportAbortedError';
  }
}

export const isExportAborted = (err: unknown): boolean => err instanceof ExportAbortedError;

async function errorFromResponse(res: Response): Promise<Error> {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
  if (body && typeof body.error === 'string' && body.error) return new Error(body.error);
  if (res.status === 404) {
    return new Error('Eksport niedostępny pod tym adresem - otwórz panel administracyjny na urządzeniu biura.');
  }
  return new Error(`Eksport nie powiódł się (HTTP ${res.status})`);
}

/** Licznik bajtów strumienia (postęp pobierania). */
function countingStream(onBytes: (total: number) => void): TransformStream<Uint8Array, Uint8Array> {
  let total = 0;
  return new TransformStream({
    transform(chunk, controller) {
      total += chunk.byteLength;
      onBytes(total);
      controller.enqueue(chunk);
    },
  });
}

/** Pobranie eksportu: stan, start (po kliknięciu - wymagane przez showSaveFilePicker) i anulowanie. */
export function useDataExport() {
  const [state, setState] = useState<ExportState>({ phase: 'idle', bytes: 0, fileName: null });
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  const start = useCallback(async (password: string, includeFiles: boolean) => {
    const controller = new AbortController();
    abortRef.current = controller;
    const fallbackName = `legatto-eksport-${new Date().toISOString().slice(0, 10)}.zip`;
    const pickerWindow = window as unknown as SaveFilePickerWindow;
    let writable: WritableStream<Uint8Array> | null = null;
    let fileName = fallbackName;

    try {
      // Okno zapisu przed żądaniem: wymaga gestu użytkownika, którego po długim fetchu już nie ma.
      if (pickerWindow.showSaveFilePicker) {
        try {
          const handle = await pickerWindow.showSaveFilePicker({
            suggestedName: fallbackName,
            types: [{ description: 'Archiwum ZIP', accept: { 'application/zip': ['.zip'] } }],
          });
          writable = await handle.createWritable();
          fileName = handle.name;
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') throw new ExportAbortedError();
          throw err;
        }
      }

      setState({ phase: 'waiting', bytes: 0, fileName: null });
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('Sesja wygasła - zaloguj się ponownie');

      const res = await fetch(`${RUNTIME_CONFIG.supabaseUrl}/functions/v1/admin-export-data`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: RUNTIME_CONFIG.supabaseAnonKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password, include_files: includeFiles }),
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!res.ok) throw await errorFromResponse(res);
      if (!res.body) throw new Error('Pusta odpowiedź serwera');
      if (!writable) fileName = filenameFromContentDisposition(res.headers.get('Content-Disposition'), fallbackName);

      setState({ phase: 'downloading', bytes: 0, fileName: null });
      const counted = res.body.pipeThrough(
        countingStream((bytes) => setState((s) => (s.phase === 'downloading' ? { ...s, bytes } : s))),
      );

      if (writable) {
        const target = writable;
        writable = null; // pipeTo zamyka albo przerywa plik sam
        await counted.pipeTo(target, { signal: controller.signal });
      } else {
        const blob = await new Response(counted).blob();
        const url = URL.createObjectURL(new Blob([blob], { type: 'application/zip' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        // Pobieranie startuje asynchronicznie - zwalniamy URL z opóźnieniem.
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
      setState((s) => ({ phase: 'done', bytes: s.bytes, fileName }));
    } catch (err) {
      // Niedokończony plik z okna zapisu jest odrzucany (abort usuwa plik tymczasowy przeglądarki).
      if (writable) await writable.abort().catch(() => undefined);
      setState({ phase: 'idle', bytes: 0, fileName: null });
      if (controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
        throw new ExportAbortedError();
      }
      if (err instanceof TypeError) {
        // fetch/strumień: zerwane połączenie albo przerwany eksport po stronie serwera.
        throw new Error('Połączenie przerwane - archiwum jest niekompletne. Spróbuj ponownie.');
      }
      throw err;
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, []);

  const reset = useCallback(() => setState({ phase: 'idle', bytes: 0, fileName: null }), []);

  return { state, start, cancel, reset };
}
