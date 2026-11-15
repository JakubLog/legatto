import { Mail, Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { CONTACT_TYPES, CONTACT_TYPE_LABELS } from '@/lib/contacts';
import type { ContactType } from '@/integrations/supabase/types';
import { usePowiaty } from '@/hooks/usePowiaty';
import { useGminy } from '@/hooks/useGminy';
import { useAssignableUsers } from '@/hooks/useUsers';
import type { ContactsFilters as Filters } from '@/hooks/useContacts';
import { FilterChip } from '@/components/common/FilterChip';
import { cn } from '@/lib/utils';
import { EMPTY_CONTACT_FILTERS, hasActiveContactFilters } from './filters';

interface Props {
  value: Filters;
  onChange: (next: Filters) => void;
}

const TYPE_OPTIONS = CONTACT_TYPES.map(t => ({ value: t, label: CONTACT_TYPE_LABELS[t] }));

/** Jednoliniowy pasek filtrów: wyszukiwarka + chipy. */
export function ContactsFilters({ value, onChange }: Props) {
  const { data: powiaty = [] } = usePowiaty();
  const { data: gminy = [] } = useGminy(value.powiatId ?? null);
  const { data: users = [] } = useAssignableUsers();

  const powiatOptions = powiaty.map(p => ({ value: String(p.id), label: p.name }));
  const gminaOptions = gminy.map(g => ({ value: String(g.id), label: g.name }));
  const userOptions = users.map(u => ({ value: u.id, label: u.full_name }));
  const newsletterOn = value.newsletterConsent === true;

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 max-md:gap-2.5">
      <div className="relative w-full @sm:w-60">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground max-md:h-4 max-md:w-4" />
        <Input
          type="search"
          className="h-8 rounded-full pl-8 shadow-sm max-md:pl-9"
          placeholder="Nazwisko, funkcja..."
          aria-label="Szukaj kontaktów"
          value={value.search ?? ''}
          onChange={e => onChange({ ...value, search: e.target.value })}
        />
      </div>

      <FilterChip
        label="Typ"
        value={value.type ?? null}
        options={TYPE_OPTIONS}
        onChange={v => onChange({ ...value, type: v as ContactType | null })}
      />

      <FilterChip
        label="Powiat"
        value={value.powiatId ? String(value.powiatId) : null}
        options={powiatOptions}
        onChange={v =>
          onChange({ ...value, powiatId: v ? Number(v) : null, gminaId: null })
        }
      />

      <FilterChip
        label="Gmina"
        value={value.gminaId ? String(value.gminaId) : null}
        options={gminaOptions}
        onChange={v => onChange({ ...value, gminaId: v ? Number(v) : null })}
        disabled={!value.powiatId}
      />

      <FilterChip
        label="Dodał"
        value={value.createdBy ?? null}
        options={userOptions}
        onChange={v => onChange({ ...value, createdBy: v })}
      />

      <button
        type="button"
        aria-pressed={newsletterOn}
        onClick={() => onChange({ ...value, newsletterConsent: newsletterOn ? null : true })}
        className={cn(
          'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium shadow-sm transition-colors max-md:h-10 max-md:px-3.5 max-md:text-sm',
          newsletterOn
            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-400'
            : 'border-border bg-card text-muted-foreground hover:bg-muted/60 hover:text-foreground',
        )}
      >
        <Mail className="h-3.5 w-3.5" />
        Newsletter
      </button>

      {hasActiveContactFilters(value) && (
        <button
          type="button"
          onClick={() => onChange(EMPTY_CONTACT_FILTERS)}
          className="inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground max-md:h-10 max-md:px-3.5 max-md:text-sm"
        >
          <X className="h-3.5 w-3.5" />
          Wyczyść
        </button>
      )}
    </div>
  );
}
