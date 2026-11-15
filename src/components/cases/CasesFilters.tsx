import { Search, UserRound, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { CASE_PRIORITY_FILTER_OPTIONS, CASE_STATUS_FILTER_OPTIONS } from '@/lib/cases';
import type { CasePriority, CaseSource } from '@/integrations/supabase/types';
import { useCaseCategories } from '@/hooks/useCaseCategories';
import { useAssignableUsers } from '@/hooks/useUsers';
import type { CasesFilters as Filters, CasesStatusFilter } from '@/hooks/useCases';
import { FilterChip } from '@/components/common/FilterChip';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

interface Props {
  value: Filters;
  onChange: (next: Filters) => void;
}

const SOURCE_OPTIONS = [
  { value: 'internal', label: 'Wewnętrzne' },
  { value: 'public_form', label: 'Publiczne' },
];

export const EMPTY_CASES_FILTERS: Filters = {
  status: null, priority: null, categoryId: null,
  assignedTo: null, source: null, search: '',
};

export function CasesFilters({ value, onChange }: Props) {
  const { profile } = useAuth();
  const { data: categories = [] } = useCaseCategories();
  const { data: users = [] } = useAssignableUsers();

  // „Moje sprawy” = filtr „Przypisana do” ustawiony na mnie (ten sam stan, dwa skróty).
  const mine = Boolean(profile) && value.assignedTo === profile?.id;
  const hasAny =
    !!value.status || !!value.priority || !!value.categoryId ||
    !!value.assignedTo || !!value.source || (value.search ?? '').length > 0;

  const categoryOptions = categories.map(c => ({ value: String(c.id), label: c.name }));
  const userOptions = users.map(u => ({ value: u.id, label: u.full_name }));

  return (
    <div className="flex w-full min-w-0 flex-wrap items-center gap-2 max-md:gap-2.5 @sm:w-auto @sm:flex-1">
      <div className="relative w-full @sm:w-60">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground max-md:h-4 max-md:w-4" />
        <Input
          type="search"
          aria-label="Szukaj spraw"
          className="h-8 rounded-full pl-8 shadow-sm max-md:pl-9"
          placeholder="Szukaj spraw..."
          value={value.search ?? ''}
          onChange={e => onChange({ ...value, search: e.target.value })}
        />
      </div>

      <button
        type="button"
        aria-pressed={mine}
        disabled={!profile}
        onClick={() => onChange({ ...value, assignedTo: mine ? null : (profile?.id ?? null) })}
        className={cn(
          'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background max-md:h-10 max-md:px-4 max-md:text-sm',
          mine
            ? 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/15 dark:bg-primary/20'
            : 'border-border bg-card text-muted-foreground hover:bg-muted/60 hover:text-foreground',
        )}
      >
        <UserRound className="h-3.5 w-3.5" />
        Moje sprawy
      </button>

      <FilterChip
        label="Status"
        value={value.status ?? null}
        options={CASE_STATUS_FILTER_OPTIONS}
        onChange={v => onChange({ ...value, status: v as CasesStatusFilter | null })}
      />

      <FilterChip
        label="Priorytet"
        value={value.priority ?? null}
        options={CASE_PRIORITY_FILTER_OPTIONS}
        onChange={v => onChange({ ...value, priority: v as CasePriority | null })}
      />

      <FilterChip
        label="Kategoria"
        value={value.categoryId ? String(value.categoryId) : null}
        options={categoryOptions}
        onChange={v => onChange({ ...value, categoryId: v ? Number(v) : null })}
      />

      <FilterChip
        label="Przypisana do"
        value={value.assignedTo ?? null}
        options={userOptions}
        onChange={v => onChange({ ...value, assignedTo: v })}
      />

      <FilterChip
        label="Źródło"
        value={value.source ?? null}
        options={SOURCE_OPTIONS}
        onChange={v => onChange({ ...value, source: v as CaseSource | null })}
      />

      {hasAny && (
        <button
          type="button"
          onClick={() => onChange(EMPTY_CASES_FILTERS)}
          className="inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground max-md:h-10 max-md:px-3.5 max-md:text-sm"
        >
          <X className="h-3.5 w-3.5" />
          Wyczyść
        </button>
      )}
    </div>
  );
}
