// Edge Function: public-submit-case
// Przyjmuje publiczne zgłoszenie sprawy ze strony głównej i wstawia jako rekord
// w tabeli `cases` z source='public_form'. Zgłoszenie pojawia się w liście spraw
// w portalu biura razem z wewnętrznymi (filtr "źródło: publiczne" dostępny w UI).
//
// Anti-spam:
// - honeypot (`website`),
// - Cloudflare Turnstile weryfikowany po stronie serwera (siteverify, sekret
//   TURNSTILE_SECRET; brak sekretu = odmowa, fail-closed),
// - rate limit atomowo przez RPC claim_public_submission_slot (advisory lock per klucz,
//   bez wyścigu count -> insert): 3/h per hash adresu klienta (IPv4 pełny adres, IPv6
//   prefiks /64 - zmiana adresu w obrębie /64 nie omija limitu) oraz 60/h na całą
//   instancję (stały klucz) - górna granica liczby spraw i powiadomień przy rotacji adresów,
// - Turnstile: sprawdzany `hostname` (widget w src/components/public/TurnstileWidget.tsx
//   nie ustawia `action`, więc nie ma czego porównać),
// - limity typów i długości wszystkich pól.
//
// Body: {
//   reporter_name: string,
//   reporter_email?: string,
//   reporter_phone?: string,
//   powiat_id: number,
//   gmina_id?: number | null,
//   category_id: number,
//   title: string,
//   description: string,
//   rodo_consent: boolean,           // wymagane true
//   consent_newsletter?: boolean,    // opcjonalne, default false
//   consent_contacts_db?: boolean,   // opcjonalne, default false
//   turnstile_token: string,         // token widgetu Cloudflare Turnstile
//   website?: string                 // honeypot, musi być puste
// }

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { corsHeadersFor, INSTANCE_ORIGINS } from '../_shared/cors.ts';

interface SubmitBody {
  reporter_name?: unknown;
  reporter_email?: unknown;
  reporter_phone?: unknown;
  powiat_id?: unknown;
  gmina_id?: unknown;
  category_id?: unknown;
  title?: unknown;
  description?: unknown;
  rodo_consent?: unknown;
  consent_newsletter?: unknown;
  consent_contacts_db?: unknown;
  turnstile_token?: unknown;
  website?: unknown;
}

interface ValidSubmission {
  reporter_name: string;
  reporter_email: string | null;
  reporter_phone: string | null;
  powiat_id: number;
  gmina_id: number | null;
  category_id: number;
  title: string;
  description: string;
  consent_newsletter: boolean;
  consent_contacts_db: boolean;
  turnstile_token: string;
}

const RATE_LIMIT_PER_HOUR = 3;
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60;
// Limit globalny instancji: stały klucz w public_submission_attempts (hash IP to 64 znaki hex,
// więc klucze się nie pokrywają).
const GLOBAL_RATE_LIMIT_KEY = 'global';
const GLOBAL_RATE_LIMIT_PER_HOUR = 60;
const USER_AGENT_MAX_LENGTH = 512;
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
// Hosty, na których może być osadzony widget. Sekret TURNSTILE_ALLOWED_HOSTNAMES
// (lista po przecinku) zastępuje domyślną listę: hosty z ALLOWED_ORIGINS + localhost (dev).
const TURNSTILE_ALLOWED_HOSTNAMES: readonly string[] = (() => {
  const explicit = (Deno.env.get('TURNSTILE_ALLOWED_HOSTNAMES') ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (explicit.length > 0) return explicit;
  return [...new Set([...INSTANCE_ORIGINS.map((o) => new URL(o).hostname), 'localhost'])];
})();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+\d\s()-]{6,20}$/;

