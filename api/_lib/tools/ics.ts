import { getServiceClient } from '../supabase.js';
import { logAudit } from '../audit.js';
import { syncSource } from '../ics-sync.js';
import {
  type ToolDefinition,
  jsonResult,
  textResult,
  optionalBoolean,
  requireString,
  POSEL_ONLY,
  POLIAI_ONLY,
  ToolValidationError,
} from './types.js';

// ics_sources: RLS ics_sources_posel (for all) - cala sekcja tylko dla Posla.
const SOURCE_COLUMNS = 'id, name, url, is_active, last_synced_at, synced_event_count, created_at, updated_at';

function requireIcsUrl(args: Record<string, unknown>): string {
  const raw = requireString(args, 'url', 2000).trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ToolValidationError('Pole "url" musi być poprawnym adresem URL.');
  }
  // safeFetch (synchronizacja) i trigger ics_sources_guard przyjmuja tylko https (port 443).
  if (url.protocol !== 'https:') {
    throw new ToolValidationError('Adres kalendarza musi zaczynać się od https:// (webcal:// zamień na https://).');
  }
  if (!raw.includes('.ics') && !raw.includes('ical')) {
    throw new ToolValidationError('To nie wygląda na link ICS/iCal (oczekiwano ".ics" lub "ical" w adresie).');
  }
  return raw;
}

// Prywatne linki iCal niosa sekret (query string, userinfo, segment "private-..." Google) -
// do rozmowy z AI trafia tylko origin + sciezka z zamaskowanym sekretem.
function maskSource<T extends { url: unknown }>(row: T): T {
  let masked = '…';
  try {
    const url = new URL(String(row.url));
    const path = url.pathname.replace(/\/private-[^/]+/g, '/private-…');
    masked = `${url.protocol}//${url.host}${path}${url.search ? '?…' : ''}`;
  } catch { /* niepoprawny URL - pelna maska */ }
  return { ...row, url: masked };
}

