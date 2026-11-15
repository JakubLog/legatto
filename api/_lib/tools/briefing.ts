import { getServiceClient } from '../supabase.js';
import { applyDataScope } from '../access.js';
import { isPoselRole, type McpAuthContext } from '../auth.js';
import { getSiteIdentity, mpForms, type MpForms } from '../siteIdentity.js';
import { budgetTools } from './budget.js';
import { type ToolDefinition, jsonResult, markCase, markEvent, optionalNumber, optionalUuid, ToolValidationError } from './types.js';
import { CASE_LABELS, EVENT_LABELS, withLabels } from './labels.js';

// Procedury startowe rozmowy: Puls Biura i decyzje dla Posla/Administratora, propozycje pracy
// dla Pracownika (wg obszarow, ktorych jest opiekunem) oraz status jednej osoby.
// MCP dziala na service_role (brak auth.uid()), wiec sygnaly licza bazodanowe odpowiedniki
// get_module_pulse / get_person_pulse: service_module_pulse / service_person_pulse.

type PulseLevel = 'ok' | 'warning' | 'critical';

// Etykiety jak w src/lib/moduleOwners.ts (OWNED_MODULES, PULSE_LEVEL_LABELS).
const MODULE_LABELS: Record<string, string> = {
  kalendarz: 'Kalendarz',
  teren: 'Widoczność w terenie',
  interpelacje: 'Interpelacje',
  budzet: 'Budżet biura',
  newsletter: 'Newsletter (wysyłka co tydzień)',
};
const LEVEL_LABELS: Record<PulseLevel, string> = {
  ok: 'Działania w normie',
  warning: 'W ostatnim czasie osłabienie działań',
  critical: 'Bardzo duży spadek działań',
};
const LEVEL_RANK: Record<PulseLevel, number> = { ok: 0, warning: 1, critical: 2 };
// Jak PulseGauge: ok = 100, osłabienie = 50, duży spadek = 0; >= 80 Dobry, >= 50 Wymaga uwagi.
const LEVEL_SCORE: Record<PulseLevel, number> = { ok: 100, warning: 50, critical: 0 };
// Forma "Poseł"/"Posłanka" wg site_identity.mp_gender instancji.
function roleLabel(role: string, forms: MpForms): string {
  const labels: Record<string, string> = {
    posel: forms.nominative,
    administrator: 'Administrator',
    pracownik: 'Pracownik',
    asystent: 'Asystent',
  };
  return labels[role] ?? role;
}
// Jak src/components/pulse/PersonTrend.tsx (METRIC_LABELS).
const METRIC_LABELS: Record<string, string> = {
  active_days: 'Dni z logowaniem lub MCP',
  actions: 'Akcje w systemie',
  events_created: 'Dodane wydarzenia',
  cases_resolved: 'Załatwione sprawy',
  interpellations: 'Wgrane interpelacje',
  expenses_added: 'Wpisane wydatki',
};

const OPEN_CASE_STATUSES = ['nowa', 'w_toku', 'oczekuje'];
const DAY_MS = 24 * 60 * 60 * 1000;
// Newsletter wysylany co tydzien (jak src/hooks/useModulePulse.ts): ostatnia wysylka > 7 dni temu
// = oslabienie, > 14 dni albo brak = duzy spadek.
const NEWSLETTER_WARNING_DAYS = 7;
const NEWSLETTER_CRITICAL_DAYS = 14;
const GR_NEWSLETTERS_URL = 'https://api.getresponse.com/v3/newsletters';
const GR_TIMEOUT_MS = 5_000;
const KAMPANIE_PATH = '/biuro/kontakty?widok=kampanie';
// Opiekun z najwyzej tyloma dniami aktywnosci w 14 dniach obniza sygnal obszaru (module_owner_activity).
const LOW_ACTIVITY_DAYS = 3;
const PERIODS_NOTE =
  'Porównanie do tego samego momentu (czas Europe/Warsaw): ten tydzień = od poniedziałku do teraz vs taki sam odcinek poprzedniego tygodnia; ' +
  'ten miesiąc = od 1. dnia do teraz vs taki sam odcinek poprzedniego miesiąca. 8_tygodni: od najstarszego, ostatni = bieżący (niepełny) tydzień.';

