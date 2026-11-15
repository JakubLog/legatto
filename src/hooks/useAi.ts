import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { SECRET_SETTINGS_STATUS_KEY, saveSecretSetting } from '@/hooks/useSecretSettings';

// ============================================================================
// AI (Claude) - konfiguracja wspólnego proxy dla przyszłych funkcji AI.
// Obieg interpelacji korzysta z Claude przez MCP i nie zużywa tego klucza API.
// ============================================================================

export const DEFAULT_AI_MODEL = 'claude-sonnet-4-6';

/** Blad z ai-proxy; `code` (np. AI_NOT_CONFIGURED, AI_NO_CREDITS) pozwala UI reagowac konkretnie. */
export class AiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

const ProxyErrorBody = z.object({ error: z.string(), code: z.string().optional() });


const AiConnectionSchema = z.union([
  z.object({
    ok: z.literal(true),
    model: z.string(),
    model_available: z.boolean(),
    models: z.array(z.object({ id: z.string(), display_name: z.string() })),
  }),
  z.object({ ok: z.literal(false), status: z.number(), code: z.string(), error: z.string() }),
]);
export type AiConnection = z.infer<typeof AiConnectionSchema>;


async function callAiProxy<S extends z.ZodTypeAny>(
  schema: S,
  body: { action: string; payload?: unknown },
): Promise<z.infer<S>> {
  const { data, error } = await supabase.functions.invoke('ai-proxy', { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const parsed = ProxyErrorBody.safeParse(await error.context.json().catch(() => null));
      if (parsed.success) throw new AiError(parsed.data.error, parsed.data.code);
    }
    throw new AiError(error.message || 'Błąd połączenia z usługą AI');
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new AiError('Niepoprawna odpowiedź usługi AI');
  return parsed.data;
}

// ============================================================================
// Status / konfiguracja
// ============================================================================


/** Weryfikacja klucza w Anthropic + lista modeli (tylko Poseł). */
export function useAiConnection(enabled = true) {
  return useQuery<AiConnection>({
    queryKey: ['ai-connection'],
    queryFn: () => callAiProxy(AiConnectionSchema, { action: 'check_connection' }),
    enabled,
    staleTime: 60_000,
    retry: false,
  });
}

export interface AiSettings {
  model: string;
}

export interface AiSettingsUpdate {
  model: string;
  /** undefined = bez zmian; pusty string / null = usun klucz; inaczej nowy klucz. */
  api_key?: string | null;
}

const AI_MODEL_KEY = 'ai_model';

/** Niesekretne ustawienia AI z app_settings - RLS: tylko Poseł (aal2). Klucz API: useSecretSettingsStatus. */
export function useAiSettings() {
  return useQuery<AiSettings>({
    queryKey: ['ai-settings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', AI_MODEL_KEY)
        .maybeSingle();
      if (error) throw error;
      const model = typeof data?.value === 'string' && data.value ? data.value : DEFAULT_AI_MODEL;
      return { model };
    },
    staleTime: 5 * 60_000,
  });
}

export function useUpdateAiSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (settings: AiSettingsUpdate) => {
      const { error } = await supabase
        .from('app_settings')
        .upsert(
          { key: AI_MODEL_KEY, value: settings.model.trim() || DEFAULT_AI_MODEL },
          { onConflict: 'key' },
        );
      if (error) throw error;
      if (settings.api_key !== undefined) await saveSecretSetting('anthropic_api_key', settings.api_key);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-settings'] });
      qc.invalidateQueries({ queryKey: SECRET_SETTINGS_STATUS_KEY });
      qc.invalidateQueries({ queryKey: ['ai-status'] });
      qc.invalidateQueries({ queryKey: ['ai-connection'] });
    },
  });
}

