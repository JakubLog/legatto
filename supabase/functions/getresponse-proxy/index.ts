// Edge Function: getresponse-proxy
//
// Proxy do GetResponse API (https://api.getresponse.com/v3) dla writera (Posel + Pracownik)
// z sesja aal2 (MFA). Klucz API w Supabase Vault (getresponse_api_key, niedostepny dla
// authenticated) - odczyt przez service_role (service_get_secrets), dzieki czemu Pracownik moze
// wysylac kampanie bez wgladu w klucz.
//
// Akcje (action w body):
// - 'check_status'       GET /accounts              ping klucza (do UI w Integracje.tsx)
// - 'list_campaigns'     GET /campaigns             listy mailingowe (audience lists)
// - 'list_from_fields'   GET /from-fields           adresy nadawcy skonfigurowane w GR
// - 'list_newsletters'   GET /newsletters           historia wysylek
// - 'send_newsletter'    POST /newsletters          tworzy + wysyla kampanie zapisanego szkicu
//                                                   (issue_id) i oznacza go jako wyslany
// - 'send_test_newsletter' POST /newsletters        wysylka testowa do JEDNEGO kontaktu (selectedContacts)
// - 'delete_newsletter'  DELETE /newsletters/{id}   usuwa newsletter z GR
// - 'sync_contact'       POST /contacts             dodaje kontakt do listy GR + zapisuje gr_contact_id
// - 'unsync_contact'     DELETE /contacts/{id}      usuwa kontakt z listy GR + czyści gr_contact_id
//
// Bezpieczenstwo:
// - kazde ID zasobu GR (lista, from-field, newsletter, kontakt) musi pasowac do
//   GR_ID_RE i jest dodatkowo encodeURIComponent w sciezce (brak path traversal);
// - kontakty z bazy czytane klientem wywolujacego (RLS: data_scope + aal2); service_role
//   tylko do zapisu gr_contact_id po udanym odczycie przez RLS;
// - klient dostaje ogolne komunikaty bledow; do console.error tylko status HTTP i kod bledu
//   (GR, Postgres) - bez body GR, tresci bledow DB, adresow i identyfikatorow kontaktow;
// - prawdziwa wysylka i usuwanie newslettera: tylko Posel/Administrator albo opiekun obszaru
//   'newsletter' (module_owners) - predykat bazy can_manage_newsletters(); wysylka testowa:
//   oni na adres aktywnego czlonka zespolu (profiles.email, is_active), pozostali writerzy
//   tylko na adres wlasnego konta (auth); limit TEST_SEND_HOURLY_LIMIT testow / h na osobe
//   (liczony z audit_log, wpis przed wysylka) - proxy nie moze sluzyc do mailingu;
// - wysylka wydania (newsletter_issues): proxy (service_role) rezerwuje szkic atomowo
//   (status 'draft' -> 'sending'), po sukcesie w GR ustawia 'sent', po odrzuceniu przez GR
//   cofa do 'draft'; audyt newsletter.send zapisuje sha256 wyslanej tresci i liste;
// - przy stronie posla (public_site_url() niepusty) wysylka wydania wymaga web_published_at
//   (wersja online opublikowana na stronie, migracja 20261121220000_site_publish.sql) - inaczej 409.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { corsHeadersFor } from '../_shared/cors.ts';
import { isCallerAal2, serviceAudit, UUID_RE } from '../_shared/auth.ts';
import { errorSummary } from '../_shared/log-safe.ts';

const GR_BASE = 'https://api.getresponse.com/v3';
const GR_ID_RE = /^[A-Za-z0-9]{1,32}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// Limity GR API v3 dla tresci newslettera (content.html / content.plain).
const MAX_CONTENT_LENGTH = 524_288;
// Sprzatanie kontaktu testowego: max czas czekania na zakonczenie wysylki (sendMetrics.status
// = 'finished'). Ponizej limitu wall-clock Edge Functions (150 s na planie Free).
const TEST_CLEANUP_MAX_WAIT_MS = 110_000;
const TEST_CLEANUP_POLL_MS = 5_000;
// Wysylki testowe na osobe w ciagu godziny (audit_log 'newsletter.send_test_attempt').
const TEST_SEND_HOURLY_LIMIT = 10;

// Supabase Edge Runtime: zadania w tle po wyslaniu odpowiedzi.
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

type Action =
  | 'check_status'
  | 'list_campaigns'
  | 'list_from_fields'
  | 'list_newsletters'
  | 'send_newsletter'
  | 'send_test_newsletter'
  | 'delete_newsletter'
  | 'sync_contact'
  | 'unsync_contact';

interface RequestBody {
  action?: Action;
  payload?: Record<string, unknown>;
}

interface GrSettings {
  api_key: string;
  default_list_id: string;
  from_field_id: string;
  from_email: string;
  from_name: string;
  reply_to_email: string;
}

