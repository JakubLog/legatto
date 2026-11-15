import type { ContactType, Gmina, Powiat } from '@/integrations/supabase/types';

export type TargetField =
  | 'type'
  | 'first_name'
  | 'last_name'
  | 'full_name_first_last'
  | 'full_name_last_first'
  | 'function'
  | 'phone'
  | 'email'
  | 'powiat'
  | 'gmina'
  | 'miejscowosc'
  | 'street'
  | 'postal_code'
  | 'notes';

export const TARGET_FIELD_LABELS: Record<TargetField, string> = {
  type: 'Typ kontaktu',
  first_name: 'Imię',
  last_name: 'Nazwisko',
  full_name_first_last: 'Imię i nazwisko (np. Jan Kowalski)',
  full_name_last_first: 'Nazwisko i imię (np. Kowalski Jan)',
  function: 'Funkcja / stanowisko',
  phone: 'Telefon',
  email: 'Email',
  powiat: 'Powiat',
  gmina: 'Gmina',
  miejscowosc: 'Miejscowość',
  street: 'Ulica',
  postal_code: 'Kod pocztowy',
  notes: 'Notatki',
};

export const TARGET_FIELDS: TargetField[] = [
  'type',
  'first_name',
  'last_name',
  'full_name_first_last',
  'full_name_last_first',
  'function',
  'phone',
  'email',
  'powiat',
  'gmina',
  'miejscowosc',
  'street',
  'postal_code',
  'notes',
];

export const REQUIRED_FIELDS = new Set<TargetField>([
  'type',
  'first_name',
  'last_name',
  'powiat',
]);

export const DICT_FIELDS = new Set<TargetField>(['type', 'powiat', 'gmina']);

export function isFullNameTarget(f: TargetField): boolean {
  return f === 'full_name_first_last' || f === 'full_name_last_first';
}

export function isFirstLastTarget(f: TargetField): boolean {
  return f === 'first_name' || f === 'last_name';
}

export type Mapping = Record<string, TargetField | 'skip'>;

export type FileFormat = 'csv' | 'xlsx';

export interface ParsedCsv {
  headers: string[];
  samples: Record<string, string[]>;
  rows: Record<string, string>[];
  format: FileFormat;
  delim?: string;
}

function buildParsed(
  rawHeaders: string[],
  rawRows: string[][],
  format: FileFormat,
  delim?: string,
): ParsedCsv {
  const seen = new Map<string, number>();
  const headers = rawHeaders.map((h, i) => {
    const base = h || `Kolumna ${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} (${n})`;
  });

  const samples: Record<string, string[]> = {};
  headers.forEach(h => {
    samples[h] = [];
  });

  const rows: Record<string, string>[] = [];
  for (const cols of rawRows) {
    if (!cols.some(c => c.trim())) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      const val = (cols[idx] ?? '').trim();
      row[h] = val;
      if (samples[h].length < 3 && val) samples[h].push(val);
    });
    rows.push(row);
  }

  return { headers, samples, rows, format, delim };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_ALLOWED_RE = /^[+\d\s\-().]+$/;

function isValidPhone(value: string): boolean {
  if (!PHONE_ALLOWED_RE.test(value)) return false;
  const digits = value.replace(/\D/g, '');
  return digits.length >= 9 && digits.length <= 15;
}

function parseLine(line: string, delim: string): string[] {
  const fields: string[] = [];
  let field = '';
  let inQ = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        inQ = !inQ;
      }
    } else if (ch === delim && !inQ) {
      fields.push(field.trim());
      field = '';
    } else {
      field += ch;
    }
  }
  fields.push(field.trim());
  return fields;
}

export function parseCsv(text: string): ParsedCsv {
  const clean = text.startsWith('﻿') ? text.slice(1) : text;
  const lines = clean.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) {
    return buildParsed([], [], 'csv', ',');
  }

  const first = lines[0];
  const semis = (first.match(/;/g) ?? []).length;
  const commas = (first.match(/,/g) ?? []).length;
  const delim = semis >= commas ? ';' : ',';

  const rawHeaders = parseLine(first, delim);
  const rawRows = lines.slice(1).map(l => parseLine(l, delim));

  return buildParsed(rawHeaders, rawRows, 'csv', delim);
}

export async function parseXlsx(buffer: ArrayBuffer): Promise<ParsedCsv> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buffer, { type: 'array' });
  const firstSheet = wb.SheetNames[0];
  if (!firstSheet) return buildParsed([], [], 'xlsx');

  const sheet = wb.Sheets[firstSheet];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  });
  if (aoa.length === 0) return buildParsed([], [], 'xlsx');

  const toStr = (v: unknown) => (v == null ? '' : String(v));
  const rawHeaders = (aoa[0] ?? []).map(toStr);
  const rawRows = aoa.slice(1).map(r => (r ?? []).map(toStr));

  return buildParsed(rawHeaders, rawRows, 'xlsx');
}