Deno.serve(async (req) => {
  const cors = corsHeadersFor(req);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: cors });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, cors);
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const ipSalt = Deno.env.get('PUBLIC_SUBMISSION_IP_SALT');
    const turnstileSecret = Deno.env.get('TURNSTILE_SECRET');

    if (!supabaseUrl || !serviceRoleKey || !ipSalt || !turnstileSecret) {
      console.error('Missing env vars', {
        hasUrl: !!supabaseUrl,
        hasServiceRole: !!serviceRoleKey,
        hasIpSalt: !!ipSalt,
        hasTurnstileSecret: !!turnstileSecret,
      });
      return json({ error: 'Brak konfiguracji środowiska' }, 500, cors);
    }

    const body = (await req.json().catch(() => null)) as SubmitBody | null;
    if (!body || typeof body !== 'object') {
      return json({ error: 'Nieprawidłowy JSON' }, 400, cors);
    }

    // Honeypot - jeśli wypełnione to bot. Zwracamy 200 OK ale nic nie zapisujemy.
    if (typeof body.website === 'string' && body.website.trim().length > 0) {
      return json({ success: true }, 200, cors);
    }

    const validated = validateBody(body);
    if ('error' in validated) {
      return json({ error: validated.error }, 400, cors);
    }
    const data = validated.data;

    const clientIp = getClientIp(req);
    const userAgent = req.headers.get('user-agent')?.slice(0, USER_AGENT_MAX_LENGTH) ?? null;

    const turnstileOk = await verifyTurnstile(
      turnstileSecret,
      data.turnstile_token,
      clientIp === 'unknown' ? null : clientIp,
    );
    if (!turnstileOk) {
      return json(
        { error: 'Weryfikacja antyspamowa nie powiodła się. Odśwież stronę i spróbuj ponownie.' },
        403,
        cors,
      );
    }

    const ipHash = await sha256Hex(`${rateLimitBucket(clientIp)}:${ipSalt}`);

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Rate limit: max 3 zgłoszenia z tego samego adresu (IPv6: /64) w ostatniej godzinie.
    // Najpierw limit per adres - odrzucone próby nie zużywają limitu globalnego.
    const ipLimit = await claimSlot(adminClient, ipHash, RATE_LIMIT_PER_HOUR);
    if (ipLimit === 'error') {
      return json({ error: 'Błąd serwera' }, 500, cors);
    }
    if (ipLimit === 'denied') {
      return json(
        { error: 'Przekroczono limit zgłoszeń. Spróbuj ponownie za godzinę.' },
        429,
        cors,
      );
    }
    const globalLimit = await claimSlot(adminClient, GLOBAL_RATE_LIMIT_KEY, GLOBAL_RATE_LIMIT_PER_HOUR);
    if (globalLimit === 'error') {
      return json({ error: 'Błąd serwera' }, 500, cors);
    }
    if (globalLimit === 'denied') {
      console.warn('Global public submission limit reached');
      return json(
        { error: 'Formularz przyjął w tej chwili zbyt wiele zgłoszeń. Spróbuj ponownie później.' },
        429,
        cors,
      );
    }

    // Walidacja FK: powiat
    const { data: powiat, error: powiatErr } = await adminClient
      .from('powiaty')
      .select('id')
      .eq('id', data.powiat_id)
      .maybeSingle();
    if (powiatErr) console.error('Powiat lookup failed', powiatErr);
    if (powiatErr || !powiat) {
      return json({ error: 'Wybrany powiat nie istnieje' }, 400, cors);
    }

    // Walidacja FK: gmina (jeśli podana) - musi należeć do powiatu
    if (data.gmina_id != null) {
      const { data: gmina, error: gminaErr } = await adminClient
        .from('gminy')
        .select('id, powiat_id')
        .eq('id', data.gmina_id)
        .maybeSingle();
      if (gminaErr) console.error('Gmina lookup failed', gminaErr);
      if (gminaErr || !gmina) {
        return json({ error: 'Wybrana gmina nie istnieje' }, 400, cors);
      }
      if (gmina.powiat_id !== data.powiat_id) {
        return json({ error: 'Gmina nie należy do wybranego powiatu' }, 400, cors);
      }
    }

    // Walidacja FK: kategoria - tylko systemowe na publicznym formularzu
    const { data: category, error: catErr } = await adminClient
      .from('case_categories')
      .select('id, is_system')
      .eq('id', data.category_id)
      .maybeSingle();
    if (catErr) console.error('Category lookup failed', catErr);
    if (catErr || !category) {
      return json({ error: 'Wybrana kategoria nie istnieje' }, 400, cors);
    }
    if (!category.is_system) {
      return json({ error: 'Nieprawidłowa kategoria' }, 400, cors);
    }

    // Insert do cases (RLS pomijane przez service_role)
    const { data: inserted, error: insertError } = await adminClient
      .from('cases')
      .insert({
        title: data.title,
        description: data.description,
        status: 'nowa',
        priority: 'normal',
        category_id: data.category_id,
        reporter_name: data.reporter_name,
        reporter_email: data.reporter_email,
        reporter_phone: data.reporter_phone,
        powiat_id: data.powiat_id,
        gmina_id: data.gmina_id,
        source: 'public_form',
        consent_newsletter: data.consent_newsletter,
        consent_contacts_db: data.consent_contacts_db,
        submission_ip_hash: ipHash,
        submission_user_agent: userAgent,
      })
      .select('id')
      .single();

    if (insertError || !inserted) {
      console.error('Insert failed', insertError);
      return json({ error: 'Nie udało się zapisać zgłoszenia' }, 500, cors);
    }

    return json({ success: true, case_id: inserted.id }, 200, cors);
  } catch (err) {
    console.error('public-submit-case error', err);
    return json({ error: 'Nieznany błąd serwera' }, 500, cors);
  }
});

