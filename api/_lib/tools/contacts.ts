import { getServiceClient } from '../supabase.js';
import { logAudit } from '../audit.js';
import { applyDataScope } from '../access.js';
import {
  type ToolDefinition,
  jsonResult,
  textResult,
  optionalEnum,
  optionalNumber,
  optionalString,
  requireString,
  getLimit,
  POSEL_ONLY,
  ToolValidationError,
} from './types.js';
import { CONTACT_LABELS, withLabel, withLabels } from './labels.js';

const CONTACT_TYPES = ['wyborca', 'dziennikarz', 'samorządowiec', 'sołtys', 'inne'] as const;

export const contactsTools: ToolDefinition[] = [
  {
    name: 'contacts_list',
    title: 'Lista kontaktów',
    readOnly: true,
    description: 'Lista kontaktów z filtrami (typ, powiat, gmina). Domyślnie 20 ostatnio dodanych.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: CONTACT_TYPES },
        powiat_id: { type: 'integer' },
        gmina_id: { type: 'integer' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        offset: { type: 'integer', minimum: 0, default: 0 },
      },
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const supabase = getServiceClient();
      const type = optionalEnum(args, 'type', CONTACT_TYPES);
      const powiatId = optionalNumber(args, 'powiat_id');
      const gminaId = optionalNumber(args, 'gmina_id');
      const limit = getLimit(args, 20, 100);
      const offset = optionalNumber(args, 'offset') ?? 0;
      let q = applyDataScope(
        supabase
          .from('contacts')
          .select('id, type, first_name, last_name, function, phone, email, powiat_id, gmina_id, tags, created_at')
          .order('created_at', { ascending: false })
          .range(offset, offset + limit - 1),
        ctx,
        'contacts',
      );
      if (type) q = q.eq('type', type);
      if (powiatId !== null) q = q.eq('powiat_id', powiatId);
      if (gminaId !== null) q = q.eq('gmina_id', gminaId);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return jsonResult({ count: data?.length ?? 0, offset, contacts: await withLabels(data ?? [], CONTACT_LABELS) });
    },
  },

  {
    name: 'contacts_get',
    title: 'Szczegóły kontaktu',
    readOnly: true,
    description: 'Pełne dane jednego kontaktu wraz z notatkami.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const id = requireString({ id: args.id }, 'id', 64);
      const supabase = getServiceClient();
      const { data, error } = await applyDataScope(
        supabase.from('contacts').select('*').eq('id', id),
        ctx,
        'contacts',
      ).maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return textResult(`Kontakt o id=${id} nie istnieje lub jest poza Twoim zakresem danych.`, true);
      return jsonResult(await withLabel(data, CONTACT_LABELS));
    },
  },

  {
    name: 'contacts_search',
    title: 'Wyszukiwanie kontaktów',
    readOnly: true,
    description: 'Wyszukuje kontakty po imieniu/nazwisku/funkcji.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 100 },
        type: { type: 'string', enum: CONTACT_TYPES },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
      },
      required: ['query'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const query = optionalString(args, 'query', 100);
      if (!query) throw new ToolValidationError('Pole "query" jest wymagane.');
      const type = optionalEnum(args, 'type', CONTACT_TYPES);
      const limit = getLimit(args, 20, 50);
      const supabase = getServiceClient();
      // Neutralizuj skladnie PostgREST .or() (przecinki/nawiasy/cudzyslowy/backslash/gwiazdka
      // - PostgREST zamienia "*" na "%") oraz wildcardy LIKE - w wyszukiwaniu po nazwisku nie sa
      // potrzebne, a umozliwiaja wstrzykniecie dodatkowych warunkow filtra (PostgREST filter injection).
      const escaped = query.replace(/[,()"\\*]/g, ' ').replace(/[%_]/g, '\\$&').trim();
      if (!escaped) throw new ToolValidationError('Pole "query" jest wymagane.');
      const orFilter = `first_name.ilike.%${escaped}%,last_name.ilike.%${escaped}%,function.ilike.%${escaped}%`;
      let q = applyDataScope(
        supabase
          .from('contacts')
          .select('id, type, first_name, last_name, function, phone, email, powiat_id, gmina_id')
          .or(orFilter)
          .limit(limit),
        ctx,
        'contacts',
      );
      if (type) q = q.eq('type', type);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return jsonResult({ query, count: data?.length ?? 0, contacts: await withLabels(data ?? [], CONTACT_LABELS) });
    },
  },

  {
    name: 'contacts_create',
    title: 'Nowy kontakt',
    description:
      'Tworzy nowy kontakt. Wymagane: type, first_name, last_name, powiat_id (z powiaty_list). Opcjonalnie gmina_id (z gminy_list).',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: CONTACT_TYPES },
        first_name: { type: 'string', maxLength: 100 },
        last_name: { type: 'string', maxLength: 100 },
        function: { type: 'string', maxLength: 200 },
        phone: { type: 'string', maxLength: 50 },
        email: { type: 'string', maxLength: 200 },
        powiat_id: { type: 'integer' },
        gmina_id: { type: 'integer' },
        notes: { type: 'string', maxLength: 5000 },
      },
      required: ['type', 'first_name', 'last_name', 'powiat_id'],
      additionalProperties: false,
    },
    nonDestructive: true,
    handler: async (args, ctx) => {
      const type = optionalEnum(args, 'type', CONTACT_TYPES);
      if (!type) throw new ToolValidationError('type wymagane');
      const powiatId = optionalNumber(args, 'powiat_id');
      if (powiatId === null) throw new ToolValidationError('powiat_id wymagane');
      const supabase = getServiceClient();
      const insert = {
        type,
        first_name: requireString(args, 'first_name', 100),
        last_name: requireString(args, 'last_name', 100),
        function: optionalString(args, 'function', 200),
        phone: optionalString(args, 'phone', 50),
        email: optionalString(args, 'email', 200),
        powiat_id: powiatId,
        gmina_id: optionalNumber(args, 'gmina_id'),
        notes: optionalString(args, 'notes', 5000),
        created_by: ctx.userId,
      };
      const { data, error } = await supabase.from('contacts').insert(insert).select().single();
      if (error) throw new Error(error.message);
      await logAudit(ctx, 'mcp.contact_create', { entityType: 'contact', entityId: data.id, metadata: { tool: 'contacts_create' } });
      return jsonResult({ created: true, contact: await withLabel(data, CONTACT_LABELS) });
    },
  },

  {
    name: 'contacts_update',
    title: 'Zmiana kontaktu',
    description: 'Aktualizuje kontakt. Podaj tylko pola do zmiany.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        type: { type: 'string', enum: CONTACT_TYPES },
        first_name: { type: 'string', maxLength: 100 },
        last_name: { type: 'string', maxLength: 100 },
        function: { type: 'string', maxLength: 200 },
        phone: { type: 'string', maxLength: 50 },
        email: { type: 'string', maxLength: 200 },
        powiat_id: { type: 'integer' },
        gmina_id: { type: 'integer' },
        notes: { type: 'string', maxLength: 5000 },
      },
      required: ['id'],
      additionalProperties: false,
    },
    nonDestructive: true,
    idempotent: true,
    handler: async (args, ctx) => {
      const id = requireString({ id: args.id }, 'id', 64);
      const update: Record<string, unknown> = {};
      if (args.type !== undefined) update.type = optionalEnum(args, 'type', CONTACT_TYPES);
      if (args.first_name !== undefined) update.first_name = optionalString(args, 'first_name', 100);
      if (args.last_name !== undefined) update.last_name = optionalString(args, 'last_name', 100);
      if (args.function !== undefined) update.function = optionalString(args, 'function', 200);
      if (args.phone !== undefined) update.phone = optionalString(args, 'phone', 50);
      if (args.email !== undefined) update.email = optionalString(args, 'email', 200);
      if (args.powiat_id !== undefined) update.powiat_id = optionalNumber(args, 'powiat_id');
      if (args.gmina_id !== undefined) update.gmina_id = optionalNumber(args, 'gmina_id');
      if (args.notes !== undefined) update.notes = optionalString(args, 'notes', 5000);
      if (Object.keys(update).length === 0) return textResult('Brak pol do zaktualizowania.', true);
      const supabase = getServiceClient();
      const { data, error } = await applyDataScope(
        supabase.from('contacts').update(update).eq('id', id),
        ctx,
        'contacts',
      )
        .select()
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return textResult(`Kontakt o id=${id} nie istnieje lub jest poza Twoim zakresem danych.`, true);
      await logAudit(ctx, 'mcp.contact_update', { entityType: 'contact', entityId: id, metadata: { fields: Object.keys(update), tool: 'contacts_update' } });
      return jsonResult({ updated: true, contact: await withLabel(data, CONTACT_LABELS) });
    },
  },

  {
    name: 'contacts_delete',
    title: 'Usunięcie kontaktu',
    description: 'Przenosi kontakt do kosza na 7 dni - przywraca Poseł lub Administrator w portalu (Kosz). Tylko Poseł.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
    roles: POSEL_ONLY,
    idempotent: true,
    handler: async (args, ctx) => {
      const id = requireString({ id: args.id }, 'id', 64);
      const supabase = getServiceClient();
      const { error } = await supabase.from('contacts').delete().eq('id', id);
      if (error) throw new Error(error.message);
      await logAudit(ctx, 'mcp.contact_delete', { entityType: 'contact', entityId: id, metadata: { tool: 'contacts_delete' } });
      return jsonResult({ deleted: true, id });
    },
  },
];
