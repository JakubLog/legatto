import { useId, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SettingsSectionProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
}

/**
 * Sekcja ustawień w stylu ClickUp: karta z tytułem/opisem po lewej
 * i treścią po prawej (od md), na mobile jedna kolumna.
 */
export function SettingsSection({ title, description, icon: Icon, children, className }: SettingsSectionProps) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className={cn(
        'grid gap-4 rounded-xl border bg-card p-5 text-card-foreground shadow-sm max-md:p-4 @md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] @md:gap-8',
        className,
      )}
    >
      <div className="space-y-1">
        <h2 id={titleId} className="flex items-center gap-2 text-sm font-semibold">
          {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />}
          {title}
        </h2>
        {description && <p className="text-[13px] leading-snug text-muted-foreground max-md:[overflow-wrap:anywhere]">{description}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}
