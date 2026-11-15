import { CornerDownLeft, type LucideIcon } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { CommandItem, Kbd } from './command';
import { SEARCH_SHORTCUT_LABEL } from './constants';

interface SearchItemProps {
  value: string;
  Icon: LucideIcon;
  title: string;
  subtitle?: string | null;
  /** Rekordy - ikona w kolorze marki; strony/akcje - neutralna. */
  tone?: 'record' | 'neutral';
  onSelect: () => void;
}

export function SearchItem({ value, Icon, title, subtitle, tone = 'neutral', onSelect }: SearchItemProps) {
  return (
    <CommandItem value={value} onSelect={onSelect} className="group">
      <span
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
          tone === 'record' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground group-data-[selected=true]:bg-background',
        )}
        aria-hidden
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{title}</span>
        {subtitle && <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>}
      </span>
      <CornerDownLeft
        className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 group-data-[selected=true]:opacity-100 max-md:hidden"
        aria-hidden
      />
    </CommandItem>
  );
}

export function SearchSkeleton() {
  return (
    <div className="space-y-1 px-1 py-2" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex h-10 items-center gap-3 px-1.5">
          <Skeleton className="h-7 w-7 rounded-md" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="h-2.5 w-1/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SearchFooter() {
  return (
    <div className="hidden items-center gap-4 border-t bg-muted/40 px-4 py-2 text-xs text-muted-foreground md:flex">
      <span className="flex items-center gap-1.5">
        <Kbd>↑</Kbd>
        <Kbd>↓</Kbd>
        wybierz
      </span>
      <span className="flex items-center gap-1.5">
        <Kbd>↵</Kbd>
        otwórz
      </span>
      <span className="flex items-center gap-1.5">
        <Kbd>Esc</Kbd>
        zamknij
      </span>
      <span className="ml-auto flex items-center gap-1.5">
        <Kbd>{SEARCH_SHORTCUT_LABEL}</Kbd>
        wyszukiwarka
      </span>
    </div>
  );
}
