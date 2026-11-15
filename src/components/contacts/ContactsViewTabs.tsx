import { Mail, Users, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ContactsView = 'baza' | 'kampanie';

const TABS: { value: ContactsView; label: string; icon: LucideIcon }[] = [
  { value: 'baza', label: 'Baza kontaktów', icon: Users },
  { value: 'kampanie', label: 'Kampanie e-mail', icon: Mail },
];

interface Props {
  value: ContactsView;
  onChange: (next: ContactsView) => void;
}

/** Zakładki widoków w stylu ClickUp: ikona + etykieta, aktywna podkreślona (na linii paska narzędzi). */
export function ContactsViewTabs({ value, onChange }: Props) {
  return (
    <div role="tablist" aria-label="Widok kontaktów" className="-mb-[13px] flex items-end gap-1 self-end max-md:gap-2">
      {TABS.map(({ value: tab, label, icon: Icon }) => {
        const active = tab === value;
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab)}
            className={cn(
              'inline-flex h-10 items-center gap-1.5 border-b-2 px-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
            )}
          >
            <Icon className={cn('h-4 w-4', active && 'text-primary')} />
            {label}
          </button>
        );
      })}
    </div>
  );
}