interface OwnerActivity {
  user_id: string;
  full_name: string | null;
  active_days: number;
  last_active_at: string | null;
}

interface PulseRow {
  module: string;
  level: PulseLevel;
  reasons: string[] | null;
  owner_activity: OwnerActivity[] | null;
}

interface PersonPulseRow {
  metric: string;
  this_week: number;
  prev_week: number;
  this_month: number;
  prev_month: number;
  weekly: number[];
}

interface Area {
  obszar: string;
  etykieta: string;
  sygnal: PulseLevel;
  sygnal_opis: string;
  powody: string[];
  opiekunowie: Array<{ id: string; imie_nazwisko: string | null; dni_aktywnosci_14d: number }>;
}

interface AreasResult {
  areas: Area[];
  notes: Record<string, string>;
}

interface NewsletterSends {
  level: PulseLevel;
  reason: string | null;
}

interface InterpellationRow {
  id: string;
  subject: string;
  recipient: string;
  status: string;
  revision: number;
  review_notes: string | null;
  submitted_at: string | null;
  deadline_at: string | null;
}

// type (nie interface): markCase przyjmuje Record<string, unknown>.
type CaseRow = {
  id: string;
  title: string;
  status: string;
  priority: string;
  source: string;
  due_date: string | null;
};

// Wysylki newslettera z dwoch zrodel (jak src/lib/newsletterSends.utils.ts):
// - historia GetResponse (klucz getresponse_api_key w Vault przez service_get_secrets, jak getresponse-proxy),
//   takze wysylki zrobione bezposrednio w GR;
// - wydania wyslane z aplikacji (newsletter_issues, status 'sent').
// GR v3 nie zwraca statusu 'sent': postep wysylki jest w sendMetrics.status
// ('scheduled' | 'in_progress' | 'finished'); bez sendMetrics wyslany = sendOn w przeszlosci.
// Wysylki testowe ([TEST]) pomijane. null = oba zrodla niedostepne.
const NEWSLETTER_FAILED_STATUSES = new Set(['draft', 'failed', 'error', 'canceled', 'cancelled']);

function grSendTimes(body: unknown[], now: number): Map<string, number> {
  const sends = new Map<string, number>();
  for (const item of body) {
    if (typeof item !== 'object' || item === null) continue;
    const n = item as {
      newsletterId?: unknown;
      name?: unknown;
      subject?: unknown;
      status?: unknown;
      sendOn?: unknown;
      sendMetrics?: { status?: unknown } | null;
    };
    if (typeof n.newsletterId !== 'string' || typeof n.sendOn !== 'string') continue;
    if (
      (typeof n.name === 'string' && n.name.startsWith('[TEST]')) ||
      (typeof n.subject === 'string' && n.subject.startsWith('[TEST]'))
    ) {
      continue;
    }
    if (typeof n.status === 'string' && NEWSLETTER_FAILED_STATUSES.has(n.status.toLowerCase())) continue;
    const time = new Date(n.sendOn).getTime();
    if (Number.isNaN(time)) continue;
    const metrics = typeof n.sendMetrics?.status === 'string' ? n.sendMetrics.status.toLowerCase() : null;
    const sent = metrics ? metrics === 'finished' || metrics === 'in_progress' : time <= now;
    if (sent) sends.set(`gr:${n.newsletterId}`, time);
  }
  return sends;
}