async function loadGrSettings(admin: SupabaseClient): Promise<GrSettings> {
  // Klucz w Vault (service_get_secrets), pozostale ustawienia getresponse_* w app_settings.
  const [secretsRes, settingsRes] = await Promise.all([
    admin.rpc('service_get_secrets', { p_keys: ['getresponse_api_key'] }),
    admin.from('app_settings').select('key,value').like('key', 'getresponse_%'),
  ]);
  const error = secretsRes.error ?? settingsRes.error;
  if (error) {
    console.error('GR settings read error', errorSummary(error));
    throw new Error('Nie udalo sie odczytac ustawien GR');
  }

  const map: Record<string, string> = {};
  for (const row of settingsRes.data ?? []) {
    map[row.key as string] = typeof row.value === 'string' ? row.value : JSON.stringify(row.value);
  }
  const secrets = (secretsRes.data ?? []) as { key: string; value: string }[];

  return {
    api_key: secrets.find((row) => row.key === 'getresponse_api_key')?.value ?? '',
    default_list_id: map.getresponse_default_list_id ?? '',
    from_field_id: map.getresponse_from_field_id ?? '',
    from_email: map.getresponse_from_email ?? '',
    from_name: map.getresponse_from_name ?? '',
    reply_to_email: map.getresponse_reply_to_email ?? '',
  };
}