export async function parseFile(file: File): Promise<ParsedCsv> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  const isXlsx =
    ext === 'xlsx' ||
    ext === 'xls' ||
    file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    file.type === 'application/vnd.ms-excel';

  if (isXlsx) {
    return parseXlsx(await file.arrayBuffer());
  }
  return parseCsv(await file.text());
}

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');

const HEURISTICS: Array<[TargetField, RegExp]> = [
  ['full_name_first_last', /^(imienazwisko|imieinazwisko|imnazwisko|fullname|fullnames|name|nazwapelna|imienazw)$/],
  ['full_name_last_first', /^(nazwiskoimie|nazwiskoiimie|nazwiskoimi|surnamename|lastnamefirstname|nazwiskoinaz)$/],
  ['first_name', /^(imie|firstname|firstnames|imie1)$/],
  ['last_name', /^(nazwisko|lastname|surname|familyname)$/],
  ['phone', /^(telefon|tel|phone|numer|komorka|mobile|tel1|nrtelefonu)$/],
  ['email', /^(email|mail|adresemail|emailaddress|eposta|epostadres)$/],
  ['miejscowosc', /^(miejscowosc|miasto|wies|city|town|locality|miejsce)$/],
  ['function', /^(funkcja|stanowisko|position|role|tytul|rola)$/],
  ['street', /^(ulica|adres|address|street|adres1)$/],
  ['postal_code', /^(kodpocztowy|kod|postalcode|postal|zip|zipcode|kodp)$/],
  ['notes', /^(notatki|uwagi|notes|komentarz|comment|opis|note)$/],
  ['type', /^(typ|rodzaj|kategoria|type|category|typkontaktu)$/],
  ['powiat', /^(powiat|county|district)$/],
  ['gmina', /^(gmina|municipality|borough|commune)$/],
];

export function detectField(header: string): TargetField | null {
  const n = norm(header);
  if (!n) return null;
  for (const [field, re] of HEURISTICS) {
    if (re.test(n)) return field;
  }
  return null;
}

export function autoMap(headers: string[]): Mapping {
  const used = new Set<TargetField>();
  const map: Mapping = {};
  for (const h of headers) {
    const f = detectField(h);
    if (f && !used.has(f)) {
      map[h] = f;
      used.add(f);
    } else {
      map[h] = 'skip';
    }
  }
  return map;
}

const CONTACT_TYPE_VALUES: ContactType[] = [
  'wyborca',
  'dziennikarz',
  'samorządowiec',
  'sołtys',
  'inne',
];

export function lookupContactType(value: string): ContactType | null {
  const n = norm(value);
  if (!n) return null;
  return CONTACT_TYPE_VALUES.find(v => norm(v) === n) ?? null;
}

export function lookupPowiat(value: string, powiaty: Pick<Powiat, 'id' | 'name'>[]): number | null {
  const n = norm(value);
  if (!n) return null;
  return powiaty.find(p => norm(p.name) === n)?.id ?? null;
}

export function lookupGmina(
  value: string,
  powiatId: number,
  gminy: Pick<Gmina, 'id' | 'name' | 'powiat_id'>[],
): number | null {
  const n = norm(value);
  if (!n) return null;
  return gminy.find(g => g.powiat_id === powiatId && norm(g.name) === n)?.id ?? null;
}

export interface Lookups {
  powiaty: Pick<Powiat, 'id' | 'name'>[];
  gminy: Pick<Gmina, 'id' | 'name' | 'powiat_id'>[];
}

export interface Globals {
  type: ContactType | null;
  powiatId: number | null;
  gminaId: number | null;
}

export type DictField = 'type' | 'powiat' | 'gmina';

export interface MappedRow {
  type: ContactType | null;
  first_name: string;
  last_name: string;
  function: string | null;
  phone: string | null;
  email: string | null;
  powiat_id: number | null;
  gmina_id: number | null;
  miejscowosc: string | null;
  street: string | null;
  postal_code: string | null;
  notes: string | null;
  errors: string[];
  dictFailures: DictField[];
}

export interface MapOptions {
  mapping: Mapping;
  rows: Record<string, string>[];
  lookups: Lookups;
  globals: Globals;
  applyGlobalsToInvalid: boolean;
}

function targetIndex(mapping: Mapping): Partial<Record<TargetField, string>> {
  const idx: Partial<Record<TargetField, string>> = {};
  for (const [header, target] of Object.entries(mapping)) {
    if (target !== 'skip' && !idx[target]) idx[target] = header;
  }
  return idx;
}