export const icsTools: ToolDefinition[] = [
  {
    name: 'ics_sources_list',
    title: 'Kalendarze ICS',
    readOnly: true,
    description:
      'Lista zewnętrznych kalendarzy ICS synchronizowanych do kalendarza biura (codziennie o 06:00), z datą ostatniej synchronizacji. Tylko Poseł.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    roles: POSEL_ONLY,
    handler: async () => {
      const supabase = getServiceClient();
      const { data, error } = await supabase
        .from('ics_sources')
        .select(SOURCE_COLUMNS)
        .order('created_at', { ascending: true });
      if (error) throw new Error(error.message);
      return jsonResult({ count: data?.length ?? 0, sources: (data ?? []).map(maskSource) });
    },
  },

  {
    name: 'ics_sources_create',
    title: 'Dodanie kalendarza ICS',
    description:
      'Dodaje zewnętrzny kalendarz ICS (np. link iCal z Google Calendar). Wymagane: name, url (https). Po dodaniu użyj ics_sources_sync, żeby od razu zaimportować wydarzenia. Tylko Poseł.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 100 },
        url: { type: 'string', maxLength: 2000 },
      },
      required: ['name', 'url'],
      additionalProperties: false,
    },
    roles: POSEL_ONLY,
    // Zapis zrodel ICS (fetch dowolnego URL po stronie serwera) - tylko PoliAI, nie zewnetrzny MCP.
    channels: POLIAI_ONLY,
    nonDestructive: true,
    handler: async (args, ctx) => {
      const name = requireString(args, 'name', 100).trim();
      const url = requireIcsUrl(args);
      const supabase = getServiceClient();
      // created_by jawnie - pod service_role trigger set_created_by dostaje auth.uid() = NULL,
      // a cron synchronizuje zrodla w imieniu created_by.
      const { data, error } = await supabase
        .from('ics_sources')
        .insert({ name, url, created_by: ctx.userId })
        .select(SOURCE_COLUMNS)
        .single();
      if (error) throw new Error(error.message);
      await logAudit(ctx, 'mcp.ics_source_create', {
        entityType: 'ics_source',
        entityId: data.id,
        metadata: { name, tool: 'ics_sources_create' },
      });
      return jsonResult({ created: true, source: maskSource(data) });
    },
  },

  {
    name: 'ics_sources_update',
    title: 'Zmiana kalendarza ICS',
    description: 'Zmienia nazwę, adres lub aktywność źródła ICS. Podaj tylko pola do zmiany. Tylko Poseł.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string', minLength: 1, maxLength: 100 },
        url: { type: 'string', maxLength: 2000 },
        is_active: { type: 'boolean' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    roles: POSEL_ONLY,
    channels: POLIAI_ONLY,
    nonDestructive: true,
    idempotent: true,
    handler: async (args, ctx) => {
      const id = requireString({ id: args.id }, 'id', 64);
      const update: Record<string, unknown> = {};
      if (args.name !== undefined) update.name = requireString(args, 'name', 100).trim();
      if (args.url !== undefined) update.url = requireIcsUrl(args);
      const isActive = optionalBoolean(args, 'is_active');
      if (isActive !== null) update.is_active = isActive;
      if (Object.keys(update).length === 0) return textResult('Brak pól do zaktualizowania.', true);

      const supabase = getServiceClient();
      const { data, error } = await supabase
        .from('ics_sources')
        .update(update)
        .eq('id', id)
        .select(SOURCE_COLUMNS)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return textResult(`Źródło ICS o id=${id} nie istnieje.`, true);
      await logAudit(ctx, 'mcp.ics_source_update', {
        entityType: 'ics_source',
        entityId: id,
        metadata: { fields: Object.keys(update), tool: 'ics_sources_update' },
      });
      return jsonResult({ updated: true, source: maskSource(data) });
    },
  },

  {
    name: 'ics_sources_delete',
    title: 'Usunięcie kalendarza ICS',
    description:
      'Usuwa źródło ICS. Zaimportowane wcześniej wydarzenia zostają w kalendarzu (tracą powiązanie ze źródłem). Tylko Poseł.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
    roles: POSEL_ONLY,
    channels: POLIAI_ONLY,
    idempotent: true,
    handler: async (args, ctx) => {
      const id = requireString({ id: args.id }, 'id', 64);
      const supabase = getServiceClient();
      const { data, error } = await supabase.from('ics_sources').delete().eq('id', id).select('id, name');
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) return textResult(`Źródło ICS o id=${id} nie istnieje.`, true);
      await logAudit(ctx, 'mcp.ics_source_delete', {
        entityType: 'ics_source',
        entityId: id,
        metadata: { name: data[0].name, tool: 'ics_sources_delete' },
      });
      return jsonResult({ deleted: true, id });
    },
  },

  {
    name: 'ics_sources_sync',
    title: 'Synchronizacja kalendarza ICS',
    description:
      'Natychmiast synchronizuje jedno źródło ICS: importuje brakujące wydarzenia od 14 dni wstecz (istniejących nie nadpisuje). Tylko Poseł.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
    roles: POSEL_ONLY,
    channels: POLIAI_ONLY,
    nonDestructive: true,
    idempotent: true,
    openWorld: true,
    handler: async (args, ctx) => {
      const id = requireString({ id: args.id }, 'id', 64);
      const result = await syncSource(id, ctx.userId);
      if (result.error) {
        return textResult(`Synchronizacja źródła "${result.name}" nie powiodła się: ${result.error}`, true);
      }
      await logAudit(ctx, 'mcp.ics_source_sync', {
        entityType: 'ics_source',
        entityId: id,
        metadata: { imported: result.imported, in_range: result.inRange, tool: 'ics_sources_sync' },
      });
      return jsonResult({ synced: true, source: result.name, imported: result.imported, in_range: result.inRange });
    },
  },
];
