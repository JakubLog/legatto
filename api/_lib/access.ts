import type { McpAuthContext, ScopedModule } from './auth.js';

// Narzedzia MCP dzialaja na kliencie service_role, ktory omija RLS. Ten modul
// odtwarza klauzule data_scope z polityk *_select_authenticated:
//   is_posel() OR current_<modul>_scope() = 'all' OR created_by = auth.uid()
//   [OR assigned_to = auth.uid() - tylko cases i events]
// Kazde zapytanie czytajace lub modyfikujace wiersz z tych tabel musi przejsc przez
// applyDataScope, inaczej Pracownik z zakresem 'own' zobaczy cudze dane.

const HAS_ASSIGNEE: Record<ScopedModule, boolean> = {
  cases: true,
  events: true,
  contacts: false,
  interpellations: false,
};

// Ograniczenie tylko na or(): dopasowanie generycznego `eq` z PostgrestFilterBuilder
// konczy sie TS2589 (zbyt gleboka instancjacja typow). Kolejne .or() PostgREST laczy
// przez AND, wiec filtr zakresu nie koliduje z innymi .or() w zapytaniu.
interface ScopeFilterable {
  or(filters: string): unknown;
}

export function applyDataScope<Q extends ScopeFilterable>(
  query: Q,
  ctx: McpAuthContext,
  module: ScopedModule,
): Q {
  if (ctx.dataScopes[module] === 'all') return query;
  const own = `created_by.eq.${ctx.userId}`;
  // PostgREST filter builder mutuje URL i zwraca `this`, wiec typ Q sie nie zmienia.
  return query.or(HAS_ASSIGNEE[module] ? `${own},assigned_to.eq.${ctx.userId}` : own) as Q;
}
