import type { SupabaseClient } from '@supabase/supabase-js';
import { convert } from 'html-to-text';
import type { McpAuthContext, McpRole } from '../auth.js';
import { getServiceClient } from '../supabase.js';
import { DbError } from '../log-safe.js';
import { sanitizeHtml } from '../sanitize-html.js';
import { logAudit } from '../audit.js';
import { applyDataScope } from '../access.js';
import {
  type ToolDefinition,
  jsonResult,
  textResult,
  optionalBoolean,
  optionalEnum,
  optionalString,
  optionalNumber,
  optionalUuid,
  requireString,
  getLimit,
  POSEL_ONLY,
  ToolValidationError,
} from './types.js';
import { INTERPELLATION_LABELS, withLabel, withLabels } from './labels.js';

const INTERPELLATION_STATUSES = [
  'nowa',
  'uwagi',
  'po_poprawkach',
  'zaakceptowana',
  'wyslana',
  'odrzucona',
] as const;
const DECISIONS = ['zaakceptowana', 'uwagi', 'odrzucona'] as const;
const PRACOWNIK_ONLY: readonly McpRole[] = ['pracownik'];
const MAX_HTML_LENGTH = 500_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function extractText(html: string): string {
  const text = convert(html, {
    wordwrap: false,
    preserveNewlines: true,
    selectors: [
      { selector: 'script', format: 'skip' },
      { selector: 'style', format: 'skip' },
      { selector: 'img', format: 'skip' },
      { selector: 'a', options: { ignoreHref: true } },
    ],
  })
    .replace(/\n[\t ]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!text) {
    throw new ToolValidationError('Plik HTML nie zawiera tekstu interpelacji.');
  }
  if (text.length > 300_000) {
    throw new ToolValidationError('Tekst wyekstrahowany z HTML nie moze przekraczac 300000 znakow.');
  }
  return text;
}

/**
 * HTML z MCP po sanityzacji (C3-01) i tekst liczony z wyniku: podgląd (content_html w iframe) i tekst
 * kopiowany do Sejmu (content_text) pokazują to samo - bez stylów nie da się ukryć fragmentu.
 */
function prepareContent(raw: string): { content_html: string; content_text: string } {
  const html = sanitizeHtml(raw);
  return { content_html: html, content_text: extractText(html) };
}

async function resolveSignatory(
  supabase: SupabaseClient,
  requestedId: string | null,
): Promise<string> {
  let query = supabase
    .from('profiles')
    .select('id')
    .eq('role', 'posel')
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1);
  if (requestedId) query = query.eq('id', requestedId);

  const { data, error } = await query.maybeSingle();
  if (error) throw new DbError(error);
  if (!data) {
    throw new ToolValidationError(
      requestedId
        ? 'Wskazany signatory_id nie jest aktywnym Poslem.'
        : 'Brak aktywnego Posla, ktory moze podpisac interpelacje.',
    );
  }
  return data.id;
}

async function verifyCaseAccess(
  supabase: SupabaseClient,
  caseId: string | null,
  ctx: McpAuthContext,
): Promise<void> {
  if (!caseId) return;
  const { data, error } = await applyDataScope(
    supabase.from('cases').select('id').eq('id', caseId),
    ctx,
    'cases',
  ).maybeSingle();
  if (error) throw new DbError(error);
  if (!data) {
    throw new ToolValidationError(
      `Sprawa case_id=${caseId} nie istnieje albo jest poza Twoim zakresem danych.`,
    );
  }
}

function deadlineSituation(deadlineAt: string | null): 'brak' | 'w_terminie' | 'po_terminie' {
  if (!deadlineAt) return 'brak';
  return new Date(deadlineAt).getTime() <= Date.now() ? 'po_terminie' : 'w_terminie';
}

/**
 * Nowa interpelacja (status "Nowa") - wspolne dla narzedzia MCP interpellations_submit i recznego
 * dodawania w portalu (api/integracje.ts): ta sama walidacja, sanityzacja HTML i audyt.
 */
