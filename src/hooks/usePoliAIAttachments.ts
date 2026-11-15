import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { readHttpError } from '@/hooks/usePoliAI';
import { POLIAI_ATTACHMENTS_BUCKET, type AttachmentBlock, type AttachmentKind } from '@/lib/poliai';
import { assertFileSize, detectKind, MAX_FILES, PoliAIFileError, processFile } from '@/lib/poliaiFiles';

export type PoliAIAttachmentStatus = 'processing' | 'uploading' | 'reading' | 'ready' | 'error';

export interface PoliAIAttachmentItem {
  /** Klucz w kolejce composera. */
  localId: string;
  /** Id załącznika (`poliai_attachments.id`, folder w buckecie). */
  id: string;
  name: string;
  kind?: AttachmentKind;
  status: PoliAIAttachmentStatus;
  error?: string;
  /** Gotowy blok do wysłania (status `ready`). */
  block?: AttachmentBlock;
  /** Wysłane obrazy stron - do usunięcia, gdy użytkownik odrzuci załącznik. */
  paths: string[];
}

const PrepareResponseSchema = z.object({
  attachment: z.object({
    id: z.string(),
    name: z.string(),
    kind: z.enum(['image', 'pdf', 'docx', 'text']),
    mime: z.string(),
    size: z.number(),
    pages: z.number().int(),
  }),
});

const SESSION_EXPIRED = 'Sesja wygasła. Zaloguj się ponownie.';

interface PrepareBody {
  id: string;
  name: string;
  mime: string;
  kind: AttachmentKind;
  original_size: number;
  pages: { text: string }[];
}

/** `POST /api/poliai?op=attachment`: OCR i zapis wiersza; po 401 odświeża sesję raz (jak `usePoliAI`). */
async function prepareAttachment(body: PrepareBody, signal: AbortSignal): Promise<AttachmentBlock> {
  let refreshed = false;
  for (;;) {
    const { data } = refreshed ? await supabase.auth.refreshSession() : await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new PoliAIFileError(SESSION_EXPIRED);
    const res = await fetch('/api/poliai?op=attachment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal,
    });
    if (res.status === 401 && !refreshed) {
      refreshed = true;
      continue;
    }
    if (!res.ok) throw new PoliAIFileError((await readHttpError(res)).message);
    const parsed = PrepareResponseSchema.safeParse(await res.json());
    if (!parsed.success) throw new PoliAIFileError('PoliAI zwrócił nieoczekiwaną odpowiedź. Spróbuj ponownie.');
    return { type: 'attachment', ...parsed.data.attachment };
  }
}

function removeObjects(paths: string[]) {
  if (paths.length === 0) return;
  // Best-effort: resztę sprząta cron poliai-purge (obiekty bez wiersza starsze niż 1 dzień).
  supabase.storage
    .from(POLIAI_ATTACHMENTS_BUCKET)
    .remove(paths)
    .catch(() => undefined);
}

export interface PoliAIAttachments {
  items: PoliAIAttachmentItem[];
  readyBlocks: AttachmentBlock[];
  /** Któryś plik jest jeszcze kompresowany, wysyłany albo odczytywany. */
  busy: boolean;
  hasErrors: boolean;
  add: (files: File[]) => void;
  remove: (localId: string) => void;
  /** Po wysłaniu wiadomości - pliki zostają (należą już do rozmowy). */
  clear: () => void;
}

/**
 * Kolejka załączników composera PoliAI. Każdy plik: kompresja i tekst w przeglądarce
 * (poliaiFiles) → upload obrazów stron do bucketu → przygotowanie na serwerze (OCR, zapis).
 */
