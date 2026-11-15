import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { POLIAI_ATTACHMENTS_BUCKET, sanitizeActions, type ApiBlock, type ApiMessage, type TurnExtras } from '@/lib/poliai';

export const POLIAI_CONVERSATIONS_KEY = ['poliai-conversations'] as const;

export interface PoliAIConversationSummary {
  id: string;
  title: string | null;
  updated_at: string;
}

/** Lista rozmów PoliAI użytkownika (najnowsze pierwsze) - panel historii w nagłówku. */
export function usePoliAIConversations(enabled: boolean) {
  return useQuery<PoliAIConversationSummary[]>({
    queryKey: POLIAI_CONVERSATIONS_KEY,
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('poliai_conversations')
        .select('id, title, updated_at')
        .order('updated_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as PoliAIConversationSummary[];
    },
  });
}

const AttachmentPagesSchema = z.object({ pages: z.array(z.object({ path: z.string().nullable() }).passthrough()) });

export async function deletePoliAIConversation(id: string): Promise<void> {
  // Pliki załączników usuwamy od razu (best-effort) - wiersze znikną kaskadowo z rozmową,
  // a resztę obiektów bez wiersza sprząta cron poliai-purge.
  try {
    const { data } = await supabase.from('poliai_attachments').select('pages').eq('conversation_id', id);
    const paths = (data ?? []).flatMap((row) => {
      const parsed = AttachmentPagesSchema.safeParse(row);
      return parsed.success ? parsed.data.pages.flatMap((page) => (page.path ? [page.path] : [])) : [];
    });
    if (paths.length > 0) await supabase.storage.from(POLIAI_ATTACHMENTS_BUCKET).remove(paths);
  } catch {
    // Brak plików nie blokuje usunięcia rozmowy.
  }
  const { error } = await supabase.from('poliai_conversations').delete().eq('id', id);
  if (error) throw error;
}

// Walidacja luzna celowo: historia to JSON z serwera, ale ksztalt blokow ApiBlock jest wazny dla
// renderowania procesu/odpowiedzi, wiec odrzucamy oczywisty smiec zamiast go wyswietlac.
const BlockSchema = z
  .object({ type: z.string() })
  .passthrough() satisfies z.ZodType<Record<string, unknown>>;
const MessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.union([z.string(), z.array(BlockSchema)]),
});
const ActionSchema = z.object({ label: z.string(), prompt: z.string().optional(), href: z.string().optional() });
const ExtrasSchema = z.object({ intro: z.string().default(''), actions: z.array(ActionSchema).default([]) });
const RowSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  messages: z.array(MessageSchema),
  extras: z.record(z.string(), ExtrasSchema),
  context_from: z.number().int(),
});

export interface LoadedPoliAIConversation {
  id: string;
  title: string | null;
  messages: ApiMessage[];
  contextFrom: number;
  extras: Record<number, TurnExtras>;
}

export async function loadPoliAIConversation(id: string): Promise<LoadedPoliAIConversation> {
  const { data, error } = await supabase
    .from('poliai_conversations')
    .select('id, title, messages, extras, context_from')
    .eq('id', id)
    .single();
  if (error) throw error;
  const row = RowSchema.parse(data);
  return {
    id: row.id,
    title: row.title,
    messages: row.messages as ApiMessage[],
    contextFrom: row.context_from,
    extras: Object.fromEntries(
      Object.entries(row.extras).map(([k, v]): [number, TurnExtras] => [
        Number(k),
        { intro: v.intro, introDone: true, actions: sanitizeActions(v.actions) },
      ]),
    ),
  };
}

// Reexport dla kodu importujacego typ bloku z tego modulu (parzystosc z api/_lib/poliai/conversation.ts).
export type { ApiBlock };