/** Walidacja typów i długości (limity zgodne z formularzem w src/lib/publicSubmission.ts). */
function validateBody(b: SubmitBody): { error: string } | { data: ValidSubmission } {
  if (typeof b.reporter_name !== 'string' || b.reporter_name.trim().length < 3) {
    return { error: 'Imię i nazwisko musi mieć min. 3 znaki' };
  }
  const reporterName = b.reporter_name.trim();
  if (reporterName.length > 100) {
    return { error: 'Imię i nazwisko za długie (max 100 znaków)' };
  }

  if (b.reporter_email != null && typeof b.reporter_email !== 'string') {
    return { error: 'Nieprawidłowy adres e-mail' };
  }
  if (b.reporter_phone != null && typeof b.reporter_phone !== 'string') {
    return { error: 'Nieprawidłowy numer telefonu' };
  }
  const reporterEmail = (b.reporter_email as string | null | undefined)?.trim() || null;
  const reporterPhone = (b.reporter_phone as string | null | undefined)?.trim() || null;
  if (!reporterEmail && !reporterPhone) {
    return { error: 'Podaj e-mail lub telefon kontaktowy' };
  }
  if (reporterEmail && (reporterEmail.length > 254 || !EMAIL_RE.test(reporterEmail))) {
    return { error: 'Nieprawidłowy adres e-mail' };
  }
  if (reporterPhone && !PHONE_RE.test(reporterPhone)) {
    return { error: 'Nieprawidłowy numer telefonu (6-20 znaków: cyfry, spacje, +, -, nawiasy)' };
  }

  if (typeof b.powiat_id !== 'number' || !Number.isInteger(b.powiat_id) || b.powiat_id < 1) {
    return { error: 'Wybierz powiat' };
  }
  if (b.gmina_id != null && (typeof b.gmina_id !== 'number' || !Number.isInteger(b.gmina_id) || b.gmina_id < 1)) {
    return { error: 'Nieprawidłowa gmina' };
  }
  if (typeof b.category_id !== 'number' || !Number.isInteger(b.category_id) || b.category_id < 1) {
    return { error: 'Wybierz kategorię' };
  }

  if (typeof b.title !== 'string' || b.title.trim().length < 5) {
    return { error: 'Tytuł musi mieć min. 5 znaków' };
  }
  const title = b.title.trim();
  if (title.length > 200) {
    return { error: 'Tytuł za długi (max 200 znaków)' };
  }
  if (typeof b.description !== 'string' || b.description.trim().length < 20) {
    return { error: 'Opis musi mieć min. 20 znaków' };
  }
  const description = b.description.trim();
  if (description.length > 5000) {
    return { error: 'Opis za długi (max 5000 znaków)' };
  }

  if (b.rodo_consent !== true) {
    return { error: 'Wymagana zgoda RODO' };
  }
  if (
    typeof b.turnstile_token !== 'string' ||
    b.turnstile_token.length === 0 ||
    b.turnstile_token.length > 2048
  ) {
    return { error: 'Brak weryfikacji antyspamowej. Odśwież stronę i spróbuj ponownie.' };
  }

  return {
    data: {
      reporter_name: reporterName,
      reporter_email: reporterEmail,
      reporter_phone: reporterPhone,
      powiat_id: b.powiat_id,
      gmina_id: (b.gmina_id as number | null | undefined) ?? null,
      category_id: b.category_id,
      title,
      description,
      consent_newsletter: b.consent_newsletter === true,
      consent_contacts_db: b.consent_contacts_db === true,
      turnstile_token: b.turnstile_token,
    },
  };
}

