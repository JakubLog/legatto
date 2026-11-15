import { cn } from '@/lib/utils';
import { expenseCategoryClasses } from '@/lib/expenses';
import type { OfficeExpenseWithRelations } from '@/integrations/supabase/types';

interface Props {
  category: OfficeExpenseWithRelations['category'];
  className?: string;
}

/** Pigułka kategorii wydatku: kolorowa kropka + nazwa. */
export function ExpenseCategoryPill({ category, className }: Props) {
  if (!category) {
    return <span className={cn('text-xs text-muted-foreground', className)}>Bez kategorii</span>;
  }
  const classes = expenseCategoryClasses(category.color);
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
        classes.pill,
        className,
      )}
      title={category.name}
    >
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', classes.dot)} aria-hidden />
      <span className="truncate">{category.name}</span>
    </span>
  );
}
