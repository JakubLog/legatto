import { getServiceClient } from '../supabase.js';
import { logAudit } from '../audit.js';
import { isPoselRole } from '../auth.js';
import {
  type ToolDefinition,
  jsonResult,
  textResult,
  requireString,
  POSEL_ONLY,
  POLIAI_ONLY,
  ToolValidationError,
} from './types.js';

// Klucze sekretne: odczyt przez MCP tylko zamaskowany, zapis wylacznie z UI
// (/biuro/admin/integracje/*) - sekret nie powinien przechodzic przez rozmowe z AI.
// Uzywane tez przez audit_list do redakcji wpisow setting.*.
export const SECRET_KEYS: Record<string, true> = { getresponse_api_key: true, anthropic_api_key: true, resend_api_key: true };

// Jedyny klucz czytelny dla Pracownika (polityka app_settings_select_newsletter_defaults_writer).
const WRITER_READABLE_KEY = 'newsletter_defaults';

const STRING_KEYS = [
  'getresponse_default_list_id',
  'getresponse_from_field_id',
  'getresponse_from_name',
  'getresponse_from_email',
  'getresponse_reply_to_email',
] as const;
const WRITABLE_KEYS = ['visibility_alert_days', 'newsletter_defaults', ...STRING_KEYS] as const;
type WritableKey = (typeof WRITABLE_KEYS)[number];

// Allow-lista kluczy zwracanych przez settings_list (Posel/Administrator). Nowy klucz w app_settings
// jest domyslnie niewidoczny dla narzedzi (i dla Anthropic przez PoliAI), dopoki nie trafi tutaj -
// sekret dodany pozniej nie wycieknie. SECRET_KEYS sa zwracane wylacznie zamaskowane.
const READABLE_KEYS: readonly string[] = [
  ...WRITABLE_KEYS,
  'ai_model',
  'budget_settings',
  'district',
  'site_identity',
  'homepage',
  'notifications_settings',
  ...Object.keys(SECRET_KEYS),
];

function maskSecret(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) return '(nieustawiony)';
  return `(ustawiony, końcówka …${value.slice(-4)})`;
}

async function validatedValue(key: WritableKey, value: unknown): Promise<unknown> {
  if (key === 'visibility_alert_days') {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 3650) {
      throw new ToolValidationError('visibility_alert_days musi być liczbą całkowitą 1-3650 (dni).');
    }
    return value;
  }
  if (key === 'newsletter_defaults') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new ToolValidationError('newsletter_defaults musi być obiektem pól do zmiany, np. {"footer_office_address": "..."}');
    }
    const supabase = getServiceClient();
    const { data, error } = await supabase.from('app_settings').select('value').eq('key', key).maybeSingle();
    if (error) throw new Error(error.message);
    const existing = (data?.value ?? {}) as Record<string, unknown>;
    for (const [field, fieldValue] of Object.entries(value)) {
      if (!(field in existing)) {
        throw new ToolValidationError(
          `Nieznane pole newsletter_defaults: ${field}. Dozwolone: ${Object.keys(existing).join(', ')}.`,
        );
      }
      if (typeof fieldValue !== 'string' || fieldValue.length > 500) {
        throw new ToolValidationError(`Pole newsletter_defaults.${field} musi być tekstem (max 500 znaków).`);
      }
    }
    // Zmiana czesciowa - pozostale pola zostaja bez zmian.
    return { ...existing, ...value };
  }
  if (typeof value !== 'string' || value.length > 500) {
    throw new ToolValidationError(`${key} musi być tekstem (max 500 znaków).`);
  }
  return value;
}

