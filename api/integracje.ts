// /api/integracje - integracje biura w jednej funkcji (limit funkcji na planie Vercel Hobby).
//
// Sesja Supabase (aal2, aktywne konto) w nagłówku Authorization, operacja w ?op=:
//   POST ics_sync                 { sourceId } → { imported, total } - ręczna synchronizacja ICS (Poseł/administrator)
//   POST interpellation_submit    { recipient, subject, html, case_id? } → { interpellation } - ręczne dodanie (Pracownik)
//   POST interpellation_resubmit  { id, html, recipient?, subject? } → { interpellation } - poprawka po uwagach (Pracownik)
//
// Interpelacje: ta sama walidacja, sanityzacja HTML i audyt co narzędzia MCP (api/_lib/tools/interpellations.ts),
// bez zależności od AI - działa także przy INSTANCE_AI=off.
//
// Błędy: { error: kod, message }.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAnonClient } from './_lib/supabase.js';
import { buildAuthContext, isPoselRole, loadAuthProfile, parseBearer, type AuthProfile, type McpAuthContext } from './_lib/auth.js';
import { syncSource } from './_lib/ics-sync.js';
import { isAal2Session } from './_lib/jwt.js';
import { resubmitInterpellation, submitInterpellation } from './_lib/tools/interpellations.js';
import { ToolValidationError } from './_lib/tools/types.js';
import { logAudit } from './_lib/audit.js';
import { errorSummary } from './_lib/log-safe.js';

const SMALL_BODY = 4 * 1024;
// HTML interpelacji: do 500 000 znaków (MAX_HTML_LENGTH w tools/interpellations.ts) w UTF-8 + reszta pól.
const INTERPELLATION_BODY = 2 * 1024 * 1024;

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
  profile: AuthProfile;
}

/** Sesja Supabase z nagłówka Authorization: ważny token, zweryfikowany czynnik + aal2, aktywny profil. */
async function authenticateSession(req: VercelRequest): Promise<SessionUser> {
  const token = parseBearer(req.headers.authorization);
  if (!token) throw new ApiError(401, 'brak_sesji', 'Brak sesji');
  const { data, error } = await getAnonClient().auth.getUser(token);
  if (error || !data.user) throw new ApiError(401, 'brak_sesji', 'Nieprawidłowa lub wygasła sesja');
  if (!isAal2Session(token, data.user)) throw new ApiError(403, 'wymagane_2fa', 'Wymagana weryfikacja dwuetapowa (2FA)');
  const profile = await loadAuthProfile(data.user.id);
  if (!profile?.is_active) throw new ApiError(403, 'brak_uprawnien', 'Konto jest nieaktywne');
  return { id: data.user.id, role: profile.role, profile };
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

/**
 * Kontekst interpelacji dla Pracownika (role jak w MCP: interpellations_submit/resubmit) i wpis
 * audytu przed operacją - fail-closed jak mcp.tool_call: bez wpisu operacja się nie wykona.
 */
async function interpellationContext(user: SessionUser, op: string, entityId: unknown): Promise<McpAuthContext> {
  if (user.role !== 'pracownik') {
    throw new ApiError(403, 'brak_uprawnien', 'Interpelacje wgrywa Pracownik biura');
  }
  const ctx = buildAuthContext(user.id, user.role, user.profile, {
    channel: 'portal',
    tokenId: null,
    userFullName: user.profile.full_name ?? '',
    scopes: [],
  });
  const logged = await logAudit(ctx, 'portal.interpellation_request', {
    entityType: 'interpellation',
    metadata: { op, ...(typeof entityId === 'string' ? { id: entityId.slice(0, 64) } : {}) },
  });
  if (!logged) throw new ApiError(503, 'blad_serwisu', 'Nie udało się zapisać audytu - spróbuj ponownie');
  return ctx;
}

async function handleInterpellationSubmit(user: SessionUser, body: unknown) {
  const { recipient, subject, html, case_id } = body as Record<string, unknown>;
  const ctx = await interpellationContext(user, 'interpellation_submit', null);
  return { interpellation: await submitInterpellation({ recipient, subject, html, case_id }, ctx, 'portal.interpellation_submit') };
}

async function handleInterpellationResubmit(user: SessionUser, body: unknown) {
  const { id, html, recipient, subject } = body as Record<string, unknown>;
  const ctx = await interpellationContext(user, 'interpellation_resubmit', id);
  const data = await resubmitInterpellation({ id, html, recipient, subject }, ctx, 'portal.interpellation_resubmit');
  if (!data) throw new ApiError(409, 'zly_status', 'Interpelacja nie istnieje, nie ma statusu „Uwagi” albo jest poza Twoim zakresem danych.');
  return { interpellation: data };
}

const OPERATIONS: Record<string, { maxBytes: number; run: (user: SessionUser, body: unknown) => Promise<unknown> }> = {
  ics_sync: { maxBytes: SMALL_BODY, run: handleIcsSync },
  interpellation_submit: { maxBytes: INTERPELLATION_BODY, run: handleInterpellationSubmit },
  interpellation_resubmit: { maxBytes: INTERPELLATION_BODY, run: handleInterpellationResubmit },
};

async function dispatch(req: VercelRequest, op: string): Promise<unknown> {
  const entry = Object.hasOwn(OPERATIONS, op) ? OPERATIONS[op] : undefined;
  if (!entry) throw new ApiError(404, 'nieznana_operacja', 'Nieznana operacja');
  if (req.method !== 'POST') throw new ApiError(405, 'metoda', 'Method not allowed');

  const user = await authenticateSession(req);
  try {
    return await entry.run(user, readJsonBody(req, entry.maxBytes));
  } catch (err) {
    // Komunikaty walidacji narzędzi są przeznaczone dla użytkownika (bez szczegółów bazy).
    if (err instanceof ToolValidationError) throw new ApiError(400, 'bledne_dane', err.message);
    throw err;
  }
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
    console.error('[integracje] error', op, errorSummary(err));
    return res.status(500).json({ error: 'blad_serwisu', message: 'Błąd serwera integracji' });
  }
}
