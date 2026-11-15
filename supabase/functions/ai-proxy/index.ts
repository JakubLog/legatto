// Edge Function: ai-proxy
//
// Jedyny punkt wywolan Claude w portalu biura. Klucz API instancji (Claude Console) wpisuje
// Posel w ustawieniach integracji.
// Klucz w Supabase Vault (service_get_secrets), model w app_settings - odczyt przez service_role,
// wiec Pracownik korzysta z AI bez wgladu w klucz.
//
// Akcje (action w body):
// - 'status'            writer   { configured, model } - bez ruchu do Anthropic (UI przyciskow AI)
// - 'check_connection'  posel    GET /v1/models - weryfikuje klucz, zwraca liste modeli
// - 'run_task'          writer   { task, input } -> { text, model } - zadania z tasks.ts
//
// Tylko uzytkownik: getUser() + rola + sesja aal2 (MFA); brak sciezki service_role.
// run_task limitowane do DAILY_RUN_TASK_LIMIT wywolan / 24 h per uzytkownik (liczone
// z audit_log 'ai.run_task', wpis przed wywolaniem Anthropic).

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { corsHeadersFor } from '../_shared/cors.ts';
import { isCallerAal2, serviceAudit } from '../_shared/auth.ts';
import { buildTaskPrompt } from './tasks.ts';

const DAILY_RUN_TASK_LIMIT = 50;

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-sonnet-4-6';

const RequestBody = z.discriminatedUnion('action', [
  z.object({ action: z.literal('status') }),
  z.object({ action: z.literal('check_connection') }),
  z.object({
    action: z.literal('run_task'),
    payload: z.object({ task: z.string(), input: z.unknown() }),
  }),
]);

// Odpowiedzi Anthropic - tylko pola, z ktorych korzystamy.
const AnthropicError = z.object({ error: z.object({ message: z.string() }) });
const ModelList = z.object({
  data: z.array(z.object({ id: z.string(), display_name: z.string().optional() })),
});
const MessageResponse = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
});

interface AiSettings {
  api_key: string;
  model: string;
}

async function loadAiSettings(admin: SupabaseClient): Promise<AiSettings> {
  // Klucz w Vault (service_get_secrets, tylko service_role), model w app_settings.
  const [secretsRes, modelRes] = await Promise.all([
    admin.rpc('service_get_secrets', { p_keys: ['anthropic_api_key'] }),
    admin.from('app_settings').select('value').eq('key', 'ai_model').maybeSingle(),
  ]);
  const error = secretsRes.error ?? modelRes.error;
  if (error) throw new Error(`Nie udalo sie odczytac ustawien AI: ${error.message}`);

  const secrets = (secretsRes.data ?? []) as { key: string; value: string }[];
  const model = typeof modelRes.data?.value === 'string' ? modelRes.data.value.trim() : '';
  return {
    api_key: secrets.find((row) => row.key === 'anthropic_api_key')?.value.trim() ?? '',
    model: model || DEFAULT_MODEL,
  };
}

