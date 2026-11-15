import type { VercelRequest, VercelResponse } from '@vercel/node';

// Posiedzenia Sejmu dla publicznego kalendarza na stronie głównej.
// Pełna odpowiedź api.sejm.gov.pl to ~1 MB (porządek obrad w HTML) - tu zwracamy tylko
// numer, dni i flagę bieżącego posiedzenia (kilka KB), cache'owane na CDN Vercela.

const SEJM_API = 'https://api.sejm.gov.pl/sejm';
const TIMEOUT_MS = 10_000;
const CANONICAL_PATH = '/api/sejm-sittings';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface SejmTerm {
  num: number;
  current: boolean;
}

interface SejmProceeding {
  number: number;
  dates: string[];
  current: boolean;
}

/** Posiedzenie Sejmu; `number === 0` = posiedzenie planowane (bez nadanego numeru). */
interface SejmSitting {
  number: number;
  dates: string[];
  current: boolean;
}

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Sejm API ${res.status} (${url})`);
  return (await res.json()) as T;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Endpoint nie ma parametrow, a klucz cache CDN zawiera query string: losowe ?x=... omijalyby
  // cache i kazde wywolanie kosztowaloby 2 zapytania do Sejm API (~1 MB). Kazdy query string
  // -> 308 na kanoniczny adres (bez zapytan upstream), sama odpowiedz przekierowania tez cache'owana.
  if ((req.url ?? '').includes('?')) {
    res.setHeader('Location', CANONICAL_PATH);
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
    return res.status(308).end();
  }

  try {
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    const terms = await getJson<SejmTerm[]>(`${SEJM_API}/term`, signal);
    const term = Array.isArray(terms) ? terms.find((t) => t.current) : undefined;
    if (!term) throw new Error('Sejm API: brak bieżącej kadencji');
    // Numer kadencji trafia do sciezki URL - tylko mala liczba calkowita.
    if (!Number.isInteger(term.num) || term.num < 1 || term.num > 99) {
      throw new Error(`Sejm API: niepoprawny numer kadencji (${String(term.num)})`);
    }

    const proceedings = await getJson<SejmProceeding[]>(`${SEJM_API}/term${term.num}/proceedings`, signal);
    if (!Array.isArray(proceedings)) throw new Error('Sejm API: niepoprawna lista posiedzeń');
    const sittings: SejmSitting[] = proceedings
      .filter((p) => Array.isArray(p.dates) && Number.isInteger(p.number))
      .map((p) => ({
        number: p.number,
        dates: p.dates.filter((d) => typeof d === 'string' && DATE_RE.test(d)).sort(),
        current: p.current === true,
      }))
      .filter((s) => s.dates.length > 0);

    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=21600, stale-while-revalidate=86400');
    return res.status(200).json({ sittings });
  } catch (err) {
    console.error('[sejm-sittings]', err);
    return res.status(502).json({ error: 'Sejm API unavailable' });
  }
}
