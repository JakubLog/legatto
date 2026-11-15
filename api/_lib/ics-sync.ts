import { getServiceClient } from './supabase.js';
import { safeFetch, SsrfError } from './safe-fetch.js';

// ===== ICS PARSER =====

export interface ParsedEvent {
  uid: string;
  title: string;
  description?: string;
  starts_at: string;
  ends_at?: string;
  all_day: boolean;
  location?: string;
}

function unfold(text: string): string[] {
  return text
    .replace(/\r\n[ \t]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n');
}

function unescapeIcs(s: string): string {
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\N/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

function tzLocalToUtc(dateStr: string, tzid: string): string {
  const y  = +dateStr.slice(0, 4);
  const mo = +dateStr.slice(4, 6) - 1;
  const d  = +dateStr.slice(6, 8);
  const h  = +dateStr.slice(9, 11);
  const mi = +dateStr.slice(11, 13);
  const s  = +(dateStr.slice(13, 15) || '0');
  const utcCandidate = Date.UTC(y, mo, d, h, mi, s);
  const localStr = new Date(utcCandidate).toLocaleString('sv-SE', { timeZone: tzid });
  const localAsUtcMs = new Date(localStr.replace(' ', 'T') + 'Z').getTime();
  return new Date(utcCandidate + (utcCandidate - localAsUtcMs)).toISOString();
}

// Akceptowane formaty: data (YYYYMMDD) i data-czas (YYYYMMDDTHHMM[SS][Z]).
// Niepoprawna wartosc => null (zdarzenie jest pomijane zamiast wywracac caly import).
function parseIcsDateTime(value: string, params: string): { iso: string; allDay: boolean } | null {
  const isDate = /(^|;)VALUE=DATE(;|$)/.test(params) || /^\d{8}$/.test(value);
  if (isDate ? !/^\d{8}/.test(value) : !/^\d{8}T\d{4}(\d{2})?Z?$/.test(value)) return null;

  const y = value.slice(0, 4), mo = value.slice(4, 6), d = value.slice(6, 8);
  const h = isDate ? '00' : value.slice(9, 11);
  const mi = isDate ? '00' : value.slice(11, 13);
  const s = isDate ? '00' : value.slice(13, 15).replace('Z', '') || '00';
  const naive = `${y}-${mo}-${d}T${h}:${mi}:${s}.000Z`;
  // Odrzuc daty nieistniejace (np. 20260231, 2400) - Date je normalizuje, wiec porownaj po powrocie.
  const ms = Date.parse(naive);
  if (Number.isNaN(ms) || new Date(ms).toISOString() !== naive) return null;
  if (isDate) return { iso: naive, allDay: true };

  const tzidMatch = /TZID=([^;:]+)/.exec(params);
  if (!value.endsWith('Z') && tzidMatch) {
    try { return { iso: tzLocalToUtc(value, tzidMatch[1]), allDay: false }; } catch { /* fallback */ }
  }
  return { iso: naive, allDay: false };
}

export function parseIcs(text: string): ParsedEvent[] {
  const lines = unfold(text);
  const events: ParsedEvent[] = [];
  let cur: Record<string, string> | null = null;
  let allDay = false;
  let invalid = false;

  for (const raw of lines) {
    if (!raw.trim()) continue;
    const colon = raw.indexOf(':');
    if (colon === -1) continue;
    const keyPart = raw.slice(0, colon).toUpperCase();
    const val = raw.slice(colon + 1).trim();
    const [key, ...ps] = keyPart.split(';');
    const params = ps.join(';');

    if (key === 'BEGIN' && val === 'VEVENT') { cur = {}; allDay = false; invalid = false; }
    else if (key === 'END' && val === 'VEVENT' && cur) {
      if (!invalid && cur['UID'] && cur['SUMMARY'] && cur['DTSTART'] && cur['STATUS'] !== 'CANCELLED') {
        const ev: ParsedEvent = { uid: cur['UID'], title: unescapeIcs(cur['SUMMARY']), all_day: allDay, starts_at: cur['DTSTART'] };
        if (cur['DTEND']) ev.ends_at = cur['DTEND'];
        if (cur['DESCRIPTION']) ev.description = unescapeIcs(cur['DESCRIPTION']) || undefined;
        if (cur['LOCATION']) ev.location = unescapeIcs(cur['LOCATION']) || undefined;
        events.push(ev);
      }
      cur = null;
    } else if (cur) {
      if (key === 'DTSTART' || key === 'DTEND') {
        const parsed = parseIcsDateTime(val, params);
        if (!parsed) { invalid = true; continue; }
        cur[key] = parsed.iso;
        if (key === 'DTSTART') allDay = parsed.allDay;
      } else { cur[key] = val; }
    }
  }
  return events;
}

// ===== SYNC LOGIC =====

export interface SyncResult {
  sourceId: string;
  name: string;
  imported: number;
  inRange: number;
  error?: string;
}

// Gorny limit wydarzen przekazywanych do jednego RPC (ochrona bazy przed ogromnymi feedami).
const MAX_EVENTS = 2000;
const MAX_ICS_BYTES = 5 * 1024 * 1024;
// Na zewnatrz (odpowiedz API, PoliAI) tylko stale komunikaty: kod HTTP, blad sieci czy adres
// z DNS pozwalalyby sondowac cudze hosty z infrastruktury instancji. Szczegoly w logu.
const FETCH_FAILED = 'Nie udało się pobrać kalendarza.';
const URL_REJECTED = 'Niedozwolony adres kalendarza (wymagany publiczny adres https).';
const SAVE_FAILED = 'Nie udało się zapisać wydarzeń z kalendarza.';

export async function syncSource(sourceId: string, userId: string): Promise<SyncResult> {
  const supabase = getServiceClient();

  const { data: source, error: srcErr } = await supabase
    .from('ics_sources')
    .select('id, name, url, is_active')
    .eq('id', sourceId)
    .single();

  if (srcErr || !source) {
    return { sourceId, name: '?', imported: 0, inRange: 0, error: 'Source not found' };
  }
  // Zrodlo wylaczone przez Posla nie moze byc pobierane (ani cronem, ani recznie).
  if (source.is_active !== true) {
    return { sourceId, name: source.name as string, imported: 0, inRange: 0, error: 'Source inactive' };
  }

  let icsText: string;
  try {
    const resp = await safeFetch(source.url as string, {
      headers: { 'User-Agent': 'Office-Calendar-Sync/1.0' },
      timeoutMs: 20_000,
      maxBytes: MAX_ICS_BYTES,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    icsText = resp.body.toString('utf8');
  } catch (e) {
    console.error('[ics-sync] fetch error', sourceId, e instanceof Error ? e.message : e);
    const error = e instanceof SsrfError ? URL_REJECTED : FETCH_FAILED;
    return { sourceId, name: source.name as string, imported: 0, inRange: 0, error };
  }

  const allEvents = parseIcs(icsText);
  const windowStart = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  // Najblizsze wydarzenia maja pierwszenstwo, gdy feed przekracza limit.
  const events = allEvents
    .filter((e) => e.starts_at >= windowStart)
    .sort((a, b) => (a.starts_at < b.starts_at ? -1 : a.starts_at > b.starts_at ? 1 : 0))
    .slice(0, MAX_EVENTS);

  if (events.length === 0) {
    await supabase
      .from('ics_sources')
      .update({ last_synced_at: new Date().toISOString(), synced_event_count: 0 })
      .eq('id', sourceId);
    return { sourceId, name: source.name as string, imported: 0, inRange: 0 };
  }

  const { data: count, error: rpcErr } = await supabase.rpc('sync_ics_events', {
    p_source_id: sourceId,
    p_user_id: userId,
    p_events: events,
  });

  if (rpcErr) {
    console.error('[ics-sync] sync_ics_events error', sourceId, rpcErr.code, rpcErr.message);
    return { sourceId, name: source.name as string, imported: 0, inRange: events.length, error: SAVE_FAILED };
  }

  return { sourceId, name: source.name as string, imported: count as number, inRange: events.length };
}