export async function submitInterpellation(
  args: Record<string, unknown>,
  ctx: McpAuthContext,
  auditAction: string,
): Promise<Record<string, unknown>> {
  const recipient = requireString(args, 'recipient', 200).trim();
  const subject = requireString(args, 'subject', 200).trim();
  const html = requireString(args, 'html', MAX_HTML_LENGTH);
  if (!recipient || !subject) {
    throw new ToolValidationError('Pola recipient i subject nie moga zawierac samych spacji.');
  }
  const content = prepareContent(html);
  const caseId = optionalUuid(args, 'case_id');
  const supabase = getServiceClient();
  await verifyCaseAccess(supabase, caseId, ctx);
  const signatoryId = await resolveSignatory(supabase, optionalUuid(args, 'signatory_id'));

  const { data, error } = await supabase
    .from('interpellations')
    .insert({
      recipient,
      subject,
      ...content,
      case_id: caseId,
      signatory_id: signatoryId,
      status: 'nowa',
      created_by: ctx.userId,
    })
    .select()
    .single();
  if (error) throw new DbError(error);

  await logAudit(ctx, auditAction, {
    entityType: 'interpellation',
    entityId: data.id,
    metadata: { ...(ctx.channel === 'portal' ? {} : { tool: 'interpellations_submit' }), subject, signatory_id: signatoryId },
  });
  return data;
}

/**
 * Poprawiona wersja po uwagach Posla ("Uwagi" -> "Po poprawkach") - wspolne dla MCP
 * interpellations_resubmit i portalu. null = brak interpelacji w statusie Uwagi w zakresie danych.
 */
export async function resubmitInterpellation(
  args: Record<string, unknown>,
  ctx: McpAuthContext,
  auditAction: string,
): Promise<Record<string, unknown> | null> {
  const id = requireString(args, 'id', 64);
  if (!UUID_RE.test(id)) throw new ToolValidationError('Nieprawidłowy identyfikator interpelacji.');
  const html = requireString(args, 'html', MAX_HTML_LENGTH);
  const update: Record<string, unknown> = {
    ...prepareContent(html),
    status: 'po_poprawkach',
  };
  if (args.recipient !== undefined) {
    const recipient = requireString(args, 'recipient', 200).trim();
    if (!recipient) throw new ToolValidationError('Pole recipient nie moze zawierac samych spacji.');
    update.recipient = recipient;
  }
  if (args.subject !== undefined) {
    const subject = requireString(args, 'subject', 200).trim();
    if (!subject) throw new ToolValidationError('Pole subject nie moze zawierac samych spacji.');
    update.subject = subject;
  }

  const { data, error } = await applyDataScope(
    getServiceClient()
      .from('interpellations')
      .update(update)
      .eq('id', id)
      .eq('status', 'uwagi')
      .select(),
    ctx,
    'interpellations',
  ).maybeSingle();
  if (error) {
    // interpellations_workflow: poprawka musi zmieniać treść (22023) - błąd dla użytkownika, nie 500.
    if (error.code === '22023') {
      throw new ToolValidationError('Poprawiona wersja musi różnić się treścią od poprzedniej.');
    }
    throw new DbError(error);
  }
  if (!data) return null;

  await logAudit(ctx, auditAction, {
    entityType: 'interpellation',
    entityId: id,
    metadata: { ...(ctx.channel === 'portal' ? {} : { tool: 'interpellations_resubmit' }), revision: data.revision },
  });
  return data;
}