/** Weryfikacja tokenu Turnstile w Cloudflare (siteverify). Każdy błąd = odmowa (fail-closed). */
async function verifyTurnstile(secret: string, token: string, remoteIp: string | null): Promise<boolean> {
  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  if (remoteIp) form.append('remoteip', remoteIp);

  try {
    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error('Turnstile siteverify HTTP error', res.status);
      return false;
    }
    const result = (await res.json()) as {
      success?: unknown;
      hostname?: unknown;
      'error-codes'?: unknown;
    };
    if (result.success !== true) {
      console.warn('Turnstile rejected', result['error-codes']);
      return false;
    }
    if (typeof result.hostname !== 'string' || !TURNSTILE_ALLOWED_HOSTNAMES.includes(result.hostname)) {
      console.warn('Turnstile hostname mismatch', result.hostname);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Turnstile siteverify failed', err);
    return false;
  }
}

/** Atomowa rezerwacja miejsca w limicie (RPC claim_public_submission_slot). */
async function claimSlot(
  adminClient: SupabaseClient,
  key: string,
  max: number,
): Promise<'granted' | 'denied' | 'error'> {
  const { data, error } = await adminClient.rpc('claim_public_submission_slot', {
    p_ip_hash: key,
    p_max: max,
    p_window_seconds: RATE_LIMIT_WINDOW_SECONDS,
  });
  if (error) {
    console.error('Rate-limit claim failed', key === GLOBAL_RATE_LIMIT_KEY ? 'global' : 'ip', error);
    return 'error';
  }
  return data === true ? 'granted' : 'denied';
}

/**
 * Klucz limitu dla adresu klienta: IPv4 pełny adres, IPv6 prefiks /64 (jedno łącze / VPS
 * dostaje zwykle całe /64, więc pełny adres IPv6 daje praktycznie nieograniczone klucze).
 * IPv4-mapped (::ffff:a.b.c.d) traktujemy jak IPv4. Nierozpoznany format - bez zmian.
 */
function rateLimitBucket(ip: string): string {
  const addr = ip.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  if (!addr.includes(':')) return addr;

  // Końcowy zapis IPv4 (np. ::ffff:1.2.3.4, 64:ff9b::1.2.3.4) -> dwa hekstety.
  let text = addr;
  const v4Tail = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (v4Tail) {
    const octets = v4Tail.slice(1).map(Number);
    if (octets.some((n) => n > 255)) return addr;
    const [a, b, c, d] = octets;
    text = text.slice(0, v4Tail.index) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }

  // Rozwinięcie '::' do 8 grup.
  const halves = text.split('::');
  if (halves.length > 2) return addr;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 1 ? fill !== 0 : fill < 1) return addr;
  const groups = [...head, ...new Array<string>(halves.length === 2 ? fill : 0).fill('0'), ...tail];
  if (groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return addr;
  const words = groups.map((g) => parseInt(g, 16));

  // IPv4-mapped (::ffff:a.b.c.d) = klient IPv4.
  if (words.slice(0, 5).every((w) => w === 0) && words[5] === 0xffff) {
    return [words[6] >> 8, words[6] & 0xff, words[7] >> 8, words[7] & 0xff].join('.');
  }

  return `${words.slice(0, 4).map((w) => w.toString(16).padStart(4, '0')).join(':')}::/64`;
}

function getClientIp(req: Request): string {
  // Wybór IP klienta:
  // 1. cf-connecting-ip - ustawiany (i nadpisywany) przez Cloudflare przed Supabase,
  //    klient nie może go podrobić.
  // 2. Fallback: OSTATNI wpis X-Forwarded-For - dopisany przez najbliższe zaufane proxy.
  //    Wcześniejsze wpisy (w tym pierwszy) kontroluje klient, więc ich nie używamy.
  // x-real-ip pomijamy - nie ma gwarancji, że proxy go nadpisuje.
  const cf = req.headers.get('cf-connecting-ip')?.trim();
  if (cf) return cf.slice(0, 64);
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) {
    const last = fwd.split(',').map((s) => s.trim()).filter(Boolean).pop();
    if (last) return last.slice(0, 64);
  }
  return 'unknown';
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function json(body: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
