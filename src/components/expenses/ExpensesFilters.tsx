import { Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchSelect } from '@/components/ui/search-select';
import { useExpenseCategories } from '@/hooks/useExpenseCategories';
import type { ExpensesFilters as Filters } from '@/hooks/useExpenses';
import { expenseCategoryClasses } from '@/lib/expenses';
import { cn } from '@/lib/utils';

interface Props {
  value: Filters;
  onChange: (next: Filters) => void;
}

/** Jednoliniowy pasek filtrów listy wydatków: szukaj + kategoria + wyczyść. */
export function ExpensesFilters({ value, onChange }: Props) {
  const { data: categories } = useExpenseCategories();

  const hasAny = !!value.categoryId || (value.search ?? '').length > 0;

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      <div className="relative w-full @sm:w-72">
        <Label htmlFor="expenses-search" className="sr-only">
          Szukaj
        </Label>
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          id="expenses-search"
          type="search"
          placeholder="Tytuł, kontrahent, nr faktury..."
          value={value.search ?? ''}
          onChange={(e) => onChange({ ...value, search: e.target.value })}
          className="pl-9"
        />
      </div>

      <SearchSelect
        aria-label="Kategoria"
        className="w-full @sm:w-56 @max-sm:min-w-0 @max-sm:flex-1"
        value={value.categoryId ? String(value.categoryId) : null}
        onChange={(v) => onChange({ ...value, categoryId: v ? Number(v) : null })}
        noneLabel="Wszystkie kategorie"
        placeholder="Wszystkie kategorie"
        options={(categories ?? []).map((c) => ({
          value: String(c.id),
          label: c.name,
          icon: (
            <span
              className={cn('h-2 w-2 shrink-0 rounded-full', expenseCategoryClasses(c.color).dot)}
              aria-hidden
            />
          ),
        }))}
      />

      {hasAny && (
        <Button
          variant="ghost"
          size="sm"
          className="max-md:h-11"
          onClick={() => onChange({ ...value, categoryId: null, search: '' })}
        >
          <X /> Wyczyść
        </Button>
      )}
    </div>
  );
}
