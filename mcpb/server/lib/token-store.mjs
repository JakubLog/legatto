// Tokeny OAuth w pliku w katalogu danych użytkownika (katalog 0700, plik 0600).
// Zawartość pliku nigdy nie trafia do logów.

import { createHash, randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const POSIX = process.platform !== 'win32';

/**
 * Katalog danych rozszerzenia: LEGATTO_DATA_DIR albo katalog danych aplikacji systemu.
 * @param {Record<string, string | undefined>} env
 */
export function defaultDataDir(env = process.env, platform = process.platform, home = homedir()) {
  const override = env.LEGATTO_DATA_DIR?.trim();
  if (override) return override;
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'Legatto MCP');
  if (platform === 'win32') return join(env.APPDATA?.trim() || join(home, 'AppData', 'Roaming'), 'Legatto MCP');
  return join(env.XDG_CONFIG_HOME?.trim() || join(home, '.config'), 'legatto-mcp');
}

/**
 * @typedef {object} TokenRecord
 * @property {1} v
 * @property {string} origin
 * @property {string} client_id
 * @property {string} access_token
 * @property {number | null} expires_at   ms od epoki; null = serwer nie podał czasu życia
 * @property {string | null} refresh_token
 * @property {string | null} scope
 */

function isRecord(value, origin, clientId) {
  return (
    typeof value === 'object' &&
    value !== null &&
    value.v === 1 &&
    value.origin === origin &&
    value.client_id === clientId &&
    typeof value.access_token === 'string' &&
    value.access_token.length > 0 &&
    (value.expires_at === null || Number.isFinite(value.expires_at)) &&
    (value.refresh_token === null || typeof value.refresh_token === 'string') &&
    (value.scope === null || typeof value.scope === 'string')
  );
}

export class TokenStore {
  /**
   * @param {string} dir
   * @param {string} origin
   * @param {string} clientId
   * @param {(message: string) => void} [log]
   */
  constructor(dir, origin, clientId, log = () => {}) {
    this.dir = dir;
    this.origin = origin;
    this.clientId = clientId;
    this.log = log;
    const key = createHash('sha256').update(`${origin}\n${clientId}`).digest('hex').slice(0, 16);
    this.path = join(dir, `oauth-${key}.json`);
  }

  /** @returns {Promise<TokenRecord | null>} */
  async load() {
    let raw;
    try {
      if (POSIX) {
        const info = await stat(this.path);
        if ((info.mode & 0o077) !== 0) {
          await chmod(this.path, 0o600);
          this.log('Poprawiono uprawnienia pliku z tokenem (0600).');
        }
      }
      raw = await readFile(this.path, 'utf8');
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return null;
      throw err;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    if (!isRecord(parsed, this.origin, this.clientId)) {
      this.log('Plik z tokenem jest uszkodzony – wymagane ponowne logowanie.');
      await this.clear();
      return null;
    }
    return parsed;
  }

  /** Zapis atomowy: plik tymczasowy 0600 + rename. @param {TokenRecord} record */
  async save(record) {
    // Nowo tworzony katalog dostaje 0700 (umask może tylko zawęzić); istniejącego nie zmieniamy.
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const tmp = `${this.path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await writeFile(tmp, `${JSON.stringify(record)}\n`, { mode: 0o600, flag: 'wx' });
      await rename(tmp, this.path);
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
  }

  async clear() {
    await rm(this.path, { force: true });
  }
}