async function anthropicRequest(apiKey: string, path: string, init?: RequestInit) {
  const res = await fetch(`${ANTHROPIC_BASE}${path}`, {
    ...init,
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { ok: res.ok, status: res.status, body };
}

/** Tlumaczy blad Anthropic API na komunikat dla uzytkownika + kod do obslugi w UI. */
function describeAnthropicError(status: number, body: unknown): { code: string; error: string } {
  const parsed = AnthropicError.safeParse(body);
  const message = parsed.success ? parsed.data.error.message.toLowerCase() : '';
  if (status === 401) {
    return { code: 'AI_KEY_INVALID', error: 'Klucz API Claude jest nieprawidlowy lub zostal usuniety.' };
  }
  if (status === 403) {
    return { code: 'AI_KEY_FORBIDDEN', error: 'Klucz API Claude nie ma dostepu do tego zasobu.' };
  }
  if (message.includes('credit balance')) {
    return {
      code: 'AI_NO_CREDITS',
      error:
        'Wyczerpano kredyty API w organizacji Claude Console. Kredyty z planu Max odnawiaja sie co miesiac.',
    };
  }
  if (status === 404) {
    return { code: 'AI_MODEL_NOT_FOUND', error: 'Wybrany model Claude nie jest dostepny. Zmien model w ustawieniach AI.' };
  }
  if (status === 429) {
    return { code: 'AI_RATE_LIMIT', error: 'Przekroczono limit zapytan do Claude. Sprobuj za chwile.' };
  }
  return { code: 'AI_UPSTREAM', error: 'Usluga AI jest tymczasowo niedostepna. Sprobuj ponownie za chwile.' };
}

Deno.serve(async (req) => {
  const cors = corsHeadersFor(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: cors });
  }

  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !anonKey || !serviceKey) {
      return json({ error: 'Brak konfiguracji srodowiska' }, 500);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Brak autoryzacji' }, 401);

    const adminClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // Rola wywolujacego weryfikowana przez RPC tokenem uzytkownika.
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: callerUser, error: userError } = await callerClient.auth.getUser();
    if (userError || !callerUser?.user) {
      return json({ error: 'Nie udalo sie zweryfikowac sesji' }, 401);
    }
    const callerUserId = callerUser.user.id;
    const [writerRes, poselRes] = await Promise.all([
      callerClient.rpc('is_writer'),
      callerClient.rpc('is_posel'),
    ]);
    if (writerRes.error || poselRes.error) {
      console.error('role rpc error', writerRes.error ?? poselRes.error);
      return json({ error: 'Nie udalo sie zweryfikowac uprawnien' }, 500);
    }
    const isWriter = writerRes.data === true;
    const isPosel = poselRes.data === true;
    if (!isWriter) {
      return json({ error: 'Brak uprawnien (wymagana rola: pracownik lub posel)' }, 403);
    }
    if (!(await isCallerAal2(callerClient))) {
      return json({ error: 'Wymagane uwierzytelnienie dwuskladnikowe (2FA)' }, 403);
    }

    // Walidacja body dopiero po autoryzacji - nieuwierzytelniony wywolujacy nie
    // dostaje zadnej informacji zaleznej od wejscia (np. listy akcji).
    const parsedBody = RequestBody.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) return json({ error: 'Brak lub nieznana akcja (action)' }, 400);
    const body = parsedBody.data;

    const settings = await loadAiSettings(adminClient);

    if (body.action === 'status') {
      return json({ configured: Boolean(settings.api_key), model: settings.model }, 200);
    }

    if (!settings.api_key) {
      return json(
        {
          error: 'AI nie jest skonfigurowane. Posel musi dodac klucz w /biuro/admin/integracje/ai.',
          code: 'AI_NOT_CONFIGURED',
        },
        409,
      );
    }

    if (body.action === 'check_connection') {
      if (!isPosel) return json({ error: 'Brak uprawnien (wymagana rola: posel)' }, 403);
      const r = await anthropicRequest(settings.api_key, '/models?limit=100');
      if (!r.ok) {
        return json({ ok: false, status: r.status, ...describeAnthropicError(r.status, r.body) }, 200);
      }
      const list = ModelList.safeParse(r.body);
      const models = list.success
        ? list.data.data.map((m) => ({ id: m.id, display_name: m.display_name ?? m.id }))
        : [];
      return json(
        {
          ok: true,
          model: settings.model,
          model_available: models.some((m) => m.id === settings.model),
          models,
        },
        200,
      );
    }

    // run_task
    const built = buildTaskPrompt(body.payload.task, body.payload.input);
    if ('error' in built) return json({ error: built.error }, 400);

    // Limit dzienny per uzytkownik - chroni kredyty API instancji.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count, error: countError } = await adminClient
      .from('audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', callerUserId)
      .eq('action', 'ai.run_task')
      .gte('created_at', since);
    if (countError) {
      console.error('ai daily limit count error', countError);
      return json({ error: 'Nie udalo sie sprawdzic limitu AI' }, 500);
    }
    if ((count ?? 0) >= DAILY_RUN_TASK_LIMIT) {
      return json(
        {
          error: `Wykorzystano dzienny limit zadan AI (${DAILY_RUN_TASK_LIMIT} / 24 h). Sprobuj pozniej.`,
          code: 'AI_DAILY_LIMIT',
        },
        429,
      );
    }
    // Wpis przed wywolaniem Anthropic - rownolegle zadania od razu licza sie do limitu.
    await serviceAudit(adminClient, callerUserId, 'ai.run_task', 'ai_task', null, {
      task: body.payload.task,
      model: settings.model,
    });

    const r = await anthropicRequest(settings.api_key, '/messages', {
      method: 'POST',
      body: JSON.stringify({
        model: settings.model,
        max_tokens: built.maxTokens,
        system: built.system,
        messages: [{ role: 'user', content: built.prompt }],
      }),
    });
    if (!r.ok) {
      console.error('Anthropic API error', body.payload.task, r.status, JSON.stringify(r.body));
      return json(describeAnthropicError(r.status, r.body), 502);
    }

    const message = MessageResponse.safeParse(r.body);
    const text = message.success
      ? message.data.content.map((c) => (c.type === 'text' ? (c.text ?? '') : '')).join('')
      : '';
    if (!text) return json({ error: 'AI zwrocilo pusta odpowiedz', code: 'AI_EMPTY' }, 502);

    return json({ text, model: settings.model }, 200);
  } catch (err) {
    console.error('ai-proxy error', err);
    return json({ error: 'Wystapil nieoczekiwany blad. Skontaktuj sie z administratorem.' }, 500);
  }
});
