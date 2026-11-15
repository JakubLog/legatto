import type { AssignableUser } from '@/hooks/useUsers';

export interface AssignableUsersGroup {
  key: string;
  label: string;
  users: AssignableUser[];
}

const NO_OFFICE_KEY = '__none__';

/**
 * Grupuje osoby po biurze: najpierw biuro bieżącego użytkownika, potem pozostałe
 * alfabetycznie, na końcu osoby bez biura (np. Poseł). Opcjonalny filtr po imieniu,
 * nazwie biura lub mieście.
 */
export function groupUsersByOffice(
  users: AssignableUser[],
  currentOfficeId: string | null | undefined,
  query = '',
): AssignableUsersGroup[] {
  const q = query.trim().toLocaleLowerCase('pl');
  const groups = new Map<string, AssignableUsersGroup>();

  for (const u of users) {
    if (
      q &&
      ![u.full_name, u.office_name, u.office_city].some((v) => v?.toLocaleLowerCase('pl').includes(q))
    ) {
      continue;
    }
    const key = u.office_id ?? NO_OFFICE_KEY;
    let group = groups.get(key);
    if (!group) {
      const label = u.office_id ? officeLabel(u.office_name, u.office_city) : 'Bez biura';
      group = { key, label, users: [] };
      groups.set(key, group);
    }
    group.users.push(u);
  }

  const rank = (g: AssignableUsersGroup) =>
    g.key === currentOfficeId ? 0 : g.key === NO_OFFICE_KEY ? 2 : 1;
  return [...groups.values()].sort(
    (a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label, 'pl'),
  );
}

/** "Biuro Główne — Miasto"; miasto pomijane, gdy nazwa biura już je zawiera. */
function officeLabel(name: string | null, city: string | null): string {
  if (!name) return city || 'Biuro';
  if (!city || name.toLocaleLowerCase('pl').includes(city.toLocaleLowerCase('pl'))) return name;
  return `${name} — ${city}`;
}
