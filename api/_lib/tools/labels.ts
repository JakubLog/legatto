// Nazwy obok identyfikatorow w wynikach narzedzi MCP/PoliAI. Pola wyboru (kategoria, powiat,
// gmina, osoba, biuro) sa w bazie liczbami albo UUID - bez nazw model nie wie, co oznaczaja.
// Do kazdego pola ze specyfikacji dokladamy obok `<pole bez _id>_name`, np. category_id ->
// category_name, assigned_to -> assigned_to_name. Slowniki do wyboru wartosci przy zapisie:
// dictionaries.ts (*_list).

import { getServiceClient } from '../supabase.js';
import { DbError, errorSummary } from '../log-safe.js';

type Dictionary = 'case_categories' | 'expense_categories' | 'powiaty' | 'gminy' | 'profiles';

const NAME_COLUMN: Record<Dictionary, string> = {
  case_categories: 'name',
  expense_categories: 'name',
  powiaty: 'name',
  gminy: 'name',
  profiles: 'full_name',
};

/** Pole z identyfikatorem -> slownik, z ktorego bierzemy nazwe. */
export type LabelSpec = Record<string, Dictionary>;

export const CASE_LABELS: LabelSpec = {
  category_id: 'case_categories',
  powiat_id: 'powiaty',
  gmina_id: 'gminy',
  assigned_to: 'profiles',
  created_by: 'profiles',
};
export const CONTACT_LABELS: LabelSpec = { powiat_id: 'powiaty', gmina_id: 'gminy', created_by: 'profiles' };
export const EVENT_LABELS: LabelSpec = {
  powiat_id: 'powiaty',
  gmina_id: 'gminy',
  assigned_to: 'profiles',
  created_by: 'profiles',
};
export const EXPENSE_LABELS: LabelSpec = { category_id: 'expense_categories', created_by: 'profiles' };
export const INTERPELLATION_LABELS: LabelSpec = { signatory_id: 'profiles', created_by: 'profiles' };

function nameField(field: string): string {
  return `${field.replace(/_id$/, '')}_name`;
}

type Row = Record<string, unknown>;

/**
 * Wiersze z nazwami obok identyfikatorow (kolejnosc kluczy zachowana, nazwa zaraz po polu).
 * Brak nazwy (usuniety rekord) = null. Blad pobrania slownika nie psuje wyniku narzedzia -
 * wiersze wracaja bez nazw.
 */
export async function withLabels<T extends Row>(rows: T[], spec: LabelSpec): Promise<T[]> {
  const ids = new Map<Dictionary, Set<string | number>>();
  for (const row of rows) {
    for (const [field, dict] of Object.entries(spec)) {
      const value = row[field];
      if (typeof value === 'string' || typeof value === 'number') {
        if (!ids.has(dict)) ids.set(dict, new Set());
        ids.get(dict)!.add(value);
      }
    }
  }
  if (ids.size === 0) return rows;

  const names = new Map<string, string>();
  try {
    await Promise.all(
      [...ids].map(async ([dict, values]) => {
        const column = NAME_COLUMN[dict];
        const { data, error } = await getServiceClient()
          .from(dict)
          .select(`id, ${column}`)
          .in('id', [...values]);
        if (error) throw new DbError(error, dict);
        for (const item of (data ?? []) as unknown as Row[]) {
          const name = item[column];
          if (typeof name === 'string') names.set(`${dict}:${String(item.id)}`, name);
        }
      }),
    );
  } catch (err) {
    console.warn('[tools] labels failed', errorSummary(err));
    return rows;
  }

  return rows.map((row) => {
    const out: Row = {};
    for (const [key, value] of Object.entries(row)) {
      out[key] = value;
      const dict = spec[key];
      if (dict && value !== undefined) {
        out[nameField(key)] = value === null ? null : (names.get(`${dict}:${String(value)}`) ?? null);
      }
    }
    return out as T;
  });
}

/** Jeden wiersz (get/create/update) - jak withLabels. */
export async function withLabel<T extends Row>(row: T, spec: LabelSpec): Promise<T> {
  const [labelled] = await withLabels([row], spec);
  return labelled;
}
