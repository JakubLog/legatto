import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { EVENT_TYPES, EVENT_TYPE_LABELS } from '@/lib/events';
import type { EventType } from '@/integrations/supabase/types';
import { useAssignableUsers } from '@/hooks/useUsers';
import type { EventsFilters as Filters } from '@/hooks/useEvents';
import { FilterChip } from '@/components/common/FilterChip';

interface Props {
  value: Filters;
  onChange: (next: Filters) => void;
}

const TYPE_OPTIONS = EVENT_TYPES.map(t => ({ value: t, label: EVENT_TYPE_LABELS[t] }));

export function EventsFilters({ value, onChange }: Props) {
  const { data: users = [] } = useAssignableUsers();

  const hasAny = !!value.type || !!value.assignedTo || (value.search ?? '').length > 0;

  const userOptions = users.map(u => ({ value: u.id, label: u.full_name }));

  return (
    // Wąski obszar modułu (telefon, panel PoliAI): wyszukiwarka w pełnym wierszu, chipy zawijane pod nią (zamiast przewijania w bok).
    <div className="-m-1 flex items-center gap-2 overflow-x-auto p-1 [scrollbar-width:none] @max-md:flex-wrap max-md:gap-y-3 [&::-webkit-scrollbar]:hidden">
      <div className="relative shrink-0 @max-md:w-full">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground max-md:left-3 max-md:h-4 max-md:w-4" />
        <Input
          aria-label="Szukaj wydarzeń"
          className="h-8 w-40 rounded-lg pl-8 text-xs @max-md:w-full max-md:pl-9 max-md:text-base @md:w-56"
          placeholder="Szukaj wydarzeń..."
          value={value.search ?? ''}
          onChange={e => onChange({ ...value, search: e.target.value })}
        />
      </div>

      <div className="shrink-0">
        <FilterChip
          label="Typ"
          value={value.type ?? null}
          options={TYPE_OPTIONS}
          onChange={v => onChange({ ...value, type: v as EventType | null })}
        />
      </div>

      <div className="shrink-0">
        <FilterChip
          label="Odpowiedzialny"
          value={value.assignedTo ?? null}
          options={userOptions}
          onChange={v => onChange({ ...value, assignedTo: v })}
        />
      </div>

      {hasAny && (
        <button
          type="button"
          onClick={() => onChange({ type: null, assignedTo: null, search: '' })}
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground max-md:h-10 max-md:px-3 max-md:text-sm"
        >
          <X className="h-3 w-3" />
          Wyczyść
        </button>
      )}
    </div>
  );
}
