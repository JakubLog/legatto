import { Check, ChevronDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface FilterOption {
  value: string;
  label: string;
}

interface Props {
  label: string;
  value: string | null;
  options: FilterOption[];
  onChange: (value: string | null) => void;
  disabled?: boolean;
}

export function FilterChip({ label, value, options, onChange, disabled }: Props) {
  const selected = value ? (options.find(o => o.value === value) ?? null) : null;
  const isActive = !!selected;

  return (
    <div
      className={cn(
        // has-[:focus-visible]: pierścień fokusu z klawiatury jak w Button (sama zmiana tła była ledwo widoczna).
        'inline-flex h-8 items-stretch overflow-hidden rounded-full border text-xs font-medium shadow-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/60 has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background max-md:h-10 max-md:text-sm',
        isActive
          ? 'border-primary/30 bg-primary/10 text-primary dark:bg-primary/20'
          : 'border-border bg-card text-muted-foreground',
        disabled && 'opacity-50',
      )}
    >
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={disabled}
          className={cn(
            'inline-flex items-center gap-1.5 pl-3 outline-none transition-colors focus-visible:bg-primary/15 disabled:cursor-not-allowed max-md:pl-4',
            isActive ? 'pr-1.5 hover:bg-primary/15' : 'pr-2.5 hover:bg-muted/60 hover:text-foreground max-md:pr-3.5',
          )}
        >
          {isActive && <span className="font-normal text-primary/70">{label}:</span>}
          <span className="max-w-[12rem] truncate">{selected ? selected.label : label}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72 min-w-44 overflow-y-auto">
          {options.map(o => (
            <DropdownMenuItem
              key={o.value}
              onClick={() => onChange(o.value === value ? null : o.value)}
              className={cn('text-[13px]', o.value === value && 'font-medium text-primary')}
            >
              <span className="flex-1 truncate">{o.label}</span>
              {o.value === value && <Check className="text-primary !opacity-100" />}
            </DropdownMenuItem>
          ))}
          {isActive && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onChange(null)} className="text-[13px] text-muted-foreground">
                <X />
                Wyczyść ({label})
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {isActive && (
        <button
          type="button"
          onClick={() => onChange(null)}
          disabled={disabled}
          className="inline-flex items-center pl-1 pr-2.5 transition-colors hover:bg-primary/15 focus-visible:bg-primary/15 focus-visible:outline-none disabled:cursor-not-allowed max-md:px-3"
          aria-label={`Wyczyść ${label}`}
        >
          <X className="h-3.5 w-3.5 max-md:h-4 max-md:w-4" />
        </button>
      )}
    </div>
  );
}
