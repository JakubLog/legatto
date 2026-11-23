// Dostawcy tokenu dostępowego dla proxy MCP:
//   - StaticTokenAuth: token MCP (epm_…) wygenerowany w portalu biura (Integracje → Tokeny MCP);
//   - OAuthSession: OAuth 2.1 z logowaniem w przeglądarce, tokeny w pliku 0600, odświeżanie
//     (refresh token, a bez niego ponowne logowanie) po wygaśnięciu albo odpowiedzi 401.

import { spawn } from 'node:child_process';

import { LegattoError } from './errors.mjs';
import { discoverAuthServer, requestToken, startLoopbackLogin } from './oauth.mjs';

/** Margines przed wygaśnięciem, w którym token traktujemy jako nieważny. */
const EXPIRY_MARGIN_MS = 60_000;
/** Ile żądanie klienta czeka na logowanie w przeglądarce (poniżej limitu 60 s klienta MCP). */
export const DEFAULT_LOGIN_WAIT_MS = 45_000;
/** Całkowity czas na dokończenie logowania (lokalny callback działa w tle). */
export const DEFAULT_LOGIN_TIMEOUT_MS = 10 * 60_000;

/**
 * @typedef {object} AccessTokenProvider
 * @property {() => Promise<string>} getAccessToken
 * @property {(rejectedToken: string) => Promise<string>} onUnauthorized  nowy token po 401 albo błąd
 * @property {() => void} close
 */

/** @implements {AccessTokenProvider} */
export class StaticTokenAuth {
  /** @param {string} token */
  constructor(token) {
    this.token = token;
  }

  async getAccessToken() {
    return this.token;
  }

  async onUnauthorized() {
    throw new LegattoError(
      'Serwer biura odrzucił token MCP (nieprawidłowy, wygasły albo unieważniony). ' +
        'Wygeneruj nowy token w portalu biura (Integracje → Tokeny MCP) i wpisz go w ustawieniach rozszerzenia.',
      { kind: 'auth' },
    );
  }

  close() {}
}

/**
 * Otwiera adres w domyślnej przeglądarce systemu (bez powłoki - adres jest jednym argumentem).
 * @param {string} url
 * @returns {Promise<void>}
 */
