// Błędy widoczne dla użytkownika Claude Desktop (komunikaty po polsku).
// Treść komunikatu nigdy nie zawiera tokenów ani sekretów.

/** Kody JSON-RPC zwracane klientowi (zakres -32000..-32099 jak w api/_lib/jsonrpc.ts). */
export const RPC_CODE = Object.freeze({
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  SERVER: -32000,
  UNAUTHORIZED: -32001,
});

/**
 * Błąd z komunikatem gotowym do pokazania użytkownikowi.
 * kind: config | offline | timeout | tls | auth | login | server | protocol
 */
export class LegattoError extends Error {
  /**
   * @param {string} message
   * @param {{ kind?: string, code?: number, cause?: unknown }} [options]
   */
  constructor(message, { kind = 'server', code, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'LegattoError';
    this.kind = kind;
    this.code = code ?? (kind === 'auth' || kind === 'login' ? RPC_CODE.UNAUTHORIZED : RPC_CODE.SERVER);
  }
}

const OFFLINE_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'EAI_NONAME',
  'EAI_NODATA',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'EHOSTDOWN',
  'ENETUNREACH',
  'ENETDOWN',
  'EPIPE',
  'EADDRNOTAVAIL',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_CLOSED',
]);

const TIMEOUT_CODES = new Set(['UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']);

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'CERT_UNTRUSTED',
  'CERT_REVOKED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

/** Pierwszy kod błędu systemowego w łańcuchu `cause` (fetch opakowuje błąd sieci w TypeError). */
function errorCode(err) {
  let current = err;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (typeof current.code === 'string') return current.code;
    current = current.cause;
  }
  return '';
}

/** Komunikat dla braku łączności z serwerem biura (host znany tylko w tailnecie). */
export function offlineMessage(host) {
  return (
    `Brak połączenia z serwerem biura (${host}). ` +
    'Włącz VPN biura (Tailscale/Headscale) i spróbuj ponownie. ' +
    'Jeśli VPN jest włączony, serwer może być chwilowo niedostępny.'
  );
}

/**
 * Zamienia błąd sieci (fetch) na LegattoError z polskim komunikatem.
 * @param {unknown} err
 * @param {string} host host serwera biura (bez ścieżki)
 */
export function describeNetworkError(err, host) {
  if (err instanceof LegattoError) return err;
  const code = errorCode(err);
  if (OFFLINE_CODES.has(code)) {
    return new LegattoError(offlineMessage(host), { kind: 'offline', cause: err });
  }
  if (TIMEOUT_CODES.has(code) || (err && /** @type {Error} */ (err).name === 'TimeoutError')) {
    return new LegattoError(
      `Serwer biura (${host}) nie odpowiedział w wymaganym czasie. Sprawdź połączenie VPN biura i spróbuj ponownie.`,
      { kind: 'timeout', cause: err },
    );
  }
  if (TLS_CODES.has(code) || code.startsWith('ERR_TLS_') || code.startsWith('ERR_SSL_') || code.startsWith('CERT_')) {
    return new LegattoError(
      `Nie można zweryfikować certyfikatu TLS serwera biura (${host}, ${code}). ` +
        'Sprawdź adres biura w ustawieniach rozszerzenia; jeśli jest poprawny, zgłoś problem administratorowi biura.',
      { kind: 'tls', cause: err },
    );
  }
  const detail = code || (err instanceof Error ? err.message : String(err));
  return new LegattoError(
    `Nie udało się połączyć z serwerem biura (${host}): ${detail}. Włącz VPN biura (Tailscale/Headscale) i spróbuj ponownie.`,
    { kind: 'offline', cause: err },
  );
}