async function fetchGrNewsletters(): Promise<unknown[] | null> {
  try {
    const { data, error } = await getServiceClient().rpc('service_get_secrets', { p_keys: ['getresponse_api_key'] });
    if (error) return null;
    const row = ((data ?? []) as { key: string; value: string }[]).find((r) => r.key === 'getresponse_api_key');
    const apiKey = row?.value.trim() ?? '';
    if (!apiKey) return null;

    const params = new URLSearchParams({
      'sort[sendOn]': 'desc',
      perPage: '20',
      fields: 'newsletterId,name,subject,status,sendOn,sendMetrics',
    });
    const res = await fetch(`${GR_NEWSLETTERS_URL}?${params}`, {
      headers: { 'X-Auth-Token': `api-key ${apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(GR_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    return Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

async function fetchSentIssues(): Promise<{ gr_newsletter_id: string | null; sent_at: string | null }[] | null> {
  const { data, error } = await getServiceClient()
    .from('newsletter_issues')
    .select('gr_newsletter_id, sent_at')
    .eq('status', 'sent')
    .order('sent_at', { ascending: false })
    .limit(50);
  return error ? null : data;
}

async function newsletterSends(): Promise<NewsletterSends | null> {
  const [grNewsletters, issues] = await Promise.all([fetchGrNewsletters(), fetchSentIssues()]);
  if (!grNewsletters && !issues) return null;

  const now = Date.now();
  const sends = grSendTimes(grNewsletters ?? [], now);
  for (const issue of issues ?? []) {
    const time = issue.sent_at ? new Date(issue.sent_at).getTime() : Number.NaN;
    if (Number.isNaN(time)) continue;
    const key = issue.gr_newsletter_id ? `gr:${issue.gr_newsletter_id}` : `issue:${issue.sent_at}`;
    if (!sends.has(key)) sends.set(key, time);
  }

  const times = [...sends.values()];
  const days = times.length > 0 ? Math.floor((now - Math.max(...times)) / DAY_MS) : null;
  const level: PulseLevel =
    days === null || days > NEWSLETTER_CRITICAL_DAYS
      ? 'critical'
      : days > NEWSLETTER_WARNING_DAYS
        ? 'warning'
        : 'ok';
  return {
    level,
    reason:
      level === 'ok'
        ? null
        : days === null
          ? 'Brak wysłanych newsletterów'
          : `Ostatnia wysyłka ${days} dni temu (cel: co tydzień)`,
  };
}

function toArea(row: PulseRow): Area {
  return {
    obszar: row.module,
    etykieta: MODULE_LABELS[row.module] ?? row.module,
    sygnal: row.level,
    sygnal_opis: LEVEL_LABELS[row.level],
    powody: row.reasons ?? [],
    opiekunowie: (row.owner_activity ?? []).map((o) => ({
      id: o.user_id,
      imie_nazwisko: o.full_name,
      dni_aktywnosci_14d: o.active_days,
    })),
  };
}

// Sygnaly obszarow; ownerId = tylko obszary tej osoby. Newsletter uzupelniony o regule
// cotygodniowej wysylki (gorszy poziom wygrywa), jak mergeNewsletter we froncie.
async function loadAreas(ownerId: string | null): Promise<AreasResult> {
  const { data, error } = await getServiceClient().rpc('service_module_pulse');
  if (error) throw new Error(error.message);
  const rows = ((data ?? []) as PulseRow[]).filter(
    (row) => ownerId === null || (row.owner_activity ?? []).some((o) => o.user_id === ownerId),
  );

  const notes: Record<string, string> = {};
  const areas = rows.map(toArea);
  const newsletter = areas.find((a) => a.obszar === 'newsletter');
  if (newsletter) {
    const sends = await newsletterSends();
    if (!sends) {
      notes.wysylki_newslettera = 'niedostępne';
    } else {
      if (LEVEL_RANK[sends.level] > LEVEL_RANK[newsletter.sygnal]) {
        newsletter.sygnal = sends.level;
        newsletter.sygnal_opis = LEVEL_LABELS[sends.level];
      }
      if (sends.reason) newsletter.powody = [sends.reason, ...newsletter.powody];
    }
  }
  return { areas, notes };
}

function worstFirst(areas: Area[]): Area[] {
  return [...areas].sort((a, b) => LEVEL_RANK[b.sygnal] - LEVEL_RANK[a.sygnal]);
}

function officeScore(areas: Area[]): { wynik: number | null; stan: string | null } {
  if (areas.length === 0) return { wynik: null, stan: null };
  const wynik = Math.round(areas.reduce((sum, a) => sum + LEVEL_SCORE[a.sygnal], 0) / areas.length);
  return { wynik, stan: wynik >= 80 ? 'Dobry' : wynik >= 50 ? 'Wymaga uwagi' : 'Krytyczny' };
}

function change(current: number, previous: number): string {
  if (current === previous) return 'bez zmian';
  if (previous === 0) return 'nowe';
  const pct = Math.round(((current - previous) / previous) * 100);
  return `${pct > 0 ? '+' : ''}${pct}%`;
}

function parseDays(args: Record<string, unknown>): number {
  const days = optionalNumber(args, 'days') ?? 7;
  if (!Number.isInteger(days) || days < 1 || days > 14) {
    throw new ToolValidationError('Pole "days" musi być liczbą całkowitą 1-14.');
  }
  return days;
}

// Powiaty bez spotkania/wyjazdu w oknie visibility_alert_days (jak regula terenu w Pulsie)
// i bez zaplanowanej wizyty - kandydaci do zaplanowania. Liczniki ponizej (tylko briefing
// Pracownika) licza wydarzenia i interpelacje z jego zakresu danych (scope_*), jak w aplikacji.
async function powiatyWithoutPresence(ctx: McpAuthContext): Promise<{ dni: number; powiaty: Array<{ id: number; nazwa: string }> }> {
  const supabase = getServiceClient();
  const setting = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'visibility_alert_days')
    .maybeSingle();
  if (setting.error) throw new Error(setting.error.message);
  const parsed = Number(setting.data?.value);
  const days = Number.isInteger(parsed) && parsed > 0 ? parsed : 90;
  const from = new Date(Date.now() - days * DAY_MS).toISOString();

  const [powiatyRes, eventsRes] = await Promise.all([
    supabase.from('powiaty').select('id, name').order('id'),
    applyDataScope(
      supabase
        .from('events')
        .select('powiat_id')
        .in('type', ['spotkanie', 'wyjazd'])
        .not('powiat_id', 'is', null)
        .gt('starts_at', from),
      ctx,
      'events',
    ),
  ]);
  if (powiatyRes.error) throw new Error(powiatyRes.error.message);
  if (eventsRes.error) throw new Error(eventsRes.error.message);

  const covered = new Set(((eventsRes.data ?? []) as Array<{ powiat_id: number }>).map((e) => e.powiat_id));
  const powiaty = ((powiatyRes.data ?? []) as Array<{ id: number; name: string }>)
    .filter((p) => !covered.has(p.id))
    .map((p) => ({ id: p.id, nazwa: p.name }));
  return { dni: days, powiaty };
}

async function upcomingEventsCount(ctx: McpAuthContext): Promise<number> {
  const now = Date.now();
  const { count, error } = await applyDataScope(
    getServiceClient()
      .from('events')
      .select('id', { count: 'exact', head: true })
      .gte('starts_at', new Date(now).toISOString())
      .lt('starts_at', new Date(now + 14 * DAY_MS).toISOString()),
    ctx,
    'events',
  );
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function overdueAcceptedCount(ctx: McpAuthContext): Promise<number> {
  const { count, error } = await applyDataScope(
    getServiceClient()
      .from('interpellations')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'zaakceptowana')
      .lt('deadline_at', new Date().toISOString()),
    ctx,
    'interpellations',
  );
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function poselBriefing(ctx: McpAuthContext, days: number) {
  const now = new Date();
  const nowIso = now.toISOString();
  const until = new Date(now.getTime() + days * DAY_MS).toISOString();
  const today = nowIso.slice(0, 10);
  const supabase = getServiceClient();

  const [pulse, decideRes, overdueRes, casesRes, eventsRes] = await Promise.all([
    loadAreas(null),
    applyDataScope(
      supabase
        .from('interpellations')
        .select('id, subject, recipient, status, revision, submitted_at', { count: 'exact' })
        .in('status', ['nowa', 'po_poprawkach'])
        .order('submitted_at', { ascending: true })
        .limit(20),
      ctx,
      'interpellations',
    ),
    applyDataScope(
      supabase
        .from('interpellations')
        .select('id, subject, recipient, accepted_at, deadline_at', { count: 'exact' })
        .eq('status', 'zaakceptowana')
        .lt('deadline_at', nowIso)
        .order('deadline_at', { ascending: true })
        .limit(20),
      ctx,
      'interpellations',
    ),
    applyDataScope(
      supabase
        .from('cases')
        .select('id, title, status, priority, source, due_date, assigned_to', { count: 'exact' })
        .in('status', OPEN_CASE_STATUSES)
        .lt('due_date', today)
        .order('due_date', { ascending: true })
        .limit(10),
      ctx,
      'cases',
    ),
    applyDataScope(
      supabase
        .from('events')
        .select('id, title, type, starts_at, ends_at, all_day, location, powiat_id, assigned_to, ics_source_id')
        .gte('starts_at', nowIso)
        .lte('starts_at', until)
        .order('starts_at', { ascending: true })
        .limit(30),
      ctx,
      'events',
    ),
  ]);
  if (decideRes.error) throw new Error(decideRes.error.message);
  if (overdueRes.error) throw new Error(overdueRes.error.message);
  if (casesRes.error) throw new Error(casesRes.error.message);
  if (eventsRes.error) throw new Error(eventsRes.error.message);

  const areas = worstFirst(pulse.areas);
  const toDecide = decideRes.count ?? decideRes.data?.length ?? 0;
  const overdueInterpellations = overdueRes.count ?? overdueRes.data?.length ?? 0;
  const overdueCases = casesRes.count ?? casesRes.data?.length ?? 0;
  const events = eventsRes.data ?? [];

  const steps: string[] = [];
  if (toDecide > 0) {
    steps.push(
      `Podejmij decyzję w ${toDecide} interpelacjach (Nowa / Po poprawkach): przeczytaj treść przez interpellations_get, potem interpellations_decide (zaakceptowana, uwagi z notes albo odrzucona).`,
    );
  }
  if (overdueInterpellations > 0) {
    steps.push(
      `Dopilnuj wysyłki ${overdueInterpellations} zaakceptowanych interpelacji po terminie; po faktycznym wysłaniu potwierdź interpellations_mark_sent.`,
    );
  }
  for (const area of areas.filter((a) => a.sygnal === 'critical')) {
    steps.push(
      area.opiekunowie.length > 0
        ? `Obszar „${area.etykieta}”: ${LEVEL_LABELS.critical.toLowerCase()} - porozmawiaj z opiekunem i sprawdź jego status przez person_status: ${area.opiekunowie.map((o) => `${o.imie_nazwisko ?? 'bez nazwy'} (user_id=${o.id})`).join(', ')}.`
        : `Obszar „${area.etykieta}”: ${LEVEL_LABELS.critical.toLowerCase()} i brak opiekuna - przypisz osobę odpowiedzialną w aplikacji (Puls Biura).`,
    );
  }
  const weakened = areas.filter((a) => a.sygnal === 'warning');
  if (weakened.length > 0) {
    steps.push(
      `Osłabienie działań: ${weakened.map((a) => a.etykieta).join(', ')} - przejrzyj powody; w razie potrzeby person_status dla opiekunów.`,
    );
  }
  if (overdueCases > 0) {
    steps.push(
      `${overdueCases} otwartych spraw po terminie - przejrzyj je (cases_get) i ponagl osoby przypisane albo zmień termin.`,
    );
  }
  if (events.length === 0) {
    steps.push(`Brak wydarzeń w kalendarzu na najbliższe ${days} dni - zaplanuj spotkania przez events_create.`);
  }
  if (pulse.notes.wysylki_newslettera) {
    steps.push('Historia wysyłek newslettera z GetResponse jest niedostępna - sygnał newslettera opiera się tylko na aktywności opiekuna.');
  }
  if (steps.length === 0) steps.push('Biuro działa w normie - brak pilnych decyzji i zaległości.');

  const forms = mpForms((await getSiteIdentity()).mp_gender);
  return {
    rola: roleLabel(ctx.userRole, forms),
    dzis: today,
    puls_biura: { ...officeScore(areas), obszary: areas },
    interpelacje_do_decyzji: { liczba: toDecide, interpelacje: decideRes.data ?? [] },
    interpelacje_po_terminie: { liczba: overdueInterpellations, interpelacje: overdueRes.data ?? [] },
    sprawy_przeterminowane: { liczba: overdueCases, sprawy: (await withLabels(casesRes.data ?? [], CASE_LABELS)).map(markCase) },
    najblizsze_wydarzenia: { do: until, wydarzenia: (await withLabels(events, EVENT_LABELS)).map(markEvent) },
    sugerowane_kroki: steps,
    ...(Object.keys(pulse.notes).length > 0 ? { uwagi: pulse.notes } : {}),
  };
}

async function pracownikBriefing(ctx: McpAuthContext, days: number) {
  const now = new Date();
  const nowIso = now.toISOString();
  const until = new Date(now.getTime() + days * DAY_MS).toISOString();
  const today = nowIso.slice(0, 10);
  const supabase = getServiceClient();
  const forms = mpForms((await getSiteIdentity()).mp_gender);

  // Zakres jak me_agenda: moje otwarte sprawy, moje wydarzenia, moje niewyslane interpelacje.
  const [pulse, casesRes, eventsRes, interpellationsRes] = await Promise.all([
    loadAreas(ctx.userId),
    supabase
      .from('cases')
      .select('id, title, status, priority, source, due_date, updated_at')
      .eq('assigned_to', ctx.userId)
      .in('status', OPEN_CASE_STATUSES)
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(50),
    supabase
      .from('events')
      .select('id, title, type, starts_at, ends_at, all_day, location, powiat_id, ics_source_id')
      .or(`assigned_to.eq.${ctx.userId},created_by.eq.${ctx.userId}`)
      .gte('starts_at', nowIso)
      .lte('starts_at', until)
      .order('starts_at', { ascending: true })
      .limit(50),
    supabase
      .from('interpellations')
      .select('id, subject, recipient, status, revision, review_notes, submitted_at, deadline_at')
      .eq('created_by', ctx.userId)
      .not('status', 'in', '(wyslana,odrzucona)')
      .order('submitted_at', { ascending: false })
      .limit(20),
  ]);
  if (casesRes.error) throw new Error(casesRes.error.message);
  if (eventsRes.error) throw new Error(eventsRes.error.message);
  if (interpellationsRes.error) throw new Error(interpellationsRes.error.message);

  const areas = worstFirst(pulse.areas);
  const needsAction = (module: string) => areas.some((a) => a.obszar === module && a.sygnal !== 'ok');
  const [upcomingCount, teren, overdueAccepted] = await Promise.all([
    needsAction('kalendarz') ? upcomingEventsCount(ctx) : Promise.resolve(null),
    needsAction('teren') ? powiatyWithoutPresence(ctx) : Promise.resolve(null),
    needsAction('interpelacje') ? overdueAcceptedCount(ctx) : Promise.resolve(null),
  ]);

  const cases = (casesRes.data ?? []) as CaseRow[];
  const overdueCases = cases.filter((c) => c.due_date !== null && c.due_date < today);
  const interpellations = (interpellationsRes.data ?? []) as InterpellationRow[];
  const budgetCreate = budgetTools.find((t) => t.name === 'budget_create');
  const canCreateExpense = budgetCreate !== undefined && (!budgetCreate.roles || budgetCreate.roles.includes(ctx.userRole));

  // Kolejnosc: najpierw konkretne zaleglosci, potem obszary od najgorszego sygnalu.
  const actions: string[] = [];
  for (const item of interpellations.filter((i) => i.status === 'uwagi')) {
    const notes = item.review_notes
      ? ` Uwagi ${forms.genitive}: ${item.review_notes.length > 200 ? `${item.review_notes.slice(0, 199)}…` : item.review_notes}`
      : '';
    actions.push(
      `Popraw interpelację „${item.subject}” (id=${item.id}) i wgraj nową wersję przez interpellations_resubmit.${notes}`,
    );
  }
  if (overdueCases.length > 0) {
    actions.push(
      `Masz ${overdueCases.length} spraw po terminie - zaktualizuj status (cases_update_status), dopisz notatkę (cases_add_note) albo zmień termin (cases_update).`,
    );
  }
  for (const area of areas.filter((a) => a.sygnal !== 'ok')) {
    const why = area.powody.length > 0 ? ` Powody: ${area.powody.join('; ')}.` : '';
    const prefix = `${area.etykieta} (${area.sygnal_opis.toLowerCase()}):`;
    switch (area.obszar) {
      case 'kalendarz':
        actions.push(
          upcomingCount === 0
            ? `${prefix} brak wydarzeń na najbliższe 14 dni - zaplanuj spotkania, dyżury lub wyjazdy przez events_create.${why}`
            : `${prefix} dodawaj wydarzenia na bieżąco przez events_create.${why}`,
        );
        break;
      case 'teren':
        actions.push(
          teren && teren.powiaty.length > 0
            ? `${prefix} powiaty bez spotkania ani wyjazdu od ${teren.dni} dni i bez zaplanowanej wizyty: ${teren.powiaty
                .map((p) => `${p.nazwa} (powiat_id=${p.id})`)
                .join(', ')} - zaplanuj spotkanie lub wyjazd przez events_create (type=spotkanie|wyjazd, powiat_id).${why}`
            : `${prefix} zaplanuj kolejne spotkania i wyjazdy w powiatach przez events_create (type=spotkanie|wyjazd, powiat_id).${why}`,
        );
        break;
      case 'interpelacje':
        actions.push(
          overdueAccepted && overdueAccepted > 0
            ? `${prefix} ${overdueAccepted} zaakceptowanych interpelacji po terminie wysyłki - wyślij je i potwierdź przez interpellations_mark_sent (lista: interpellations_list z overdue_only=true).${why}`
            : `${prefix} przygotuj kolejne interpelacje i wgraj je przez interpellations_submit.${why}`,
        );
        break;
      case 'budzet':
        actions.push(
          canCreateExpense
            ? `${prefix} uzupełnij rejestr wydatków przez budget_create.${why}`
            : `${prefix} uzupełnij rejestr wydatków w aplikacji (Budżet biura) - przez MCP możesz je przeglądać (budget_list), dodawanie przez MCP ma tylko Poseł.${why}`,
        );
        break;
      case 'newsletter':
        actions.push(
          `${prefix} przygotuj i wyślij newsletter w aplikacji: Kontakty → Kampanie (${KAMPANIE_PATH}); MCP nie ma narzędzia do wysyłki.${why}`,
        );
        break;
      default:
        actions.push(`${prefix} przejrzyj powody i zaplanuj działania.${why}`);
    }
  }
  const ownDays = areas
    .flatMap((a) => a.opiekunowie)
    .find((o) => o.id === ctx.userId)?.dni_aktywnosci_14d;
  if (ownDays !== undefined && ownDays <= LOW_ACTIVITY_DAYS) {
    actions.push(
      `Twoja aktywność: ${ownDays} dni z logowaniem lub MCP w ostatnich 14 dniach - zaglądaj do systemu codziennie, bo aktywność opiekuna wpływa na sygnał Twoich obszarów.`,
    );
  }
  if (areas.length === 0) {
    actions.push(`Nie jesteś opiekunem żadnego obszaru - zajmij się swoimi sprawami i terminami albo zapytaj ${forms.accusative} o zadania.`);
  }
  if (actions.length === 0) {
    actions.push('Twoje obszary są w normie i nie masz zaległości - możesz zaplanować kolejne działania (patrz mozesz_tez).');
  }

  const others = [
    'Obszary to Twoje odpowiedzialności, nie ograniczenia - możesz pracować w każdym module, na który pozwalają narzędzia.',
    'Sprawy wyborców: cases_list, cases_get, cases_create, cases_update_status, cases_add_note, cases_update.',
    'Kontakty: contacts_search, contacts_list, contacts_create, contacts_update.',
    'Kalendarz: events_list_upcoming, events_create, events_update.',
    'Interpelacje: interpellations_submit (nowa), interpellations_resubmit (po uwagach), interpellations_list, interpellations_get.',
    `Budżet biura: budget_list, budget_get${canCreateExpense ? ', budget_create' : ''}.`,
    'Własny trend aktywności: person_status.',
  ];

  return {
    rola: roleLabel(ctx.userRole, forms),
    dzis: today,
    moje_obszary: areas,
    sugerowane_dzialania: actions,
    moje_sprawy: { liczba: cases.length, po_terminie: overdueCases.length, sprawy: cases.map(markCase) },
    moje_terminy: { do: until, wydarzenia: (await withLabels(eventsRes.data ?? [], EVENT_LABELS)).map(markEvent) },
    moje_interpelacje: interpellations,
    mozesz_tez: others,
    ...(Object.keys(pulse.notes).length > 0 ? { uwagi: pulse.notes } : {}),
  };
}

export const briefingTools: ToolDefinition[] = [
  {
    name: 'me_briefing',
    title: 'Przegląd na start',
    readOnly: true,
    description:
      'Przegląd na start rozmowy - wywołaj jako PIERWSZE narzędzie w każdej nowej rozmowie. Wynik zależy od roli. ' +
      'Poseł/Administrator: Puls Biura (wynik 0-100, stan i sygnały obszarów z powodami i opiekunami), interpelacje do decyzji, ' +
      'zaakceptowane interpelacje po terminie wysyłki, przeterminowane sprawy, najbliższe wydarzenia i sugerowane kroki. ' +
      'Pracownik: jego obszary z sygnałami, sugerowane działania (wg obszarów i zaległości), jego sprawy, terminy i interpelacje ' +
      'oraz lista innych rzeczy, które może zrobić - nie jest ograniczony do swoich obszarów.',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'integer', minimum: 1, maximum: 14, default: 7, description: 'Horyzont kalendarza w dniach' },
      },
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const days = parseDays(args);
      return jsonResult(isPoselRole(ctx.userRole) ? await poselBriefing(ctx, days) : await pracownikBriefing(ctx, days));
    },
  },

  {
    name: 'person_status',
    title: 'Status osoby',
    readOnly: true,
    description:
      'Status jednej osoby: obszary, których jest opiekunem, ich sygnały z powodami oraz trend aktywności ' +
      '(ten tydzień i miesiąc vs poprzedni do tego samego momentu, 8 tygodni). Wywołaj, gdy obszar ma osłabienie lub duży spadek ' +
      'działań albo przed rozmową z członkiem zespołu. Poseł/Administrator: dowolna osoba (domyślnie on sam). Pracownik: tylko własny status.',
    inputSchema: {
      type: 'object',
      properties: {
        user_id: { type: 'string', description: 'ID osoby (users_list). Domyślnie ja.' },
      },
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const userId = (optionalUuid(args, 'user_id') ?? ctx.userId).toLowerCase();
      if (!isPoselRole(ctx.userRole) && userId !== ctx.userId.toLowerCase()) {
        throw new ToolValidationError('Pracownik może sprawdzić tylko własny status.');
      }
      const supabase = getServiceClient();
      const profileRes = await supabase
        .from('profiles')
        .select('id, full_name, role, is_active')
        .eq('id', userId)
        .maybeSingle();
      if (profileRes.error) throw new Error(profileRes.error.message);
      if (!profileRes.data) throw new ToolValidationError(`Nie znaleziono użytkownika o id=${userId}.`);
      const profile = profileRes.data as { id: string; full_name: string | null; role: string; is_active: boolean };

      const [pulse, trendRes, identity] = await Promise.all([
        loadAreas(profile.id),
        supabase.rpc('service_person_pulse', { p_user_id: profile.id }),
        getSiteIdentity(),
      ]);
      if (trendRes.error) throw new Error(trendRes.error.message);

      const trend = ((trendRes.data ?? []) as PersonPulseRow[]).map((row) => ({
        miara: METRIC_LABELS[row.metric] ?? row.metric,
        ten_tydzien: row.this_week,
        poprzedni_tydzien: row.prev_week,
        zmiana_tydzien: change(row.this_week, row.prev_week),
        ten_miesiac: row.this_month,
        poprzedni_miesiac: row.prev_month,
        zmiana_miesiac: change(row.this_month, row.prev_month),
        '8_tygodni': row.weekly,
      }));

      return jsonResult({
        osoba: {
          id: profile.id,
          imie_nazwisko: profile.full_name,
          rola: roleLabel(profile.role, mpForms(identity.mp_gender)),
          aktywna: profile.is_active,
        },
        obszary: worstFirst(pulse.areas),
        okresy: PERIODS_NOTE,
        trend,
        ...(Object.keys(pulse.notes).length > 0 ? { uwagi: pulse.notes } : {}),
      });
    },
  },
];
