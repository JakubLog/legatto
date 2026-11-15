import type { ReactNode } from 'react';
import { ArrowDownUp, Check, ChevronDown, X } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { FilterOption } from '@/components/common/FilterChip';
import { useAuth } from '@/contexts/AuthContext';
import { useCaseCategories } from '@/hooks/useCaseCategories';
import type { CasesFilters, CasesStatusFilter } from '@/hooks/useCases';
import { useAssignableUsers } from '@/hooks/useUsers';
import type { CasePriority } from '@/integrations/supabase/types';
import { cn } from '@/lib/utils';
import { CASE_PRIORITY_FILTER_OPTIONS, CASE_STATUS_FILTER_OPTIONS } from '@/lib/cases';
import { CASE_ROW_GRID } from './CaseRow';

/** Kolejność wczytanej listy (po stronie klienta): `created` = najnowsze najpierw (kolejność z bazy). */
export type CasesSort = 'created' | 'title' | 'due_asc' | 'due_desc';

interface Props {
  filters: CasesFilters;
  onFiltersChange: (next: CasesFilters) => void;
  sort: CasesSort;
  onSortChange: (next: CasesSort) => void;
}

const SORT_LABELS: Record<CasesSort, string> = {
  created: 'Najnowsze',
  title: 'Nazwa A-Z',
  due_asc: 'Termin: najbliższy',
  due_desc: 'Termin: najdalszy',
};

/**
 * Nagłówek kolumn listy spraw (od @md): klik w nagłówek otwiera filtr tej kolumny
 * (te same filtry co pigułki nad listą) albo sortowanie (Nazwa, Termin).
 */
export function CasesColumnsHeader({ filters, onFiltersChange, sort, onSortChange }: Props) {
  const { profile } = useAuth();
  const { data: categories = [] } = useCaseCategories();
  const { data: users = [] } = useAssignableUsers();
  const set = (patch: Partial<CasesFilters>) => onFiltersChange({ ...filters, ...patch });

  const userOptions = [
    ...(profile ? [{ value: profile.id, label: 'Ja' }] : []),
    ...users.filter((u) => u.id !== profile?.id).map((u) => ({ value: u.id, label: u.full_name })),
  ];

  return (
    <div
      className={cn(
        'hidden h-9 border-b bg-muted/40 px-3 text-xs font-medium text-muted-foreground',
        CASE_ROW_GRID,
      )}
    >
      <HeaderMenu label="Nazwa" active={sort === 'title'} sortable>
        {(['created', 'title'] as const).map((s) => (
          <OptionItem key={s} label={SORT_LABELS[s]} selected={sort === s} onSelect={() => onSortChange(s)} />
        ))}
      </HeaderMenu>
      <HeaderMenu label="Status" active={Boolean(filters.status)}>
        <OptionItems
          label="Status"
          options={CASE_STATUS_FILTER_OPTIONS}
          value={filters.status ?? null}
          onChange={(v) => set({ status: v as CasesStatusFilter | null })}
        />
      </HeaderMenu>
      <HeaderMenu label="Kategoria" active={Boolean(filters.categoryId)} className="@md:hidden @lg:flex">
        <OptionItems
          label="Kategoria"
          options={categories.map((c) => ({ value: String(c.id), label: c.name }))}
          value={filters.categoryId ? String(filters.categoryId) : null}
          onChange={(v) => set({ categoryId: v ? Number(v) : null })}
        />
      </HeaderMenu>
      <HeaderMenu label="Priorytet" active={Boolean(filters.priority)} className="@md:hidden @lg:flex">
        <OptionItems
          label="Priorytet"
          options={CASE_PRIORITY_FILTER_OPTIONS}
          value={filters.priority ?? null}
          onChange={(v) => set({ priority: v as CasePriority | null })}
        />
      </HeaderMenu>
      <HeaderMenu label="Osoba" active={Boolean(filters.assignedTo)}>
        <OptionItems
          label="Osoba"
          options={userOptions}
          value={filters.assignedTo ?? null}
          onChange={(v) => set({ assignedTo: v })}
        />
      </HeaderMenu>
      <HeaderMenu label="Termin" active={sort === 'due_asc' || sort === 'due_desc'} sortable>
        {(['due_asc', 'due_desc'] as const).map((s) => (
          <OptionItem key={s} label={SORT_LABELS[s]} selected={sort === s} onSelect={() => onSortChange(s)} />
        ))}
        {(sort === 'due_asc' || sort === 'due_desc') && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onSortChange('created')} className="text-[13px] text-muted-foreground">
              <X />
              Domyślna kolejność
            </DropdownMenuItem>
          </>
        )}
      </HeaderMenu>
      <span className="sr-only">Akcje</span>
    </div>
  );
}

interface HeaderMenuProps {
  label: string;
  active: boolean;
  sortable?: boolean;
  className?: string;
  children: ReactNode;
}

function HeaderMenu({ label, active, sortable, className, children }: HeaderMenuProps) {
  const Icon = sortable ? ArrowDownUp : ChevronDown;
  return (
    <div className={cn('flex min-w-0', className)}>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            '-mx-1.5 inline-flex h-7 min-w-0 items-center gap-1 rounded-md px-1.5 outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 data-[state=open]:bg-muted',
            active && 'text-primary hover:text-primary',
          )}
          aria-label={sortable ? `${label} - sortowanie` : `${label} - filtr`}
        >
          <span className="truncate">{label}</span>
          {active && !sortable && <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
          <Icon className="h-3 w-3 shrink-0 opacity-60" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72 min-w-44 overflow-y-auto">
          {children}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function OptionItem({ label, selected, onSelect }: { label: string; selected: boolean; onSelect: () => void }) {
  return (
    <DropdownMenuItem onSelect={onSelect} className={cn('text-[13px]', selected && 'font-medium text-primary')}>
      <span className="flex-1 truncate">{label}</span>
      {selected && <Check className="text-primary !opacity-100" />}
    </DropdownMenuItem>
  );
}

interface OptionItemsProps {
  label: string;
  options: FilterOption[];
  value: string | null;
  onChange: (value: string | null) => void;
}

function OptionItems({ label, options, value, onChange }: OptionItemsProps) {
  return (
    <>
      {options.map((o) => (
        <OptionItem
          key={o.value}
          label={o.label}
          selected={o.value === value}
          onSelect={() => onChange(o.value === value ? null : o.value)}
        />
      ))}
      {value && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onChange(null)} className="text-[13px] text-muted-foreground">
            <X />
            Wyczyść ({label})
          </DropdownMenuItem>
        </>
      )}
    </>
  );
}
