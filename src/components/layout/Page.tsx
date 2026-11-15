import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PageProps {
  children: ReactNode;
  className?: string;
  /** Wąski układ dla formularzy/ustawień. */
  narrow?: boolean;
}

/** Wspólny kontener strony portalu (/biuro/*): stały padding i szerokość. */
export function Page({ children, className, narrow = false }: PageProps) {
  return (
    <div
      className={cn(
        'mx-auto w-full space-y-5 px-4 py-5 md:px-8 md:py-6',
        narrow ? 'max-w-3xl' : 'max-w-7xl',
        className,
      )}
    >
      {children}
    </div>
  );
}

interface PageHeaderProps {
  title: ReactNode;
  /** Element obok tytułu, poza obcięciem `truncate` (np. odznaka z dymkiem). */
  titleAddon?: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  /** Przyciski akcji po prawej (np. "Dodaj sprawę"). */
  actions?: ReactNode;
  /** Pasek pod nagłówkiem: zakładki widoków, filtry, licznik. */
  toolbar?: ReactNode;
  className?: string;
}

/**
 * Nagłówek strony w stylu ClickUp: ikona + tytuł, opis, akcje, opcjonalny pasek narzędzi.
 * Na telefonie: mniejsza ikona, tytuł i opis oraz większe odstępy między przyciskami.
 */
export function PageHeader({ title, titleAddon, description, icon: Icon, actions, toolbar, className }: PageHeaderProps) {
  return (
    <header className={cn('space-y-4', className)}>
      <div className="flex flex-col gap-3 @sm:flex-row @sm:items-center @sm:justify-between">
        {/* Ikona wyrównana do linii tytułu (wysokość linii = wysokość kafelka), nie do środka bloku z opisem. */}
        <div className="flex min-w-0 items-start gap-2.5 md:gap-3">
          {Icon && (
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary md:h-9 md:w-9">
              <Icon className="h-4 w-4 md:h-[18px] md:w-[18px]" />
            </div>
          )}
          <div className="min-w-0">
            {titleAddon ? (
              <div className="flex min-w-0 items-center gap-2">
                <h1 className="truncate text-lg font-semibold leading-8 tracking-tight md:text-2xl md:leading-9">{title}</h1>
                {titleAddon}
              </div>
            ) : (
              <h1 className="truncate text-lg font-semibold leading-8 tracking-tight md:text-2xl md:leading-9">{title}</h1>
            )}
            {description && <p className="text-xs text-muted-foreground md:text-sm">{description}</p>}
          </div>
        </div>
        {/* @sm:shrink-0: w rzędzie zawija się opis, nie przyciski (np. moduł obok PoliAI). */}
        {actions && <div className="flex flex-wrap items-center gap-3 @sm:shrink-0 md:gap-2">{actions}</div>}
      </div>
      {toolbar && <div className="flex flex-wrap items-center gap-x-2 gap-y-3 border-b pb-3 md:gap-y-2">{toolbar}</div>}
    </header>
  );
}
