import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  page: number;
  total: number;
  pageSize: number;
  onChange: (page: number) => void;
}

export function Pagination({ page, total, pageSize, onChange }: Props) {
  const pageCount = Math.ceil(total / pageSize);
  if (pageCount <= 1) return null;

  const from = page * pageSize + 1;
  const to = Math.min((page + 1) * pageSize, total);

  // Buduje listę stron: cyfry lub '...'
  function pages(): (number | '...')[] {
    if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i);
    const result: (number | '...')[] = [];
    const add = (n: number) => { if (!result.includes(n)) result.push(n); };
    add(0);
    if (page > 2) result.push('...');
    for (let i = Math.max(1, page - 1); i <= Math.min(pageCount - 2, page + 1); i++) add(i);
    if (page < pageCount - 3) result.push('...');
    add(pageCount - 1);
    return result;
  }

  const btnBase = 'inline-flex h-8 min-w-8 items-center justify-center rounded-lg border px-2 text-xs font-medium tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 max-md:h-10 max-md:min-w-10';

  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-xs tabular-nums text-muted-foreground">
        {from}–{to} z {total}
      </span>

      <div className="flex items-center gap-0.5 max-md:gap-2">
        <button
          type="button"
          onClick={() => onChange(page - 1)}
          disabled={page === 0}
          className={cn(btnBase, 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40')}
          aria-label="Poprzednia strona"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        {/* Na mobile zamiast listy stron tylko licznik między strzałkami. */}
        <span className="px-1 text-sm tabular-nums text-muted-foreground md:hidden">
          {page + 1} / {pageCount}
        </span>

        {pages().map((p, i) =>
          p === '...'
            ? <span key={`ellipsis-${i}`} className="px-1 text-xs text-muted-foreground/70 max-md:hidden">…</span>
            : (
              <button
                key={p}
                type="button"
                onClick={() => onChange(p)}
                className={cn(
                  btnBase,
                  'max-md:hidden',
                  p === page
                    ? 'border-primary/30 bg-primary/10 text-primary dark:bg-primary/20'
                    : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
                aria-current={p === page ? 'page' : undefined}
              >
                {p + 1}
              </button>
            )
        )}

        <button
          type="button"
          onClick={() => onChange(page + 1)}
          disabled={page >= pageCount - 1}
          className={cn(btnBase, 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40')}
          aria-label="Następna strona"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