export function openInBrowser(url) {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
        : ['xdg-open', [url]];
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore', detached: true, windowsHide: true });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

/** @implements {AccessTokenProvider} */
export class OAuthSession {
  /**
   * @param {object} options
   * @param {import('./config.mjs').LegattoConfig} options.config
   * @param {import('./token-store.mjs').TokenStore} options.store
   * @param {(message: string) => void} options.log
   * @param {(url: string) => Promise<void>} [options.openBrowser]
   * @param {typeof fetch} [options.fetchImpl]
   * @param {number} [options.loginWaitMs]
   * @param {number} [options.loginTimeoutMs]
   * @param {() => number} [options.now]
   */
  constructor({
    config,
    store,
    log,
    openBrowser = openInBrowser,
    fetchImpl = fetch,
    loginWaitMs = DEFAULT_LOGIN_WAIT_MS,
    loginTimeoutMs = DEFAULT_LOGIN_TIMEOUT_MS,
    now = Date.now,
  }) {
    this.config = config;
    this.store = store;
    this.log = log;
    this.openBrowser = openBrowser;
    this.fetchImpl = fetchImpl;
    this.loginWaitMs = loginWaitMs;
    this.loginTimeoutMs = loginTimeoutMs;
    this.now = now;
    /** @type {import('./token-store.mjs').TokenRecord | null | undefined} undefined = jeszcze nie wczytany */
    this.record = undefined;
    /** @type {Promise<import('./oauth.mjs').AuthServerMetadata> | null} */
    this.metadataPromise = null;
    /** @type {Promise<import('./token-store.mjs').TokenRecord> | null} */
    this.refreshing = null;
    /** @type {Promise<import('./token-store.mjs').TokenRecord> | null} */
    this.loginPromise = null;
    /** @type {(() => void) | null} */
    this.cancelLogin = null;
    this.closed = false;
  }

  async getAccessToken() {
    const record = await this.current();
    if (record && !this.expired(record)) return record.access_token;
    return (await this.renew(record)).access_token;
  }

  /** @param {string} rejectedToken */
  async onUnauthorized(rejectedToken) {
    const record = await this.current();
    // Równoległe żądanie mogło już odnowić token.
    if (record && record.access_token !== rejectedToken && !this.expired(record)) return record.access_token;
    this.log('Serwer biura odrzucił token – odnawiam autoryzację.');
    return (await this.renew(record)).access_token;
  }

  close() {
    this.closed = true;
    this.cancelLogin?.();
  }

  /** @returns {Promise<import('./token-store.mjs').TokenRecord | null>} */
  async current() {
    if (this.record === undefined) this.record = await this.store.load();
    return this.record;
  }

  /** @param {import('./token-store.mjs').TokenRecord} record */
  expired(record) {
    return record.expires_at !== null && record.expires_at - EXPIRY_MARGIN_MS <= this.now();
  }

  /**
   * Refresh token (jeśli jest), a gdy go brak albo został odrzucony - logowanie w przeglądarce.
   * Wywoływane tylko dla tokenu wygasłego albo odrzuconego przez serwer (401).
   * @param {import('./token-store.mjs').TokenRecord | null} record
   */
  async renew(record) {
    if (record?.refresh_token) {
      try {
        return await this.refresh(record);
      } catch (err) {
        if (!(err instanceof LegattoError) || err.kind !== 'auth') throw err;
        this.log('Refresh token odrzucony – wymagane ponowne logowanie.');
      }
    }
    // Nieważny token znika z dysku (chyba że równoległe logowanie zdążyło zapisać nowy).
    if (record && this.record === record) await this.forget();
    return this.interactiveLogin();
  }

  async forget() {
    this.record = null;
    await this.store.clear();
  }

  metadata() {
    if (!this.metadataPromise) {
      this.metadataPromise = discoverAuthServer(this.config, this.fetchImpl);
      // Błąd (np. VPN wyłączony) nie jest zapamiętywany - następne żądanie spróbuje ponownie.
      this.metadataPromise.catch(() => {
        this.metadataPromise = null;
      });
    }
    return this.metadataPromise;
  }

  /** @param {import('./token-store.mjs').TokenRecord} record */
  refresh(record) {
    if (!this.refreshing) {
      this.refreshing = (async () => {
        const metadata = await this.metadata();
        if (!metadata.grant_types_supported.includes('refresh_token')) {
          throw new LegattoError('Serwer biura nie obsługuje odświeżania tokenu.', { kind: 'auth' });
        }
        const token = await requestToken(
          metadata,
          {
            grant_type: 'refresh_token',
            refresh_token: /** @type {string} */ (record.refresh_token),
            client_id: this.config.clientId,
            client_secret: this.config.clientSecret,
          },
          { host: this.config.host, fetchImpl: this.fetchImpl },
        );
        // Serwer może nie rotować refresh tokena - wtedy zostaje dotychczasowy.
        const next = this.toRecord(token, token.refresh_token ?? record.refresh_token);
        await this.save(next);
        this.log('Token dostępu odświeżony.');
        return next;
      })().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  /**
   * Logowanie w przeglądarce. Jedno naraz; żądanie klienta czeka co najwyżej loginWaitMs,
   * logowanie trwa dalej w tle, a jego wynik trafia do pliku tokenów.
   */
  async interactiveLogin() {
    if (this.closed) throw new LegattoError('Rozszerzenie jest zamykane.', { kind: 'login' });
    if (!this.loginPromise) {
      const login = this.runLogin().finally(() => {
        if (this.loginPromise === login) this.loginPromise = null;
      });
      login.catch((err) => this.log(`Logowanie nieudane: ${err instanceof Error ? err.message : String(err)}`));
      this.loginPromise = login;
    }
    const login = this.loginPromise;
    let timer;
    const waited = new Promise((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new LegattoError(
              'Zaloguj się do portalu biura w oknie przeglądarki, które otworzyło rozszerzenie Legatto ' +
                '(konto z weryfikacją dwuetapową), zatwierdź dostęp, a potem ponów polecenie w Claude.',
              { kind: 'login' },
            ),
          ),
        this.loginWaitMs,
      );
      timer.unref?.();
    });
    try {
      return await Promise.race([login, waited]);
    } finally {
      clearTimeout(timer);
    }
  }

  async runLogin() {
    const metadata = await this.metadata();
    const login = await startLoopbackLogin({
      metadata,
      clientId: this.config.clientId,
      timeoutMs: this.loginTimeoutMs,
    });
    this.cancelLogin = login.close;
    try {
      this.log(`Wymagane logowanie do portalu biura – otwieram przeglądarkę: ${login.authorizationUrl}`);
      try {
        await this.openBrowser(login.authorizationUrl);
      } catch {
        this.log('Nie udało się otworzyć przeglądarki – otwórz powyższy adres ręcznie.');
      }
      const { code } = await login.result;
      const token = await requestToken(
        metadata,
        {
          grant_type: 'authorization_code',
          code,
          redirect_uri: login.redirectUri,
          code_verifier: login.verifier,
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
        },
        { host: this.config.host, fetchImpl: this.fetchImpl },
      );
      const record = this.toRecord(token, token.refresh_token);
      await this.save(record);
      this.log('Zalogowano do portalu biura.');
      return record;
    } finally {
      this.cancelLogin = null;
      login.close();
    }
  }

  /**
   * @param {import('./oauth.mjs').TokenResponse} token
   * @param {string | null} refreshToken
   * @returns {import('./token-store.mjs').TokenRecord}
   */
  toRecord(token, refreshToken) {
    return {
      v: 1,
      origin: this.config.origin,
      client_id: this.config.clientId,
      access_token: token.access_token,
      expires_at: token.expires_in === null ? null : this.now() + token.expires_in * 1000,
      refresh_token: refreshToken,
      scope: token.scope,
    };
  }

  /** @param {import('./token-store.mjs').TokenRecord} record */
  async save(record) {
    this.record = record;
    try {
      await this.store.save(record);
    } catch (err) {
      // Token działa w tej sesji; po restarcie potrzebne będzie ponowne logowanie.
      this.log(`Nie udało się zapisać tokenu w ${this.store.path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
