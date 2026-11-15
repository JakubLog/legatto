import { POSEL_ROLES, type McpAuthContext, type McpRole, type ToolChannel } from '../auth.js';

// Narzedzia tylko dla Posla i Administratora. Egzekwowane centralnie w tools/index.ts
// (tools/list ukrywa je przed Pracownikiem, tools/call odrzuca) - odpowiednik is_posel() z RLS.
export const POSEL_ONLY: readonly McpRole[] = POSEL_ROLES;

// Narzedzia administracji kontami i konfiguracja systemu (rola, is_active, zakresy danych,
// ustawienia integracji): tylko PoliAI, gdzie kazdy zapis zatwierdza uzytkownik w panelu.
// Zewnetrzny kanal /api/mcp (dlugowieczny token, klient poza nasza kontrola, ryzyko prompt
// injection z tresci spraw/ICS) ich nie widzi w tools/list ani nie wywola przez tools/call.
export const POLIAI_ONLY: readonly ToolChannel[] = ['poliai'];

export interface ToolDefinition {
  name: string;
  // Krotka nazwa dla czlowieka (MCP annotations.title - klient pokazuje ja przy zgodzie).
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  // Brak = kazda rola z dostepem do MCP (Posel, Administrator i Pracownik).
  roles?: readonly McpRole[];
  // Kanaly, w ktorych narzedzie istnieje. Brak = wszystkie ('mcp' i 'poliai').
  channels?: readonly ToolChannel[];
  // true = narzedzie tylko czyta dane. PoliAI wykonuje je bez pytania; pozostale
  // (brak flagi) wymagaja zatwierdzenia przez uzytkownika w panelu.
  readOnly?: true;
  // MCP annotations narzedzi zapisu (tools/index.ts listTools). Brak nonDestructive = zachowawczo
  // destructiveHint (wartosc domyslna specyfikacji MCP): usuwanie, decyzje bez odwrotu, skutki
  // widoczne poza biurem. nonDestructive = zwykle utworzenie lub zmiana rekordu.
  nonDestructive?: true;
  // Ponowne wywolanie z tymi samymi argumentami nie zmienia juz stanu (idempotentHint).
  idempotent?: true;
  // Dziala na serwisie zewnetrznym (adres ICS), nie tylko na bazie biura (openWorldHint).
  openWorld?: true;
  handler: (args: Record<string, unknown>, ctx: McpAuthContext) => Promise<ToolResult>;
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export function textResult(text: string, isError = false): ToolResult {
  return { content: [{ type: 'text', text }], isError };
}

export function jsonResult(value: unknown): ToolResult {
  return textResult(JSON.stringify(value, null, 2));
}

// Tresc od osob spoza biura (formularz na stronie publicznej, kalendarze ICS) trafia
// do modelu jako dane. Rekord z takiego zrodla dostaje niezaufana_tresc: true i liste pol
// z ta trescia; instrukcje serwera (initialize w api/mcp.ts) kaza traktowac je jako dane, nigdy
// jako polecenia (prompt injection). Zmiana addytywna - wartosci pol bez zmian.
const PUBLIC_CASE_FIELDS = ['title', 'description', 'reporter_name', 'reporter_email', 'reporter_phone'];
const ICS_EVENT_FIELDS = ['title', 'description', 'location'];

function markUntrusted<T extends Record<string, unknown>>(row: T, fields: readonly string[]) {
  return { ...row, niezaufana_tresc: true as const, niezaufane_pola: fields.filter((f) => f in row) };
}

/** Sprawa z anonimowego formularza (source = 'public_form'); zapytanie musi pobierac `source`. */
export function markCase<T extends Record<string, unknown>>(row: T) {
  return row.source === 'public_form' ? markUntrusted(row, PUBLIC_CASE_FIELDS) : row;
}

/** Wydarzenie zaimportowane z kalendarza ICS; zapytanie musi pobierac `ics_source_id`. */
export function markEvent<T extends Record<string, unknown>>(row: T) {
  return row.ics_source_id ? markUntrusted(row, ICS_EVENT_FIELDS) : row;
}

/**
 * Wpis audit_log bez autora (user_email NULL): zapis z formularza publicznego, synchronizacji
 * ICS lub zadania systemowego - metadane moga zawierac tytuly zgloszen spoza biura.
 */
export function markAuditEntry<T extends Record<string, unknown>>(entry: T) {
  return entry.user_email ? entry : markUntrusted(entry, ['metadata']);
}

export class ToolValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolValidationError';
  }
}

export function requireString(args: Record<string, unknown>, key: string, max = 1000): string {
  const v = args[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new ToolValidationError(`Pole "${key}" jest wymagane (string).`);
  }
  if (v.length > max) {
    throw new ToolValidationError(`Pole "${key}" nie moze przekraczac ${max} znakow.`);
  }
  return v;
}

export function optionalString(args: Record<string, unknown>, key: string, max = 5000): string | null {
  const v = args[key];
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') {
    throw new ToolValidationError(`Pole "${key}" musi byc stringiem.`);
  }
  if (v.length > max) {
    throw new ToolValidationError(`Pole "${key}" nie moze przekraczac ${max} znakow.`);
  }
  return v;
}

export function optionalEnum<T extends string>(
  args: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T | null {
  const v = args[key];
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !allowed.includes(v as T)) {
    throw new ToolValidationError(
      `Pole "${key}" musi byc jednym z: ${allowed.join(', ')} (otrzymano: ${String(v)}).`,
    );
  }
  return v as T;
}

export function optionalNumber(args: Record<string, unknown>, key: string): number | null {
  const v = args[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new ToolValidationError(`Pole "${key}" musi byc liczba.`);
  }
  return v;
}

export function optionalBoolean(args: Record<string, unknown>, key: string): boolean | null {
  const v = args[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== 'boolean') {
    throw new ToolValidationError(`Pole "${key}" musi byc boolean.`);
  }
  return v;
}

export function optionalUuid(args: Record<string, unknown>, key: string): string | null {
  const v = optionalString(args, key, 64);
  if (v === null) return null;
  if (!/^[0-9a-fA-F-]{32,40}$/.test(v)) {
    throw new ToolValidationError(`Pole "${key}" musi byc UUID-em.`);
  }
  return v;
}

export function getLimit(args: Record<string, unknown>, fallback = 20, max = 100): number {
  const v = args.limit;
  if (v === undefined || v === null) return fallback;
  if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) {
    throw new ToolValidationError('Pole "limit" musi byc dodatnia liczba calkowita.');
  }
  return Math.min(v, max);
}