export function usePoliAIAttachments(): PoliAIAttachments {
  const [items, setItems] = useState<PoliAIAttachmentItem[]>([]);
  // Źródło prawdy dla limitu i ścieżek poza renderem (kilka `add` w jednym ticku, `remove` w trakcie uploadu).
  const itemsRef = useRef<PoliAIAttachmentItem[]>([]);
  const controllersRef = useRef(new Map<string, AbortController>());

  const commit = useCallback((next: (prev: PoliAIAttachmentItem[]) => PoliAIAttachmentItem[]) => {
    itemsRef.current = next(itemsRef.current);
    setItems(itemsRef.current);
  }, []);

  const update = useCallback(
    (localId: string, patch: Partial<PoliAIAttachmentItem>) => {
      commit((prev) => prev.map((item) => (item.localId === localId ? { ...item, ...patch } : item)));
    },
    [commit],
  );

  // Zamknięcie panelu przerywa przetwarzanie (pipeline sam usuwa wysłane już strony).
  useEffect(() => {
    const controllers = controllersRef.current;
    return () => {
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
    };
  }, []);

  const runPipeline = useCallback(
    async (item: PoliAIAttachmentItem, file: File, controller: AbortController) => {
      const { signal } = controller;
      const uploaded: string[] = [];
      try {
        const processed = await processFile(file, { signal });
        signal.throwIfAborted();

        update(item.localId, { status: 'uploading' });
        const { data } = await supabase.auth.getSession();
        const userId = data.session?.user.id;
        if (!userId) throw new PoliAIFileError(SESSION_EXPIRED);
        for (const [i, page] of processed.pages.entries()) {
          if (!page.image) continue;
          signal.throwIfAborted();
          const path = `${userId}/${item.id}/p${String(i + 1).padStart(3, '0')}.${page.image.ext}`;
          const { error } = await supabase.storage
            .from(POLIAI_ATTACHMENTS_BUCKET)
            .upload(path, page.image.blob, { contentType: page.image.contentType, upsert: false });
          if (error) throw new PoliAIFileError(`Nie udało się wysłać pliku „${item.name}”. Spróbuj ponownie.`);
          uploaded.push(path);
          update(item.localId, { paths: [...uploaded] });
        }
        signal.throwIfAborted();

        update(item.localId, { status: 'reading' });
        const block = await prepareAttachment(
          {
            id: item.id,
            name: item.name,
            mime: processed.mime,
            kind: processed.kind,
            original_size: processed.originalSize,
            pages: processed.pages.map((page) => ({ text: page.text })),
          },
          signal,
        );
        signal.throwIfAborted();
        update(item.localId, { status: 'ready', block, name: block.name });
      } catch (e) {
        if (signal.aborted) {
          removeObjects(uploaded);
          return;
        }
        const message =
          e instanceof PoliAIFileError ? e.message : `Nie udało się przygotować pliku „${item.name}”. Spróbuj ponownie.`;
        update(item.localId, { status: 'error', error: message });
        toast.error(message);
      } finally {
        if (controllersRef.current.get(item.localId) === controller) controllersRef.current.delete(item.localId);
      }
    },
    [update],
  );

  const add = useCallback(
    (files: File[]) => {
      const free = MAX_FILES - itemsRef.current.length;
      if (files.length > free) {
        toast.error(`Do jednej wiadomości możesz dołączyć maksymalnie ${MAX_FILES} plików.`);
      }
      const added: { item: PoliAIAttachmentItem; file: File }[] = [];
      for (const file of files.slice(0, Math.max(0, free))) {
        let kind: AttachmentKind;
        try {
          kind = detectKind(file);
          assertFileSize(file);
        } catch (e) {
          toast.error(e instanceof PoliAIFileError ? e.message : `Nie można dołączyć pliku „${file.name}”.`);
          continue;
        }
        const item: PoliAIAttachmentItem = {
          localId: crypto.randomUUID(),
          id: crypto.randomUUID(),
          name: file.name || 'plik',
          kind,
          status: 'processing',
          paths: [],
        };
        added.push({ item, file });
      }
      if (added.length === 0) return;
      commit((prev) => [...prev, ...added.map((a) => a.item)]);
      for (const { item, file } of added) {
        const controller = new AbortController();
        controllersRef.current.set(item.localId, controller);
        void runPipeline(item, file, controller);
      }
    },
    [commit, runPipeline],
  );

  const remove = useCallback(
    (localId: string) => {
      const item = itemsRef.current.find((i) => i.localId === localId);
      if (!item) return;
      const controller = controllersRef.current.get(localId);
      // Trwający pipeline po przerwaniu sam usuwa wysłane strony; zakończony - usuwamy tutaj.
      if (controller) {
        controller.abort();
        controllersRef.current.delete(localId);
      } else removeObjects(item.paths);
      commit((prev) => prev.filter((i) => i.localId !== localId));
    },
    [commit],
  );

  const clear = useCallback(() => {
    for (const controller of controllersRef.current.values()) controller.abort();
    controllersRef.current.clear();
    commit(() => []);
  }, [commit]);

  return useMemo(() => {
    const readyBlocks = items.flatMap((item) => (item.status === 'ready' && item.block ? [item.block] : []));
    return {
      items,
      readyBlocks,
      busy: items.some((item) => item.status === 'processing' || item.status === 'uploading' || item.status === 'reading'),
      hasErrors: items.some((item) => item.status === 'error'),
      add,
      remove,
      clear,
    };
  }, [items, add, remove, clear]);
}