export const interpellationsTools: ToolDefinition[] = [
  {
    name: 'interpellations_list',
    title: 'Lista interpelacji',
    readOnly: true,
    description:
      'Stronicowana lista interpelacji z etapem, wersja, terminem wyslania i sytuacja terminu. ' +
      'Odpowiedz zawiera tez pelne podsumowanie statusow. Posel i Administrator widza wszystkie; ' +
      'Pracownik zgodnie ze swoim zakresem danych.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: INTERPELLATION_STATUSES },
        active_only: {
          type: 'boolean',
          description: 'Pomin wyslane i odrzucone (archiwum).',
        },
        overdue_only: {
          type: 'boolean',
          description: 'Pokaz tylko zaakceptowane interpelacje po terminie wyslania.',
        },
        offset: {
          type: 'integer',
          minimum: 0,
          default: 0,
          description: 'Pozycja pierwszego rekordu. Uzyj next_offset z poprzedniej odpowiedzi.',
        },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 100 },
      },
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const status = optionalEnum(args, 'status', INTERPELLATION_STATUSES);
      const activeOnly = optionalBoolean(args, 'active_only') ?? false;
      const overdueOnly = optionalBoolean(args, 'overdue_only') ?? false;
      const offset = optionalNumber(args, 'offset') ?? 0;
      if (!Number.isInteger(offset) || offset < 0) {
        throw new ToolValidationError('Pole "offset" musi byc nieujemna liczba calkowita.');
      }
      if (overdueOnly && status && status !== 'zaakceptowana') {
        throw new ToolValidationError('Filtr overdue_only wymaga statusu "zaakceptowana" albo braku filtra status.');
      }
      const limit = getLimit(args, 100, 100);
      const supabase = getServiceClient();

      let query = applyDataScope(
        supabase
          .from('interpellations')
          .select(
            'id, recipient, subject, status, revision, review_notes, submitted_at, accepted_at, deadline_at, sent_at, archived_at, created_by, updated_at',
            { count: 'exact' },
          )
          .order('submitted_at', { ascending: false })
          .order('id', { ascending: false })
          .range(offset, offset + limit - 1),
        ctx,
        'interpellations',
      );
      if (status) query = query.eq('status', status);
      if (activeOnly) query = query.not('status', 'in', '(wyslana,odrzucona)');
      if (overdueOnly) {
        query = query.eq('status', 'zaakceptowana').lt('deadline_at', new Date().toISOString());
      }

      const statusQueries = INTERPELLATION_STATUSES.map((candidate) =>
        applyDataScope(
          supabase
            .from('interpellations')
            .select('id', { count: 'exact', head: true })
            .eq('status', candidate),
          ctx,
          'interpellations',
        ),
      );
      const overdueQuery = applyDataScope(
        supabase
          .from('interpellations')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'zaakceptowana')
          .lt('deadline_at', new Date().toISOString()),
        ctx,
        'interpellations',
      );
      const [pageResult, statusResults, overdueResult] = await Promise.all([
        query,
        Promise.all(statusQueries),
        overdueQuery,
      ]);
      if (pageResult.error) throw new DbError(pageResult.error);
      for (const result of statusResults) {
        if (result.error) throw new DbError(result.error);
      }
      if (overdueResult.error) throw new DbError(overdueResult.error);

      const interpellations = (await withLabels(pageResult.data ?? [], INTERPELLATION_LABELS)).map((item) => ({
        ...item,
        deadline_situation: deadlineSituation(item.deadline_at),
      }));
      const byStatus = Object.fromEntries(
        INTERPELLATION_STATUSES.map((candidate, index) => [
          candidate,
          statusResults[index].count ?? 0,
        ]),
      );
      const total = pageResult.count ?? 0;
      const nextOffset = offset + interpellations.length;
      return jsonResult({
        count: interpellations.length,
        total,
        has_more: nextOffset < total,
        next_offset: nextOffset < total ? nextOffset : null,
        summary: { by_status: byStatus, overdue: overdueResult.count ?? 0 },
        interpellations,
      });
    },
  },

  {
    name: 'interpellations_get',
    title: 'Szczegóły interpelacji',
    readOnly: true,
    description:
      'Pobiera pelna interpelacje: HTML, wyekstrahowany tekst, uwagi Posla, etap i terminy.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const id = requireString(args, 'id', 64);
      const supabase = getServiceClient();
      const { data, error } = await applyDataScope(
        supabase.from('interpellations').select('*').eq('id', id),
        ctx,
        'interpellations',
      ).maybeSingle();
      if (error) throw new DbError(error);
      if (!data) {
        return textResult(`Interpelacja o id=${id} nie istnieje lub jest poza Twoim zakresem danych.`, true);
      }
      return jsonResult({
        ...(await withLabel(data, INTERPELLATION_LABELS)),
        deadline_situation: deadlineSituation(data.deadline_at),
      });
    },
  },

  {
    name: 'interpellations_submit',
    title: 'Wgranie interpelacji',
    description:
      'Pracownik wgrywa nowa wygenerowana interpelacje jako HTML. Aplikacja zapisuje HTML, ' +
      'wyodrebnia tekst i nadaje status "Nowa". Narzedzie tylko dla Pracownika.',
    inputSchema: {
      type: 'object',
      properties: {
        recipient: {
          type: 'string',
          minLength: 1,
          maxLength: 200,
          description: 'Odbiorca interpelacji: organ, do ktorego jest kierowana, np. "Minister Zdrowia".',
        },
        subject: { type: 'string', minLength: 1, maxLength: 200 },
        html: {
          type: 'string',
          minLength: 1,
          maxLength: MAX_HTML_LENGTH,
          description:
            'Pelna zawartosc pliku HTML albo fragment HTML interpelacji. Aplikacja usuwa style, klasy, skrypty i ' +
            'nieznane znaczniki - zostaje struktura (akapity, naglowki, listy, tabele, linki).',
        },
        case_id: { type: 'string', description: 'Opcjonalne powiazanie ze sprawa.' },
        signatory_id: {
          type: 'string',
          description: 'Opcjonalny aktywny Posel podpisujacy. Domyslnie pierwszy aktywny Posel.',
        },
      },
      required: ['recipient', 'subject', 'html'],
      additionalProperties: false,
    },
    roles: PRACOWNIK_ONLY,
    nonDestructive: true,
    handler: async (args, ctx) => {
      const data = await submitInterpellation(args, ctx, 'mcp.interpellation_submit');
      return jsonResult({ created: true, interpellation: await withLabel(data, INTERPELLATION_LABELS) });
    },
  },

  {
    name: 'interpellations_resubmit',
    title: 'Wgranie poprawionej interpelacji',
    description:
      'Pracownik wgrywa poprawiony HTML po uwagach Posla. Dostepne tylko w statusie "Uwagi"; ' +
      'aplikacja wyodrebnia tekst, zwieksza numer wersji i ustawia "Po poprawkach".',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        html: { type: 'string', minLength: 1, maxLength: MAX_HTML_LENGTH },
        recipient: {
          type: 'string',
          minLength: 1,
          maxLength: 200,
          description: 'Nowy odbiorca interpelacji (organ, np. "Minister Zdrowia"). Pomin, aby zostawic obecnego.',
        },
        subject: { type: 'string', minLength: 1, maxLength: 200 },
      },
      required: ['id', 'html'],
      additionalProperties: false,
    },
    roles: PRACOWNIK_ONLY,
    nonDestructive: true,
    handler: async (args, ctx) => {
      const data = await resubmitInterpellation(args, ctx, 'mcp.interpellation_resubmit');
      if (!data) {
        return textResult(
          `Interpelacja o id=${String(args.id)} nie istnieje, nie ma statusu Uwagi albo jest poza Twoim zakresem danych.`,
          true,
        );
      }
      return jsonResult({ updated: true, interpellation: await withLabel(data, INTERPELLATION_LABELS) });
    },
  },

  {
    name: 'interpellations_decide',
    title: 'Decyzja w sprawie interpelacji',
    description:
      'Posel lub Administrator podejmuje decyzje nad statusem "Nowa" albo "Po poprawkach": ' +
      'zaakceptowana, uwagi lub odrzucona. Przy "uwagi" pole notes jest wymagane. ' +
      'Przy "zaakceptowana" Posel moze sam poprawic tresc: html (pelny poprawiony HTML), subject, ' +
      'recipient - aplikacja zapisuje poprawiona wersje (numer wersji + 1) i od razu ja akceptuje, ' +
      'bez odsylania do Pracownika. Poprawki tylko po wyraznej zgodzie uzytkownika na konkretna tresc.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        decision: { type: 'string', enum: DECISIONS },
        notes: { type: 'string', maxLength: 5000 },
        html: {
          type: 'string',
          minLength: 1,
          maxLength: MAX_HTML_LENGTH,
          description: 'Tylko przy "zaakceptowana": poprawiony przez Posla pelny HTML interpelacji.',
        },
        subject: {
          type: 'string',
          minLength: 1,
          maxLength: 200,
          description: 'Tylko przy "zaakceptowana": poprawiony temat. Pomin, aby zostawic obecny.',
        },
        recipient: {
          type: 'string',
          minLength: 1,
          maxLength: 200,
          description: 'Tylko przy "zaakceptowana": poprawiony odbiorca (organ). Pomin, aby zostawic obecnego.',
        },
      },
      required: ['id', 'decision'],
      additionalProperties: false,
    },
    roles: POSEL_ONLY,
    handler: async (args, ctx) => {
      const id = requireString(args, 'id', 64);
      const decision = optionalEnum(args, 'decision', DECISIONS);
      if (!decision) throw new ToolValidationError('Pole "decision" jest wymagane.');
      const notes = optionalString(args, 'notes', 5000)?.trim() || null;
      if (decision === 'uwagi' && !notes) {
        throw new ToolValidationError('Pole "notes" jest wymagane przy decyzji "uwagi".');
      }

      const update: Record<string, unknown> = { status: decision, review_notes: notes, decided_by: ctx.userId };
      const corrected = args.html !== undefined || args.subject !== undefined || args.recipient !== undefined;
      if (corrected && decision !== 'zaakceptowana') {
        throw new ToolValidationError(
          'Pola html, subject i recipient sa dozwolone tylko przy decyzji "zaakceptowana". ' +
            'Przy "uwagi" poprawki wgrywa Pracownik (interpellations_resubmit).',
        );
      }
      if (args.html !== undefined) {
        const html = requireString(args, 'html', MAX_HTML_LENGTH);
        Object.assign(update, prepareContent(html));
      }
      if (args.subject !== undefined) {
        const subject = requireString(args, 'subject', 200).trim();
        if (!subject) throw new ToolValidationError('Pole subject nie moze zawierac samych spacji.');
        update.subject = subject;
      }
      if (args.recipient !== undefined) {
        const recipient = requireString(args, 'recipient', 200).trim();
        if (!recipient) throw new ToolValidationError('Pole recipient nie moze zawierac samych spacji.');
        update.recipient = recipient;
      }

      const supabase = getServiceClient();
      const { data, error } = await applyDataScope(
        supabase
          .from('interpellations')
          .update(update)
          .eq('id', id)
          .in('status', ['nowa', 'po_poprawkach'])
          .select(),
        ctx,
        'interpellations',
      ).maybeSingle();
      if (error) throw new DbError(error);
      if (!data) {
        return textResult(
          `Interpelacja o id=${id} nie istnieje albo nie oczekuje na decyzje.`,
          true,
        );
      }

      await logAudit(ctx, 'mcp.interpellation_decide', {
        entityType: 'interpellation',
        entityId: id,
        metadata: { tool: 'interpellations_decide', decision, corrected, revision: data.revision },
      });
      return jsonResult({ updated: true, interpellation: await withLabel(data, INTERPELLATION_LABELS) });
    },
  },

  {
    name: 'interpellations_mark_sent',
    title: 'Potwierdzenie wysyłki interpelacji',
    description:
      'Potwierdza faktyczna wysylke zaakceptowanej interpelacji. Konczy proces statusem "Interpelacja wyslana".',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const id = requireString(args, 'id', 64);
      const supabase = getServiceClient();
      const { data, error } = await applyDataScope(
        supabase
          .from('interpellations')
          .update({ status: 'wyslana' })
          .eq('id', id)
          .eq('status', 'zaakceptowana')
          .select(),
        ctx,
        'interpellations',
      ).maybeSingle();
      if (error) throw new DbError(error);
      if (!data) {
        return textResult(
          `Interpelacja o id=${id} nie istnieje, nie jest zaakceptowana albo jest poza Twoim zakresem danych.`,
          true,
        );
      }

      await logAudit(ctx, 'mcp.interpellation_mark_sent', {
        entityType: 'interpellation',
        entityId: id,
        metadata: { tool: 'interpellations_mark_sent' },
      });
      return jsonResult({ updated: true, interpellation: await withLabel(data, INTERPELLATION_LABELS) });
    },
  },

  {
    name: 'interpellations_delete',
    title: 'Usunięcie interpelacji',
    description: 'Przenosi interpelację do kosza na 7 dni - przywraca Poseł lub Administrator w portalu (Kosz). Tylko Poseł lub Administrator.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
    roles: POSEL_ONLY,
    idempotent: true,
    handler: async (args, ctx) => {
      const id = requireString(args, 'id', 64);
      const supabase = getServiceClient();
      const { data, error } = await applyDataScope(
        supabase.from('interpellations').delete().eq('id', id).select('id'),
        ctx,
        'interpellations',
      ).maybeSingle();
      if (error) throw new DbError(error);
      if (!data) return textResult(`Interpelacja o id=${id} nie istnieje.`, true);

      await logAudit(ctx, 'mcp.interpellation_delete', {
        entityType: 'interpellation',
        entityId: id,
        metadata: { tool: 'interpellations_delete' },
      });
      return jsonResult({ deleted: true, id });
    },
  },
];
