import type { DataScope } from '@/integrations/supabase/types';

export const DATA_SCOPE_LABELS: Record<DataScope, string> = {
  own: 'Tylko swoje',
  all: 'Wszystkie',
};

export type ScopeModule = 'contacts' | 'cases' | 'events' | 'interpellations';

export const SCOPE_MODULES: ReadonlyArray<{
  module: ScopeModule;
  label: string;
  description: string;
  field: 'scope_contacts' | 'scope_cases' | 'scope_events' | 'scope_interpellations';
}> = [
  {
    module: 'contacts',
    field: 'scope_contacts',
    label: 'Kontakty',
    description: '„Tylko swoje” = widzi kontakty, które sam dodał.',
  },
  {
    module: 'cases',
    field: 'scope_cases',
    label: 'Sprawy',
    description: '„Tylko swoje” = sprawy, które sam stworzył lub ma przypisane.',
  },
  {
    module: 'events',
    field: 'scope_events',
    label: 'Kalendarz',
    description: '„Tylko swoje” = wydarzenia, które sam stworzył lub ma przypisane.',
  },
  {
    module: 'interpellations',
    field: 'scope_interpellations',
    label: 'Interpelacje',
    description: '„Tylko swoje” = interpelacje, które sam stworzył.',
  },
];

export type ScopeField = (typeof SCOPE_MODULES)[number]['field'];

export type DataScopes = Record<ScopeField, DataScope>;

/** Domyślny zakres nowego użytkownika - zgodny z defaultem kolumn w DB ('all'). */
export const DEFAULT_DATA_SCOPES: DataScopes = {
  scope_contacts: 'all',
  scope_cases: 'all',
  scope_events: 'all',
  scope_interpellations: 'all',
};
