// Zapis rozmow PoliAI (public.poliai_conversations) przez service_role. Kazde zapytanie filtruje
// po user_id z sesji - RLS nie chroni service_role, wiec wlasciciela pilnujemy tutaj.

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { McpAuthContext } from '../auth.js';
import { getServiceClient } from '../supabase.js';
import { DbError } from '../log-safe.js';
import { HistorySchema, type ApiMessage } from './conversation.js';

const ActionSchema = z.object({ label: z.string(), prompt: z.string().optional(), href: z.string().optional() });
const TurnExtrasSchema = z.object({ intro: z.string().default(''), actions: z.array(ActionSchema).default([]) });
export type StoredTurnExtras = z.infer<typeof TurnExtrasSchema>;

const RowSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  messages: HistorySchema,
  extras: z.record(z.string(), TurnExtrasSchema),
  context_summary: z.string().nullable(),
  context_from: z.number().int(),
  summary: z.string().nullable(),
});

export interface Conversation {
  id: string;
  title: string | null;
  messages: ApiMessage[];
  extras: Record<string, StoredTurnExtras>;
  contextSummary: string | null;
  contextFrom: number;
  summary: string | null;
}

const COLUMNS = 'id, title, messages, extras, context_summary, context_from, summary';

function fromRow(row: unknown): Conversation {
  const r = RowSchema.parse(row);
  return {
    id: r.id,
    title: r.title,
    messages: r.messages,
    extras: r.extras,
    contextSummary: r.context_summary,
    contextFrom: r.context_from,
    summary: r.summary,
  };
}

export class ConversationNotFoundError extends Error {}

export async function loadConversation(ctx: McpAuthContext, id: string): Promise<Conversation> {
  const { data, error } = await getServiceClient()
    .from('poliai_conversations')
    .select(COLUMNS)
    .eq('id', id)
    .eq('user_id', ctx.userId)
    .maybeSingle();
  if (error) throw new DbError(error, 'poliai_conversations select');
  if (!data) throw new ConversationNotFoundError('Rozmowa nie istnieje albo została usunięta.');
  return fromRow(data);
}

/** Nowa rozmowa w pamieci - trafia do bazy dopiero przy pierwszym zapisie (bez pustych wierszy po bledach). */
export function newConversation(): Conversation {
  return {
    id: randomUUID(),
    title: null,
    messages: [],
    extras: {},
    contextSummary: null,
    contextFrom: 0,
    summary: null,
  };
}

/**
 * Zapis (upsert). id pochodzi z newConversation() albo z loadConversation() po sprawdzeniu
 * wlasciciela, wiec konflikt dotyczy tylko rozmowy tego uzytkownika.
 */
export async function saveConversation(ctx: McpAuthContext, c: Conversation): Promise<void> {
  const { error } = await getServiceClient()
    .from('poliai_conversations')
    .upsert({
      id: c.id,
      user_id: ctx.userId,
      title: c.title,
      messages: c.messages,
      extras: c.extras,
      context_summary: c.contextSummary,
      context_from: c.contextFrom,
      summary: c.summary,
      updated_at: new Date().toISOString(),
    });
  if (error) throw new DbError(error, 'poliai_conversations upsert');
}

export interface PastConversation {
  id: string;
  title: string | null;
  summary: string;
  updated_at: string;
}

/** Podsumowania innych rozmow uzytkownika (pamiec miedzy chatami), najnowsze pierwsze. */
export async function listPastConversations(
  ctx: McpAuthContext,
  excludeId: string,
  query: string | null,
  limit: number,
): Promise<PastConversation[]> {
  let q = getServiceClient()
    .from('poliai_conversations')
    .select('id, title, summary, updated_at')
    .eq('user_id', ctx.userId)
    .neq('id', excludeId)
    .not('summary', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (query) {
    // Fraza z modelu - usuwamy znaki skladni filtrow PostgREST (przecinki, nawiasy, gwiazdki).
    const safe = query.replace(/[%,()*\\]/g, ' ').trim().slice(0, 100);
    if (safe) q = q.or(`title.ilike.%${safe}%,summary.ilike.%${safe}%`);
  }
  const { data, error } = await q;
  if (error) throw new DbError(error, 'poliai_conversations memory');
  return z
    .array(z.object({ id: z.string(), title: z.string().nullable(), summary: z.string(), updated_at: z.string() }))
    .parse(data ?? []);
}