export function mapRows(opts: MapOptions): MappedRow[] {
  const { mapping, rows, lookups, globals, applyGlobalsToInvalid } = opts;
  const idx = targetIndex(mapping);

  return rows.map(raw => {
    const get = (f: TargetField): string => {
      const h = idx[f];
      return h ? (raw[h] ?? '').trim() : '';
    };
    const isMapped = (f: TargetField) => Boolean(idx[f]);

    const errors: string[] = [];
    const dictFailures: DictField[] = [];

    // type
    let type: ContactType | null = null;
    if (isMapped('type')) {
      const rawType = get('type');
      if (rawType) {
        type = lookupContactType(rawType);
        if (!type) {
          dictFailures.push('type');
          if (applyGlobalsToInvalid && globals.type) type = globals.type;
          else errors.push(`Nieznany typ: "${rawType}"`);
        }
      } else {
        if (globals.type) type = globals.type;
        else errors.push('Brak typu w wierszu');
      }
    } else {
      type = globals.type;
      if (!type) errors.push('Brak typu (ustaw globalnie)');
    }

    // first_name + last_name (z pełnej nazwy lub z osobnych pól)
    let first_name = '';
    let last_name = '';
    const fullField: TargetField | null = isMapped('full_name_first_last')
      ? 'full_name_first_last'
      : isMapped('full_name_last_first')
        ? 'full_name_last_first'
        : null;

    if (fullField) {
      const raw = get(fullField);
      if (raw) {
        const parts = raw.split(/\s+/).filter(Boolean);
        if (parts.length === 1) {
          // jeden token: zachowaj w polu zgodnym z kolejnością trybu
          if (fullField === 'full_name_first_last') first_name = parts[0];
          else last_name = parts[0];
        } else if (fullField === 'full_name_first_last') {
          last_name = parts[parts.length - 1];
          first_name = parts.slice(0, -1).join(' ');
        } else {
          last_name = parts[0];
          first_name = parts.slice(1).join(' ');
        }
      }
    } else {
      first_name = get('first_name');
      last_name = get('last_name');
    }
    if (!first_name && !last_name) errors.push('Brak imienia i nazwiska');

    // powiat
    let powiat_id: number | null = null;
    if (isMapped('powiat')) {
      const rawPow = get('powiat');
      if (rawPow) {
        powiat_id = lookupPowiat(rawPow, lookups.powiaty);
        if (!powiat_id) {
          dictFailures.push('powiat');
          if (applyGlobalsToInvalid && globals.powiatId) powiat_id = globals.powiatId;
          else errors.push(`Nieznany powiat: "${rawPow}"`);
        }
      } else {
        if (globals.powiatId) powiat_id = globals.powiatId;
        else errors.push('Brak powiatu w wierszu');
      }
    } else {
      powiat_id = globals.powiatId;
      if (!powiat_id) errors.push('Brak powiatu (ustaw globalnie)');
    }

    // gmina (opcjonalne)
    let gmina_id: number | null = null;
    if (isMapped('gmina')) {
      const rawGm = get('gmina');
      if (rawGm) {
        if (powiat_id) {
          gmina_id = lookupGmina(rawGm, powiat_id, lookups.gminy);
          if (!gmina_id) {
            dictFailures.push('gmina');
            if (
              applyGlobalsToInvalid &&
              globals.gminaId &&
              powiat_id === globals.powiatId
            ) {
              gmina_id = globals.gminaId;
            } else {
              errors.push(`Nieznana gmina: "${rawGm}"`);
            }
          }
        }
      }
    } else if (globals.gminaId && powiat_id && powiat_id === globals.powiatId) {
      gmina_id = globals.gminaId;
    }

    // email + phone — jeśli któryś nieprawidłowy, sprawdź czy drugi jest poprawny
    let email: string | null = get('email') || null;
    let phone: string | null = get('phone') || null;
    const emailValid = email ? EMAIL_RE.test(email) : null;
    const phoneValid = phone ? isValidPhone(phone) : null;

    if (emailValid === false || phoneValid === false) {
      const anyValid = emailValid === true || phoneValid === true;
      if (anyValid) {
        if (emailValid === false) email = null;
        if (phoneValid === false) phone = null;
      } else {
        errors.push('Brak poprawnego e-maila i telefonu');
        if (emailValid === false) email = null;
        if (phoneValid === false) phone = null;
      }
    }

    return {
      type,
      first_name,
      last_name,
      function: get('function') || null,
      phone,
      email,
      powiat_id,
      gmina_id,
      miejscowosc: get('miejscowosc') || null,
      street: get('street') || null,
      postal_code: get('postal_code') || null,
      notes: get('notes') || null,
      errors,
      dictFailures,
    };
  });
}