async function grRequest(apiKey: string, path: string, init?: RequestInit) {
  const res = await fetch(`${GR_BASE}${path}`, {
    ...init,
    headers: {
      'X-Auth-Token': `api-key ${apiKey}`,
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

/**
 * ID zasobu GR z payloadu: brak (null/undefined/'') -> fallback (np. z ustawien).
 * Zwraca null, gdy wynik nie pasuje do GR_ID_RE (zly format albo brak i pusty fallback).
 */
function pickGrId(value: unknown, fallback = ''): string | null {
  const candidate = value == null || value === '' ? fallback : value;
  return typeof candidate === 'string' && GR_ID_RE.test(candidate) ? candidate : null;
}

/** contactId kontaktu o danym emailu na liscie GR (albo null). */
async function findListContactId(apiKey: string, email: string, listId: string): Promise<string | null> {
  const sp = new URLSearchParams({
    'query[email]': email,
    'query[campaignId]': listId,
    fields: 'contactId,email',
    perPage: '1',
  });
  const r = await grRequest(apiKey, `/contacts?${sp}`);
  if (!r.ok) {
    console.error('GR contact search error', r.status, errorSummary(r.body).code ?? '');
    return null;
  }
  const id = (r.body as Array<{ contactId?: unknown }> | null)?.[0]?.contactId;
  return typeof id === 'string' && GR_ID_RE.test(id) ? id : null;
}

/**
 * Usuwa z listy GR kontakt dodany wylacznie na potrzeby wysylki testowej.
 * Czeka (max TEST_CLEANUP_MAX_WAIT_MS) az GR zakonczy wysylke (sendMetrics.status='finished'),
 * zeby nie przerwac dostarczania; po przekroczeniu czasu usuwa mimo to - adres testowy nie moze
 * zostac na produkcyjnej liscie (RODO). Gdy contactId nie jest jeszcze znany (dodawanie w GR
 * jest async), najpierw go wyszukuje.
 */
async function removeTestContact(
  apiKey: string,
  email: string,
  listId: string,
  contactId: string | null,
  newsletterId: string | null,
): Promise<void> {
  const deadline = Date.now() + TEST_CLEANUP_MAX_WAIT_MS;
  let id = contactId;
  let sendFinished = newsletterId === null;
  while (Date.now() < deadline && (!id || !sendFinished)) {
    await sleep(TEST_CLEANUP_POLL_MS);
    if (!id) id = await findListContactId(apiKey, email, listId);
    if (!sendFinished && newsletterId) {
      const r = await grRequest(
        apiKey,
        `/newsletters/${encodeURIComponent(newsletterId)}?fields=newsletterId,sendMetrics`,
      );
      const status = (r.body as { sendMetrics?: { status?: unknown } } | null)?.sendMetrics?.status;
      sendFinished = r.ok && status === 'finished';
    }
  }
  if (!id) id = await findListContactId(apiKey, email, listId);
  if (!id) {
    console.error('GR test contact cleanup: contact not found');
    return;
  }
  const del = await grRequest(apiKey, `/contacts/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!del.ok && del.status !== 404) {
    console.error('GR test contact cleanup failed', del.status, errorSummary(del.body).code ?? '');
  }
}

/** Uruchamia sprzatanie w tle (EdgeRuntime.waitUntil), a bez Edge Runtime - synchronicznie. */
async function scheduleTestContactCleanup(cleanup: Promise<void>): Promise<void> {
  const guarded = cleanup.catch((err) => console.error('GR test contact cleanup error', errorSummary(err)));
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime) {
    EdgeRuntime.waitUntil(guarded);
  } else {
    await guarded;
  }
}

/**
 * Czy wywolujacy moze naprawde wysylac / usuwac newslettery: public.can_manage_newsletters()
 * (Posel/Administrator albo opiekun obszaru 'newsletter'). Blad = brak dostepu (fail-closed).
 */
async function canManageNewsletters(callerClient: SupabaseClient): Promise<boolean> {
  const { data, error } = await callerClient.rpc('can_manage_newsletters');
  if (error) {
    console.error('can_manage_newsletters rpc error', errorSummary(error));
    return false;
  }
  return data === true;
}

/** Czy adres nalezy do aktywnego czlonka zespolu (profiles.email, is_active). Blad = nie. */
async function isActiveStaffEmail(adminClient: SupabaseClient, email: string): Promise<boolean> {
  const { data, error } = await adminClient
    .from('profiles')
    .select('email')
    .eq('is_active', true)
    .not('email', 'is', null);
  if (error) {
    console.error('profiles read error (test email)', errorSummary(error));
    return false;
  }
  const wanted = email.toLowerCase();
  return (data ?? []).some(
    (row) => typeof row.email === 'string' && row.email.trim().toLowerCase() === wanted,
  );
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

  // INSTANCE_GETRESPONSE=off (VPS biura bez zgody admina na egress do GetResponse): funkcja nie
  // istnieje. Brak zmiennej (Supabase Cloud) = włączona, jak dotąd.
  if (Deno.env.get('INSTANCE_GETRESPONSE')?.trim().toLowerCase() === 'off') {
    return json({ error: 'Integracja GetResponse jest wyłączona na tej instancji.', code: 'GETRESPONSE_DISABLED' }, 404);
  }

  /** Blad GR: do logow tylko status i kod bledu GR (tresc moze zawierac adresy kontaktow). */
  const grError = (message: string, context: string, r: { status: number; body: unknown }) => {
    console.error(`GR API error (${context})`, r.status, errorSummary(r.body).code ?? '');
    return json({ error: message, status: r.status }, 502);
  };

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !anonKey || !serviceKey) {
      return json({ error: 'Brak konfiguracji srodowiska' }, 500);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Brak autoryzacji' }, 401);

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const { data: callerUser, error: userError } = await callerClient.auth.getUser();
    if (userError || !callerUser?.user) {
      return json({ error: 'Nie udalo sie zweryfikowac sesji' }, 401);
    }
    const callerId = callerUser.user.id;

    const { data: isWriter, error: roleError } = await callerClient.rpc('is_writer');
    if (roleError) {
      console.error('is_writer rpc error', errorSummary(roleError));
      return json({ error: 'Nie udalo sie zweryfikowac uprawnien' }, 500);
    }
    if (isWriter !== true) {
      return json({ error: 'Brak uprawnien (wymagana rola: pracownik lub posel)' }, 403);
    }
    if (!(await isCallerAal2(callerClient))) {
      return json({ error: 'Wymagane uwierzytelnienie dwuskladnikowe (2FA)' }, 403);
    }

    const body = (await req.json().catch(() => null)) as RequestBody | null;
    if (!body || typeof body.action !== 'string') {
      return json({ error: 'Brak akcji (action)' }, 400);
    }
    const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};

    // Admin client (service_role) - ustawienia GR, zapis contacts.gr_contact_id, audyt
    const adminClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const settings = await loadGrSettings(adminClient);
    if (!settings.api_key) {
      return json(
        {
          error: 'Klucz API GetResponse nie jest skonfigurowany. Skonfiguruj w /biuro/admin/integracje.',
          code: 'GR_NOT_CONFIGURED',
        },
        409,
      );
    }

    switch (body.action) {
      case 'check_status': {
        const r = await grRequest(settings.api_key, '/accounts');
        if (!r.ok) {
          console.error('GR API error (check_status)', r.status, errorSummary(r.body).code ?? '');
          return json({ ok: false, status: r.status }, 200);
        }
        const account = r.body as { accountId?: string; companyName?: string; email?: string };
        return json(
          {
            ok: true,
            account: {
              account_id: account?.accountId,
              company_name: account?.companyName,
              email: account?.email,
            },
            settings_summary: {
              has_api_key: true,
              has_default_list: Boolean(settings.default_list_id),
              has_from_field: Boolean(settings.from_field_id),
              from_name: settings.from_name,
              from_email: settings.from_email,
            },
          },
          200,
        );
      }

      case 'list_campaigns': {
        const r = await grRequest(
          settings.api_key,
          '/campaigns?fields=campaignId,name,description,createdOn',
        );
        if (!r.ok) return grError('GR API blad', 'list_campaigns', r);
        return json({ campaigns: r.body }, 200);
      }

      case 'list_from_fields': {
        const r = await grRequest(
          settings.api_key,
          '/from-fields?fields=fromFieldId,name,email,isActive',
        );
        if (!r.ok) return grError('GR API blad', 'list_from_fields', r);
        return json({ from_fields: r.body }, 200);
      }

      case 'list_newsletters': {
        const perPageRaw = Number(payload.per_page ?? 50);
        const pageRaw = Number(payload.page ?? 1);
        const perPage = Number.isInteger(perPageRaw) ? Math.min(Math.max(perPageRaw, 1), 100) : 50;
        const page = Number.isInteger(pageRaw) ? Math.max(pageRaw, 1) : 1;
        const params = new URLSearchParams({
          'sort[sendOn]': 'desc',
          perPage: String(perPage),
          page: String(page),
          fields: 'newsletterId,name,subject,status,createdOn,sendOn,sendSettings,sendMetrics',
        });
        const r = await grRequest(settings.api_key, `/newsletters?${params}`);
        if (!r.ok) return grError('GR API blad', 'list_newsletters', r);
        return json({ newsletters: r.body }, 200);
      }

      case 'send_newsletter': {
        if (!(await canManageNewsletters(callerClient))) {
          return json(
            { error: 'Brak uprawnień: newsletter może wysłać tylko Poseł/Posłanka, Administrator lub opiekun obszaru Newsletter.' },
            403,
          );
        }
        const { name, html, plain, issue_id: issueId } = payload;
        if (
          typeof name !== 'string' || !name.trim() ||
          typeof html !== 'string' || !html.trim() ||
          typeof issueId !== 'string' || !UUID_RE.test(issueId)
        ) {
          return json({ error: 'Wymagane: name, html, issue_id' }, 400);
        }
        if (html.length > MAX_CONTENT_LENGTH || (plain != null && (typeof plain !== 'string' || plain.length > MAX_CONTENT_LENGTH))) {
          return json({ error: 'Tresc newslettera jest za dluga' }, 400);
        }
        const listId = pickGrId(payload.list_id, settings.default_list_id);
        const fromFieldId = pickGrId(payload.from_field_id, settings.from_field_id);
        if (!listId) return json({ error: 'Brak lub nieprawidlowa lista odbiorcow (list_id)' }, 400);
        if (!fromFieldId) return json({ error: 'Brak lub nieprawidlowy from_field_id (skonfiguruj w GR)' }, 400);
        const replyToFieldId = payload.reply_to_field_id == null || payload.reply_to_field_id === ''
          ? null
          : pickGrId(payload.reply_to_field_id);
        if (payload.reply_to_field_id && !replyToFieldId) {
          return json({ error: 'Nieprawidlowy reply_to_field_id' }, 400);
        }
        const plainText = typeof plain === 'string'
          ? plain
          : html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100_000);

        // Strona posla (app_settings.public_site_url, A8): wersja online wydania musi byc juz
        // opublikowana na stronie (web_published_at ustawia publisher po udanym deployu), zanim mail
        // z linkiem do niej trafi na liste. Bez public_site_url (Vercel) wersje online serwuje portal.
        const [siteUrlRes, publishedRes] = await Promise.all([
          adminClient.rpc('public_site_url'),
          adminClient.from('newsletter_issues').select('web_published_at').eq('id', issueId).maybeSingle(),
        ]);
        if (siteUrlRes.error || publishedRes.error) {
          console.error('newsletter publish check error (send)', issueId, errorSummary(siteUrlRes.error ?? publishedRes.error));
          return json({ error: 'Nie udalo sie sprawdzic publikacji wersji online' }, 500);
        }
        if (
          typeof siteUrlRes.data === 'string' && siteUrlRes.data !== '' &&
          publishedRes.data && !publishedRes.data.web_published_at
        ) {
          return json({ error: 'Najpierw opublikuj wersję online na stronie posła' }, 409);
        }

        // Rezerwacja zapisanego szkicu jednym UPDATE (draft -> sending): z rownoleglych wysylek
        // tego samego wydania przechodzi jedna, a od tej chwili nikt nie zmieni tematu ani wersji
        // online (klient zmienia tylko wiersze 'draft'). Temat bierzemy z zarezerwowanego wiersza.
        const { data: reserved, error: reserveErr } = await adminClient
          .from('newsletter_issues')
          .update({ status: 'sending' })
          .eq('id', issueId)
          .eq('status', 'draft')
          .select('subject');
        if (reserveErr) {
          console.error('newsletter_issues reserve error (send)', issueId, errorSummary(reserveErr));
          return json({ error: 'Nie udalo sie zarezerwowac wydania newslettera' }, 500);
        }
        if (!reserved || reserved.length === 0) {
          const { data: existing, error: existingErr } = await adminClient
            .from('newsletter_issues')
            .select('id')
            .eq('id', issueId)
            .maybeSingle();
          if (existingErr) {
            console.error('newsletter_issues read error (send)', errorSummary(existingErr));
            return json({ error: 'Nie udalo sie odczytac wydania newslettera' }, 500);
          }
          if (!existing) return json({ error: 'Nie znaleziono wydania newslettera' }, 404);
          return json({ error: 'To wydanie jest juz wysylane albo zostalo wyslane' }, 409);
        }
        /** Zwalnia rezerwacje (sending -> draft), gdy GR na pewno nie przyjelo wysylki. */
        const releaseIssue = async () => {
          const { error } = await adminClient
            .from('newsletter_issues')
            .update({ status: 'draft' })
            .eq('id', issueId)
            .eq('status', 'sending');
          if (error) console.error('newsletter_issues release error', issueId, errorSummary(error));
        };

        const subject = typeof reserved[0].subject === 'string' ? reserved[0].subject.trim() : '';
        if (!subject) {
          await releaseIssue();
          return json({ error: 'Wydanie nie ma tematu' }, 400);
        }
        // Dowod tresci faktycznie wyslanej na liste (HTML maila nie jest przechowywany w wydaniu).
        const sendAudit = {
          subject,
          list_id: listId,
          from_field_id: fromFieldId,
          issue_id: issueId,
          html_sha256: await sha256Hex(html),
          plain_sha256: await sha256Hex(plainText),
        };

        const grBody: Record<string, unknown> = {
          name: name.slice(0, 128),
          subject: subject.slice(0, 256),
          campaign: { campaignId: listId },
          fromField: { fromFieldId },
          content: { html, plain: plainText },
          sendSettings: {
            selectedCampaigns: [listId],
          },
        };
        if (replyToFieldId) {
          grBody.replyTo = { fromFieldId: replyToFieldId };
        }

        // Wyjatek sieci (fetch) zostawia wydanie w 'sending': wynik w GR nieznany, wiec ponowna
        // wysylka TEGO wydania jest zablokowana (edytor przy kolejnej probie zapisze nowe).
        const r = await grRequest(settings.api_key, '/newsletters', {
          method: 'POST',
          body: JSON.stringify(grBody),
        });

        if (!r.ok) {
          await releaseIssue();
          await serviceAudit(adminClient, callerId, 'newsletter.send_failed', 'newsletter', issueId, {
            ...sendAudit,
            gr_status: r.status,
            gr_error: r.body,
          });
          return grError('GR API odrzucilo wysylke', 'send_newsletter', r);
        }

        const created = r.body as { newsletterId?: string; href?: string; status?: string };
        const grNewsletterId =
          typeof created?.newsletterId === 'string' && GR_ID_RE.test(created.newsletterId)
            ? created.newsletterId
            : null;

        // Mail juz poszedl - blad oznaczenia nie cofa wysylki, klient dostaje issue_marked=false
        // (wydanie zostaje w 'sending': niepubliczne i zablokowane przed ponowna wysylka).
        const { data: marked, error: markErr } = await adminClient
          .from('newsletter_issues')
          .update({ status: 'sent', sent_at: new Date().toISOString(), gr_newsletter_id: grNewsletterId })
          .eq('id', issueId)
          .eq('status', 'sending')
          .select('id');
        if (markErr) console.error('newsletter_issues mark sent error', issueId, errorSummary(markErr));
        const issueMarked = !markErr && (marked?.length ?? 0) === 1;

        await serviceAudit(adminClient, callerId, 'newsletter.send', 'newsletter', issueId, {
          ...sendAudit,
          gr_newsletter_id: created?.newsletterId,
          status: created?.status,
          issue_marked: issueMarked,
        });

        return json(
          {
            newsletter_id: created?.newsletterId,
            status: created?.status,
            href: created?.href,
            issue_marked: issueMarked,
          },
          200,
        );
      }

      case 'send_test_newsletter': {
        // Adres testowy nie moze zostac na produkcyjnej liscie (RODO). GR API v3 nie ma
        // wysylki na dowolny adres - newsletter musi trafic do kontaktu z listy kampanii
        // (sendSettings.selectedContacts). Dlatego:
        //  1. kontakt juz obecny na liscie -> uzywamy go i NIE usuwamy;
        //  2. brak kontaktu -> dodajemy go tylko na czas testu i po zakonczeniu wysylki
        //     (sendMetrics.status='finished', max TEST_CLEANUP_MAX_WAIT_MS) usuwamy w tle
        //     (EdgeRuntime.waitUntil); przy bledzie tworzenia newslettera usuwamy od razu.
        const { test_email: testEmail, name, subject, html, plain } = payload;
        if (
          typeof testEmail !== 'string' || !testEmail.trim() ||
          typeof subject !== 'string' || !subject.trim() ||
          typeof html !== 'string' || !html.trim()
        ) {
          return json({ error: 'Wymagane: test_email, subject, html' }, 400);
        }
        if (name != null && typeof name !== 'string') {
          return json({ error: 'Nieprawidlowa nazwa newslettera' }, 400);
        }
        if (html.length > MAX_CONTENT_LENGTH || (plain != null && (typeof plain !== 'string' || plain.length > MAX_CONTENT_LENGTH))) {
          return json({ error: 'Tresc newslettera jest za dluga' }, 400);
        }
        const listId = pickGrId(payload.list_id, settings.default_list_id);
        const fromFieldId = pickGrId(payload.from_field_id, settings.from_field_id);
        if (!listId) return json({ error: 'Brak lub nieprawidlowa lista odbiorcow (list_id)' }, 400);
        if (!fromFieldId) return json({ error: 'Brak lub nieprawidlowy from_field_id (skonfiguruj w GR)' }, 400);

        const email = testEmail.trim();
        if (email.length > 254 || !EMAIL_RE.test(email)) {
          return json({ error: 'Niepoprawny adres email testowy' }, 400);
        }
        // Wysylka testowa nie moze sluzyc do mailingu jako Posel na dowolny adres: zarzadzajacy
        // newsletterem - na adres aktywnego czlonka zespolu, pozostali - tylko na wlasny adres konta.
        const ownEmail = (callerUser.user.email ?? '').trim().toLowerCase();
        const toOwnAddress = ownEmail !== '' && email.toLowerCase() === ownEmail;
        if (!toOwnAddress) {
          if (!(await canManageNewsletters(callerClient))) {
            return json(
              { error: 'Mail testowy możesz wysłać tylko na adres swojego konta. Na inne adresy zespołu wysyła Poseł/Posłanka, Administrator lub opiekun obszaru Newsletter.' },
              403,
            );
          }
          if (!(await isActiveStaffEmail(adminClient, email))) {
            return json(
              { error: 'Wysyłkę testową można wysłać tylko na adres aktywnego członka zespołu biura.' },
              403,
            );
          }
        }

        // Limit godzinowy per osoba; wpis przed wysylka - rownolegle proby od razu sie licza.
        const { count: recentTests, error: countErr } = await adminClient
          .from('audit_log')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', callerId)
          .eq('action', 'newsletter.send_test_attempt')
          .gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString());
        if (countErr) {
          console.error('newsletter test limit count error', errorSummary(countErr));
          return json({ error: 'Nie udalo sie sprawdzic limitu wysylek testowych' }, 500);
        }
        if ((recentTests ?? 0) >= TEST_SEND_HOURLY_LIMIT) {
          return json(
            { error: `Wykorzystano limit wysyłek testowych (${TEST_SEND_HOURLY_LIMIT} na godzinę). Spróbuj później.` },
            429,
          );
        }
        const attemptLogged = await serviceAudit(adminClient, callerId, 'newsletter.send_test_attempt', 'newsletter', null, {
          subject,
          list_id: listId,
          own_address: toOwnAddress,
        });
        if (!attemptLogged) {
          return json({ error: 'Nie udalo sie zapisac wysylki testowej w dzienniku' }, 500);
        }

        // 1. Czy adres juz jest na liscie (wtedy kontakt nie jest nasz - nie usuwamy)
        let contactId = await findListContactId(settings.api_key, email, listId);
        let createdForTest = false;
        if (!contactId) {
          // 202 = przyjete (async); 409 = juz istnieje (rownolegle dodany) -> nie nasz
          const addR = await grRequest(settings.api_key, '/contacts', {
            method: 'POST',
            body: JSON.stringify({ email, campaign: { campaignId: listId } }),
          });
          if (!addR.ok && addR.status !== 409) {
            return grError('Nie udalo sie dodac adresu testowego do listy w GR', 'send_test add', addR);
          }
          createdForTest = addR.ok;

          // 2. Znajdz contactId (dodawanie w GR jest async - kilka prob)
          for (let attempt = 0; attempt < 5 && !contactId; attempt++) {
            await sleep(800);
            contactId = await findListContactId(settings.api_key, email, listId);
          }
        }

        if (!contactId) {
          if (createdForTest) {
            await scheduleTestContactCleanup(
              removeTestContact(settings.api_key, email, listId, null, null),
            );
          }
          return json(
            { error: 'GetResponse jeszcze nie przetworzyl adresu testowego. Sprobuj ponownie za chwile.' },
            409,
          );
        }

        // 3. Utworz newsletter kierowany TYLKO do tego kontaktu (selectedContacts)
        const label = (typeof name === 'string' && name.trim() ? name : subject).slice(0, 118);
        const grBody: Record<string, unknown> = {
          name: `[TEST] ${label}`.slice(0, 128),
          subject: `[TEST] ${subject}`.slice(0, 256),
          campaign: { campaignId: listId },
          fromField: { fromFieldId },
          content: {
            html,
            plain: typeof plain === 'string'
              ? plain
              : html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100_000),
          },
          sendSettings: { selectedContacts: [contactId] },
        };

        const r = await grRequest(settings.api_key, '/newsletters', {
          method: 'POST',
          body: JSON.stringify(grBody),
        });

        if (!r.ok) {
          if (createdForTest) {
            await removeTestContact(settings.api_key, email, listId, contactId, null).catch((err) =>
              console.error('GR test contact cleanup error', errorSummary(err)),
            );
          }
          await serviceAudit(adminClient, callerId, 'newsletter.send_test_failed', 'newsletter', null, {
            gr_status: r.status,
            gr_error: r.body,
            subject,
            list_id: listId,
          });
          return grError('GR API odrzucilo wysylke testowa', 'send_test_newsletter', r);
        }

        const createdTest = r.body as { newsletterId?: string; status?: string };
        const testNewsletterId =
          typeof createdTest?.newsletterId === 'string' && GR_ID_RE.test(createdTest.newsletterId)
            ? createdTest.newsletterId
            : null;
        if (createdForTest) {
          await scheduleTestContactCleanup(
            removeTestContact(settings.api_key, email, listId, contactId, testNewsletterId),
          );
        }

        await serviceAudit(adminClient, callerId, 'newsletter.send_test', 'newsletter', null, {
          gr_newsletter_id: createdTest?.newsletterId,
          subject,
          list_id: listId,
          test: true,
          test_contact: createdForTest ? 'temporary_removed_after_send' : 'existing_on_list',
        });

        return json(
          { newsletter_id: createdTest?.newsletterId, status: createdTest?.status, contact_id: contactId },
          200,
        );
      }

      case 'delete_newsletter': {
        if (!(await canManageNewsletters(callerClient))) {
          return json(
            { error: 'Brak uprawnień: newsletter może usunąć tylko Poseł/Posłanka, Administrator lub opiekun obszaru Newsletter.' },
            403,
          );
        }
        const newsletterId = pickGrId(payload.newsletter_id);
        if (!newsletterId) return json({ error: 'Brak lub nieprawidlowy newsletter_id' }, 400);

        const r = await grRequest(settings.api_key, `/newsletters/${encodeURIComponent(newsletterId)}`, {
          method: 'DELETE',
        });

        if (!r.ok && r.status !== 404) {
          return grError('GR API blad przy usuwaniu', 'delete_newsletter', r);
        }

        await serviceAudit(adminClient, callerId, 'newsletter.delete', 'newsletter', null, {
          gr_newsletter_id: newsletterId,
        });

        return json({ ok: true }, 200);
      }

      case 'sync_contact': {
        const contactId = payload.contact_id;
        if (typeof contactId !== 'string' || !UUID_RE.test(contactId)) {
          return json({ error: 'Brak lub nieprawidlowy contact_id' }, 400);
        }
        const listId = pickGrId(payload.list_id, settings.default_list_id);
        if (!listId) {
          return json({ error: 'Brak lub nieprawidlowa lista mailingowa (skonfiguruj default_list_id)' }, 400);
        }

        // RODO: nie ufaj emailowi/zgodzie z klienta. Odczytaj kontakt z bazy klientem
        // wywolujacego (RLS: data_scope) i wysylaj do GR TYLKO gdy newsletter_consent = true.
        const { data: dbContact, error: contactErr } = await callerClient
          .from('contacts')
          .select('email, first_name, last_name, newsletter_consent')
          .eq('id', contactId)
          .maybeSingle();

        if (contactErr) console.error('contact read error (sync)', errorSummary(contactErr));
        if (contactErr || !dbContact) return json({ error: 'Nie znaleziono kontaktu' }, 404);
        if (dbContact.newsletter_consent !== true) {
          return json({ error: 'Kontakt nie wyrazil zgody na newsletter', code: 'NO_CONSENT' }, 409);
        }

        const email = (dbContact.email as string | null)?.trim();
        if (!email) return json({ error: 'Kontakt nie ma adresu email' }, 400);
        if (!EMAIL_RE.test(email)) {
          return json({ error: 'Niepoprawny adres email kontaktu' }, 400);
        }
        const name = [dbContact.first_name, dbContact.last_name]
          .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
          .join(' ')
          .trim();

        // Dodaj kontakt do GR (202 Accepted = async, 409 = juz istnieje)
        const addBody: Record<string, unknown> = {
          email,
          campaign: { campaignId: listId },
        };
        if (name) addBody.name = name;

        const addR = await grRequest(settings.api_key, '/contacts', {
          method: 'POST',
          body: JSON.stringify(addBody),
        });

        if (!addR.ok && addR.status !== 409) {
          return grError('GR API blad przy dodawaniu kontaktu', 'sync_contact', addR);
        }

        // Pobierz contactId z GR (API jest async - szukamy po emailu)
        const grContactId = await findListContactId(settings.api_key, email, listId);

        // Zapisz gr_contact_id w bazie (service_role - po udanym odczycie przez RLS)
        if (grContactId) {
          const { error: updateErr } = await adminClient
            .from('contacts')
            .update({ gr_contact_id: grContactId })
            .eq('id', contactId);
          if (updateErr) console.error('gr_contact_id update error (sync)', errorSummary(updateErr));
        }

        await serviceAudit(adminClient, callerId, 'contact.gr_sync', 'contact', contactId, {
          gr_contact_id: grContactId,
          email,
          list_id: listId,
        });

        return json({ ok: true, gr_contact_id: grContactId }, 200);
      }

      case 'unsync_contact': {
        const contactId = payload.contact_id;
        if (typeof contactId !== 'string' || !UUID_RE.test(contactId)) {
          return json({ error: 'Brak lub nieprawidlowy contact_id' }, 400);
        }
        const listId = pickGrId(payload.list_id, settings.default_list_id);

        // Kontakt czytany przez RLS wywolujacego - brak dostepu = brak operacji.
        const { data: dbContact, error: contactErr } = await callerClient
          .from('contacts')
          .select('email, gr_contact_id')
          .eq('id', contactId)
          .maybeSingle();
        if (contactErr) console.error('contact read error (unsync)', errorSummary(contactErr));
        if (contactErr || !dbContact) return json({ error: 'Nie znaleziono kontaktu' }, 404);

        // Wyznacz GR contact ID - z bazy lub wyszukaj po emailu kontaktu z bazy (odczyt przez
        // RLS wywolujacego). Email z payloadu jest ignorowany: pozwalalby usunac z listy GR
        // dowolnego subskrybenta. Zapisany gr_contact_id (kolumna edytowalna przez REST) jest
        // uzywany tylko, gdy kontakt w GR ma ten sam email co kontakt w bazie.
        const dbEmail = typeof dbContact.email === 'string' ? dbContact.email.trim() : '';
        const dbEmailValid = dbEmail.length <= 254 && EMAIL_RE.test(dbEmail);
        let targetGrId: string | null = null;
        const storedGrId = pickGrId(dbContact.gr_contact_id);
        if (storedGrId && dbEmailValid) {
          const check = await grRequest(
            settings.api_key,
            `/contacts/${encodeURIComponent(storedGrId)}?fields=contactId,email`,
          );
          const grEmail = (check.body as { email?: unknown } | null)?.email;
          if (check.ok && typeof grEmail === 'string' && grEmail.trim().toLowerCase() === dbEmail.toLowerCase()) {
            targetGrId = storedGrId;
          } else if (!check.ok && check.status !== 404) {
            return grError('GR API blad przy odczycie kontaktu', 'unsync_contact check', check);
          }
        }
        if (!targetGrId && listId && dbEmailValid) {
          targetGrId = await findListContactId(settings.api_key, dbEmail, listId);
        }

        if (!targetGrId) {
          // Nie znaleziono w GR - wyczysc lokalnie i zakoncz
          const { error: clearErr } = await adminClient
            .from('contacts')
            .update({ gr_contact_id: null })
            .eq('id', contactId);
          if (clearErr) console.error('gr_contact_id clear error (unsync)', errorSummary(clearErr));
          return json({ ok: true, note: 'kontakt nie byl w GR' }, 200);
        }

        const delR = await grRequest(settings.api_key, `/contacts/${encodeURIComponent(targetGrId)}`, {
          method: 'DELETE',
        });

        if (!delR.ok && delR.status !== 404) {
          return grError('GR API blad przy usuwaniu kontaktu', 'unsync_contact', delR);
        }

        // Wyczysc gr_contact_id w bazie (service_role - po udanym odczycie przez RLS)
        const { error: clearErr } = await adminClient
          .from('contacts')
          .update({ gr_contact_id: null })
          .eq('id', contactId);
        if (clearErr) console.error('gr_contact_id clear error (unsync)', errorSummary(clearErr));

        await serviceAudit(adminClient, callerId, 'contact.gr_unsync', 'contact', contactId, {
          gr_contact_id: targetGrId,
        });

        return json({ ok: true }, 200);
      }

      default:
        return json({ error: 'Nieznana akcja' }, 400);
    }
  } catch (err) {
    console.error('getresponse-proxy error', errorSummary(err));
    return json({ error: 'Wystapil nieoczekiwany blad' }, 500);
  }
});
