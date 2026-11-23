import { getServiceClient } from '../supabase.js';
import { DbError } from '../log-safe.js';
import { logAudit } from '../audit.js';
import {
  type ToolDefinition,
  jsonResult,
  textResult,
  optionalBoolean,
  optionalString,
  requireString,
  POSEL_ONLY,
  POLIAI_ONLY,
} from './types.js';

const OFFICE_COLUMNS = 'id, name, city, address, phone, email, is_main, is_active, created_at, updated_at';

// offices_one_main_idx dopuszcza tylko jedno biuro glowne - zdejmujemy flage z poprzedniego.
async function clearMainOffice(exceptId: string | null): Promise<void> {
  const supabase = getServiceClient();
  let q = supabase.from('offices').update({ is_main: false }).eq('is_main', true);
  if (exceptId) q = q.neq('id', exceptId);
  const { error } = await q;
  if (error) throw new DbError(error);
}

export const officesTools: ToolDefinition[] = [
  {
    name: 'offices_list',
    title: 'Lista biur',
    readOnly: true,
    description:
      'Lista biur poselskich (adres, telefon, email, czy główne). Opcjonalnie ze składem osobowym (aktywni członkowie zespołu przypisani do biura).',
    inputSchema: {
      type: 'object',
      properties: {
        include_inactive: { type: 'boolean', default: false },
        include_staff: { type: 'boolean', default: false },
      },
      additionalProperties: false,
    },
    handler: async (args) => {
      const supabase = getServiceClient();
      let q = supabase
        .from('offices')
        .select(OFFICE_COLUMNS)
        .order('is_main', { ascending: false })
        .order('name');
      if (args.include_inactive !== true) q = q.eq('is_active', true);
      const { data, error } = await q;
      if (error) throw new DbError(error);
      const offices = data ?? [];
      if (args.include_staff !== true) return jsonResult({ count: offices.length, offices });

      const { data: staff, error: staffError } = await supabase
        .from('profiles')
        .select('id, full_name, role, office_id')
        .eq('is_active', true)
        .not('office_id', 'is', null)
        .order('full_name');
      if (staffError) throw new DbError(staffError);
      return jsonResult({
        count: offices.length,
        offices: offices.map((o) => ({
          ...o,
          staff: (staff ?? [])
            .filter((p) => p.office_id === o.id)
            .map(({ id, full_name, role }) => ({ id, full_name, role })),
        })),
      });
    },
  },

  {
    name: 'offices_create',
    title: 'Nowe biuro',
    description: 'Tworzy nowe biuro. Wymagane: name, city. is_main=true przenosi status biura głównego. Tylko Poseł.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 2, maxLength: 200 },
        city: { type: 'string', minLength: 2, maxLength: 100 },
        address: { type: 'string', maxLength: 300 },
        phone: { type: 'string', maxLength: 50 },
        email: { type: 'string', maxLength: 200 },
        is_main: { type: 'boolean', default: false },
      },
      required: ['name', 'city'],
      additionalProperties: false,
    },
    roles: POSEL_ONLY,
    // Struktura biur (is_main, aktywnosc) - tylko PoliAI (zatwierdzenie w panelu), nie zewnetrzny MCP.
    channels: POLIAI_ONLY,
    nonDestructive: true,
    handler: async (args, ctx) => {
      const isMain = optionalBoolean(args, 'is_main') ?? false;
      const insert = {
        name: requireString(args, 'name', 200),
        city: requireString(args, 'city', 100),
        address: optionalString(args, 'address', 300),
        phone: optionalString(args, 'phone', 50),
        email: optionalString(args, 'email', 200),
        is_main: isMain,
      };
      if (isMain) await clearMainOffice(null);
      const supabase = getServiceClient();
      const { data, error } = await supabase.from('offices').insert(insert).select(OFFICE_COLUMNS).single();
      if (error) throw new DbError(error);
      await logAudit(ctx, 'mcp.office_create', {
        entityType: 'office',
        entityId: data.id,
        metadata: { name: insert.name, city: insert.city, is_main: isMain, tool: 'offices_create' },
      });
      return jsonResult({ created: true, office: data });
    },
  },

  {
    name: 'offices_update',
    title: 'Zmiana biura',
    description:
      'Aktualizuje biuro: dane kontaktowe, aktywność, status biura głównego (is_main=true przenosi go z obecnego głównego). Podaj tylko pola do zmiany. Tylko Poseł.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string', minLength: 2, maxLength: 200 },
        city: { type: 'string', minLength: 2, maxLength: 100 },
        address: { type: 'string', maxLength: 300 },
        phone: { type: 'string', maxLength: 50 },
        email: { type: 'string', maxLength: 200 },
        is_main: { type: 'boolean' },
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
      if (args.name !== undefined) update.name = requireString(args, 'name', 200);
      if (args.city !== undefined) update.city = requireString(args, 'city', 100);
      if (args.address !== undefined) update.address = optionalString(args, 'address', 300);
      if (args.phone !== undefined) update.phone = optionalString(args, 'phone', 50);
      if (args.email !== undefined) update.email = optionalString(args, 'email', 200);
      const isMain = optionalBoolean(args, 'is_main');
      if (isMain !== null) update.is_main = isMain;
      const isActive = optionalBoolean(args, 'is_active');
      if (isActive !== null) update.is_active = isActive;
      if (Object.keys(update).length === 0) return textResult('Brak pól do zaktualizowania.', true);

      const supabase = getServiceClient();
      const { data: existing, error: existingError } = await supabase
        .from('offices')
        .select('id')
        .eq('id', id)
        .maybeSingle();
      if (existingError) throw new DbError(existingError);
      if (!existing) return textResult(`Biuro o id=${id} nie istnieje.`, true);

      if (isMain === true) await clearMainOffice(id);
      const { data, error } = await supabase.from('offices').update(update).eq('id', id).select(OFFICE_COLUMNS).single();
      if (error) throw new DbError(error);
      await logAudit(ctx, 'mcp.office_update', {
        entityType: 'office',
        entityId: id,
        metadata: { fields: Object.keys(update), tool: 'offices_update' },
      });
      return jsonResult({ updated: true, office: data });
    },
  },
];
