import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { SECRET_SETTINGS_STATUS_KEY, saveSecretSetting } from '@/hooks/useSecretSettings';
import { readHttpError } from '@/hooks/usePoliAI';

// ============================================================================
// AI (Claude) - klucz i model dla PoliAI (/api/poliai). Operator instancji może je ustawić
// w env (AI_API_KEY, AI_MODEL) - wtedy mają pierwszeństwo przed panelem.
// ============================================================================

const DEFAULT_AI_MODEL = 'claude-sonnet-4-6';

/** Błąd z /api/poliai; `code` (np. AI_NOT_CONFIGURED, AI_NO_CREDITS) pozwala UI reagować konkretnie. */
export class AiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

/** Klucz / model ustawione przez operatora w env - panel ich nie zmienia. */
const OperatorManagedSchema = z.object({ key: z.boolean(), model: z.boolean() });

const AiConnectionSchema = z.union([
  z.object({
    ok: z.literal(true),
    model: z.string(),
    model_available: z.boolean(),
    models: z.array(z.object({ id: z.string(), display_name: z.string() })),
    operator_managed: OperatorManagedSchema,
  }),
  // Brak klucza: code AI_NOT_CONFIGURED.
  z.object({
    ok: z.literal(false),
    status: z.number(),
    code: z.string(),
    error: z.string(),
    operator_managed: OperatorManagedSchema,
  }),
]);
export type AiConnection = z.infer<typeof AiConnectionSchema>;

const SESSION_EXPIRED = 'Sesja wygasła. Zaloguj się ponownie.';

/** `POST /api/poliai?op=connection`; po 401 odświeża sesję raz (jak `useBudgetReports`). */
async function requestAiConnection(): Promise<AiConnection> {
  let refreshed = false;
  for (;;) {
    const { data } = refreshed ? await supabase.auth.refreshSession() : await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new AiError(SESSION_EXPIRED);
    const res = await fetch('/api/poliai?op=connection', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401 && !refreshed) {
      refreshed = true;
      continue;
    }
    if (!res.ok) {
      const { message, code } = await readHttpError(res);
      throw new AiError(message, code);
    }
    const parsed = AiConnectionSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new AiError('Niepoprawna odpowiedź usługi AI');
    return parsed.data;
  }
}

/** Weryfikacja klucza w Anthropic + lista modeli (tylko Poseł i Administrator). */
export function useAiConnection() {
  return useQuery<AiConnection>({
    queryKey: ['ai-connection'],
    queryFn: requestAiConnection,
    staleTime: 60_000,
    retry: false,
  });
}

interface AiSettings {
  model: string;
}

interface AiSettingsUpdate {
  /** undefined = bez zmian (model ustawia operator). */
  model?: string;
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
      if (settings.model !== undefined) {
        const { error } = await supabase
          .from('app_settings')
          .upsert(
            { key: AI_MODEL_KEY, value: settings.model.trim() || DEFAULT_AI_MODEL },
            { onConflict: 'key' },
          );
        if (error) throw error;
      }
      if (settings.api_key !== undefined) await saveSecretSetting('anthropic_api_key', settings.api_key);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-settings'] });
      qc.invalidateQueries({ queryKey: SECRET_SETTINGS_STATUS_KEY });
      qc.invalidateQueries({ queryKey: ['ai-connection'] });
    },
  });
}
