import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * Akcje wiersza listy: na urządzeniach z kursorem pojawiają się po najechaniu,
 * na dotykowych są zawsze widoczne. Rodzic wiersza musi mieć klasę `group`.
 */
export const HOVER_REVEAL =
  'transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100';

/** Kontener kompaktowej listy (wiersze rozdzielone cienką linią). */
export const LIST_PANEL = 'overflow-hidden rounded-xl border bg-card shadow-card divide-y';

/** Wiersz kompaktowej listy w stylu ClickUp. */
export const LIST_ROW = 'group flex min-h-12 items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/60 sm:px-4';

export type PillTone = 'success' | 'warning' | 'danger' | 'info' | 'primary' | 'neutral';

const TONES: Record<PillTone, { pill: string; dot: string }> = {
  success: { pill: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400', dot: 'bg-emerald-500' },
  warning: { pill: 'bg-amber-500/10 text-amber-700 dark:text-amber-400', dot: 'bg-amber-500' },
  danger: { pill: 'bg-destructive/10 text-destructive', dot: 'bg-destructive' },
  info: { pill: 'bg-sky-500/10 text-sky-700 dark:text-sky-400', dot: 'bg-sky-500' },
  primary: { pill: 'bg-primary/10 text-primary', dot: 'bg-primary' },
  neutral: { pill: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground/50' },
};

interface StatusPillProps {
  tone: PillTone;
  children: ReactNode;
  /** Ikona zamiast kropki statusu. */
  icon?: ReactNode;
  dot?: boolean;
  title?: string;
  className?: string;
}

/** Pigułka statusu: kolorowa kropka (lub ikona) + etykieta. */
export function StatusPill({ tone, children, icon, dot = true, title, className }: StatusPillProps) {
  const t = TONES[tone];
  return (
    <span
      title={title}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium leading-4',
        t.pill,
        className,
      )}
    >
      {icon ?? (dot && <span className={cn('h-1.5 w-1.5 rounded-full', t.dot)} aria-hidden />)}
      {children}
    </span>
  );
}

interface EmptyStateProps {
  icon: LucideIcon;
  title: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** Pusty stan: ikona w miękkim kółku, jedna linia tekstu, opcjonalna akcja. */
export function EmptyState({ icon: Icon, title, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center gap-3 px-4 py-10 text-center', className)}>
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-sm text-muted-foreground">{title}</p>
      {action}
    </div>
  );
}

/** Szkielet wierszy listy na czas ładowania. */
export function ListSkeleton({ rows = 3, avatar = false }: { rows?: number; avatar?: boolean }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex min-h-12 items-center gap-3 px-3 py-2.5 sm:px-4">
          {avatar && <Skeleton className="h-8 w-8 shrink-0 rounded-full" />}
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-56 max-w-full" />
          </div>
          <Skeleton className="hidden h-5 w-16 rounded-full @sm:block" />
        </div>
      ))}
    </>
  );
}

interface SettingsCardProps {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  /** Status lub przyciski w prawym górnym rogu. */
  actions?: ReactNode;
  /** Pasek akcji na dole karty (np. "Zapisz"). */
  footer?: ReactNode;
  children?: ReactNode;
  /** Bez wewnętrznego paddingu treści (np. dla list). */
  flush?: boolean;
  className?: string;
}

/** Karta ustawień: nagłówek z ikoną, treść, opcjonalna stopka z akcjami. */
export function SettingsCard({
  icon: Icon,
  title,
  description,
  actions,
  footer,
  children,
  flush = false,
  className,
}: SettingsCardProps) {
  return (
    <Card className={cn('overflow-hidden rounded-xl', className)}>
      <div className="flex flex-col gap-3 p-4 @sm:flex-row @sm:items-start @sm:justify-between sm:p-5">
        <div className="flex min-w-0 items-start gap-3">
          {Icon && (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Icon className="h-[18px] w-[18px]" />
            </div>
          )}
          <div className="min-w-0 space-y-0.5">
            <h2 className="text-sm font-semibold leading-9 @sm:leading-normal">{title}</h2>
            {description && <p className="text-[13px] text-muted-foreground">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children && <div className={cn('border-t', !flush && 'p-4 sm:p-5')}>{children}</div>}
      {footer && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t bg-muted/30 px-4 py-3 sm:px-5">
          {footer}
        </div>
      )}
    </Card>
  );
}

/** Blok kodu / JSON w zaokrąglonej ramce. */
export function CodeBlock({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <pre
      className={cn(
        'overflow-x-auto whitespace-pre rounded-lg border bg-muted/50 px-3 py-2.5 font-mono text-xs leading-relaxed text-foreground',
        className,
      )}
    >
      {children}
    </pre>
  );
}

/** Komunikat błędu ładowania danych. */
export function ErrorNotice({ title, message }: { title: ReactNode; message?: ReactNode }) {
  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
      <p className="font-medium">{title}</p>
      {message && <p className="mt-1 text-xs opacity-80">{message}</p>}
    </div>
  );
}

/** Ikona ostrzeżenia w miękkim kółku dla tytułów dialogów potwierdzenia. */
export function DangerTitleIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
      <Icon className="h-[18px] w-[18px]" />
    </span>
  );
}

/** Szkielet karty ustawień na czas ładowania konfiguracji. */
export function SettingsCardSkeleton({ label, fields = 3 }: { label: string; fields?: number }) {
  return (
    <Card className="space-y-5 p-4 sm:p-5" aria-busy="true">
      <span className="sr-only">{label}</span>
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-9 rounded-lg" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-64 max-w-full" />
        </div>
      </div>
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-9 w-full rounded-lg" />
        </div>
      ))}
    </Card>
  );
}