export const settingsTools: ToolDefinition[] = [
  {
    name: 'settings_list',
    title: 'Ustawienia systemu',
    readOnly: true,
    description:
      'Ustawienia systemu (app_settings): integracja GetResponse, AI (Claude), domyślne stopki newslettera, próg alertu widoczności w terenie. Klucze API (GetResponse, Claude) są zamaskowane. ' +
      'Pracownik widzi tylko newsletter_defaults. Opcjonalnie filtr po kluczu.',
    inputSchema: {
      type: 'object',
      properties: { key: { type: 'string', maxLength: 100 } },
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const key = args.key === undefined ? null : requireString(args, 'key', 100);
      if (!isPoselRole(ctx.userRole) && key !== null && key !== WRITER_READABLE_KEY) {
        return textResult(`Pracownik ma dostęp tylko do ustawienia ${WRITER_READABLE_KEY}.`, true);
      }
      if (key !== null && !READABLE_KEYS.includes(key)) {
        return textResult(`Ustawienie ${key} nie istnieje albo nie jest dostępne przez narzędzia.`, true);
      }
      const supabase = getServiceClient();
      let q = supabase.from('app_settings').select('key, value, updated_at').order('key');
      if (!isPoselRole(ctx.userRole)) q = q.eq('key', WRITER_READABLE_KEY);
      else if (key !== null) q = q.eq('key', key);
      else q = q.in('key', [...READABLE_KEYS]);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      // Klucze API sa w Vault (nie w app_settings): do odpowiedzi trafia tylko maska.
      let secretKeys: string[] = [];
      if (isPoselRole(ctx.userRole)) secretKeys = key === null ? Object.keys(SECRET_KEYS) : SECRET_KEYS[key] ? [key] : [];
      let secretRows: { key: string; value: string; updated_at: null }[] = [];
      if (secretKeys.length > 0) {
        const secrets = await supabase.rpc('service_get_secrets', { p_keys: secretKeys });
        if (secrets.error) throw new Error(secrets.error.message);
        const values = new Map(((secrets.data ?? []) as { key: string; value: string }[]).map((r) => [r.key, r.value]));
        secretRows = secretKeys.map((k) => ({ key: k, value: maskSecret(values.get(k)), updated_at: null }));
      }
      // Drugi filtr po allow-liscie niezaleznie od zapytania (fail-closed przy zmianach powyzej).
      const settings = [
        ...(data ?? []).filter((row) => READABLE_KEYS.includes(row.key) && !SECRET_KEYS[row.key]),
        ...secretRows,
      ].sort((a, b) => a.key.localeCompare(b.key));
      if (key !== null && settings.length === 0) return textResult(`Ustawienie ${key} nie istnieje.`, true);
      return jsonResult({ count: settings.length, settings });
    },
  },

  {
    name: 'settings_update',
    title: 'Zmiana ustawienia systemu',
    // Konfiguracja integracji (np. lista i nadawca GetResponse) - tylko PoliAI, nie zewnetrzny MCP.
    channels: POLIAI_ONLY,
    description:
      'Zmienia ustawienie systemu. Tylko Poseł. visibility_alert_days: liczba dni (1-3650). newsletter_defaults: obiekt z polami do zmiany (pozostałe bez zmian). ' +
      'getresponse_*: tekst. Kluczy API (GetResponse, Claude) ani modelu AI nie da się ustawić przez MCP - tylko w aplikacji.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', enum: WRITABLE_KEYS },
        value: { description: 'Nowa wartość - typ zależy od klucza' },
      },
      required: ['key', 'value'],
      additionalProperties: false,
    },
    roles: POSEL_ONLY,
    nonDestructive: true,
    idempotent: true,
    handler: async (args, ctx) => {
      const rawKey = requireString(args, 'key', 100);
      if (SECRET_KEYS[rawKey]) {
        throw new ToolValidationError('Klucze API ustawisz tylko w aplikacji (Administracja → Integracje).');
      }
      if (!(WRITABLE_KEYS as readonly string[]).includes(rawKey)) {
        throw new ToolValidationError(`Nieznane ustawienie: ${rawKey}. Dozwolone: ${WRITABLE_KEYS.join(', ')}.`);
      }
      const key = rawKey as WritableKey;
      const value = await validatedValue(key, args.value);

      const supabase = getServiceClient();
      const { data, error } = await supabase
        .from('app_settings')
        .upsert({ key, value }, { onConflict: 'key' })
        .select('key, value, updated_at')
        .single();
      if (error) throw new Error(error.message);
      await logAudit(ctx, 'mcp.setting_update', {
        entityType: 'setting',
        metadata: { key, tool: 'settings_update' },
      });
      return jsonResult({ updated: true, setting: data });
    },
  },
];
