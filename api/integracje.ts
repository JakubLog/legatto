// /api/integracje - integracje biura w jednej funkcji (limit funkcji na planie Vercel Hobby).
//
// Sesja Supabase (aal2, aktywne konto) w nagłówku Authorization, operacja w ?op=:
//   POST ics_sync             { sourceId } → { imported, total } - ręczna synchronizacja ICS (Poseł/administrator)
//
// Błędy: { error: kod, message }.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { isPoselRole, loadAuthProfile, parseBearer } from './_lib/auth.js';
import { syncSource } from './_lib/ics-sync.js';
import { isAal2Session } from './_lib/jwt.js';

const SMALL_BODY = 4 * 1024;

class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

interface SessionUser {
  id: string;
  role: string;
}

/** Sesja Supabase z nagłówka Authorization: ważny token, zweryfikowany czynnik + aal2, aktywny profil. */
async function authenticateSession(req: VercelRequest): Promise<SessionUser> {
  const token = parseBearer(req.headers.authorization);
  if (!token) throw new ApiError(401, 'brak_sesji', 'Brak sesji');
  const supabase = createClient(
    process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '',
    process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? '',
    { auth: { persistSession: false } },
  );
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw new ApiError(401, 'brak_sesji', 'Nieprawidłowa lub wygasła sesja');
  if (!isAal2Session(token, data.user)) throw new ApiError(403, 'wymagane_2fa', 'Wymagana weryfikacja dwuetapowa (2FA)');
  const profile = await loadAuthProfile(data.user.id);
  if (!profile?.is_active) throw new ApiError(403, 'brak_uprawnien', 'Konto jest nieaktywne');
  return { id: data.user.id, role: profile.role };
}

/** Ciało JSON żądania z limitem rozmiaru; brak ciała = {}. */
function readJsonBody(req: VercelRequest, maxBytes: number): unknown {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ApiError(413, 'bledne_dane', 'Za duże dane żądania');
  }
  const body: unknown = req.body;
  if (body === undefined || body === null || body === '') return {};
  let parsed: unknown = body;
  if (typeof body === 'string') {
    if (Buffer.byteLength(body, 'utf8') > maxBytes) throw new ApiError(413, 'bledne_dane', 'Za duże dane żądania');
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new ApiError(400, 'bledne_dane', 'Nieprawidłowy JSON');
    }
  } else if (Buffer.isBuffer(body)) {
    throw new ApiError(400, 'bledne_dane', 'Oczekiwano danych JSON');
  } else if (Buffer.byteLength(JSON.stringify(body), 'utf8') > maxBytes) {
    throw new ApiError(413, 'bledne_dane', 'Za duże dane żądania');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ApiError(400, 'bledne_dane', 'Oczekiwano obiektu JSON');
  }
  return parsed;
}

async function handleIcsSync(user: SessionUser, body: unknown) {
  if (!isPoselRole(user.role)) throw new ApiError(403, 'brak_uprawnien', 'Synchronizację uruchamia Poseł lub administrator');
  const sourceId = body && typeof body === 'object' && 'sourceId' in body && typeof body.sourceId === 'string' ? body.sourceId : null;
  if (!sourceId) throw new ApiError(400, 'bledne_dane', 'Brak identyfikatora źródła');
  const result = await syncSource(sourceId, user.id);
  if (result.error) {
    if (result.error === 'Source not found') throw new ApiError(404, 'nie_znaleziono', 'Nie znaleziono źródła kalendarza');
    if (result.error === 'Source inactive') throw new ApiError(409, 'zly_status', 'Źródło kalendarza jest wyłączone');
    // syncSource zwraca tylko stałe komunikaty (szczegóły błędu sieci/bazy w logu serwera).
    throw new ApiError(502, 'blad_serwisu', result.error);
  }
  return { imported: result.imported, total: result.inRange };
}

async function dispatch(req: VercelRequest, op: string): Promise<unknown> {
  if (op !== 'ics_sync') throw new ApiError(404, 'nieznana_operacja', 'Nieznana operacja');
  if (req.method !== 'POST') throw new ApiError(405, 'metoda', 'Method not allowed');

  const user = await authenticateSession(req);
  return handleIcsSync(user, readJsonBody(req, SMALL_BODY));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  // req.url zamiast req.query - adapter w vite.config.ts (pnpm dev) nie ustawia query.
  const op = new URL(req.url ?? '', 'http://localhost').searchParams.get('op') ?? '';
  try {
    return res.status(200).json(await dispatch(req, op));
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 405) res.setHeader('Allow', 'POST');
      return res.status(err.status).json({ error: err.code, message: err.message });
    }
    console.error('[integracje] error', op, err instanceof Error ? err.message : err);
    return res.status(500).json({ error: 'blad_serwisu', message: 'Błąd serwera integracji' });
  }
}
