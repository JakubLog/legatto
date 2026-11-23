import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { BrandEmblem } from '@/components/common/BrandEmblem';
import { ProductCredit } from '@/components/common/ProductCredit';
import { usePublicSite } from '@/hooks/usePublicSite';

/** Dekoracyjne, rozmyte plamy w kolorach marki (tylko tokeny, niska nieprzezroczystość). */
export function AuthBackdrop({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('pointer-events-none absolute inset-0 -z-10 overflow-hidden', className)}
    >
      <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-primary/10 blur-3xl md:h-96 md:w-96" />
      <div className="absolute -bottom-32 -right-20 h-80 w-80 rounded-full bg-brand/10 blur-3xl md:h-[28rem] md:w-[28rem]" />
      <div className="absolute left-1/2 top-1/3 h-56 w-56 -translate-x-1/2 rounded-full bg-primary/5 blur-3xl" />
    </div>
  );
}

/**
 * Znak marki: godło w zaokrąglonym kwadracie + nazwa portalu + podpis.
 * `subtitle === null` - treść jeszcze się wczytuje: podpis niewidoczny, ale zajmuje miejsce (bez skoku układu).
 */
export function BrandMark({ subtitle }: { subtitle: string | null }) {
  return (
    <div className="flex items-center justify-center gap-3">
      <BrandEmblem className="h-10 w-10 rounded-xl shadow-sm" />
      <span className="text-left leading-tight">
        <span className="block text-base font-semibold tracking-tight text-foreground">Biuro Poselskie</span>
        {subtitle === null ? (
          <span className="invisible block text-xs" aria-hidden="true">
            &nbsp;
          </span>
        ) : (
          subtitle && <span className="block text-xs text-muted-foreground">{subtitle}</span>
        )}
      </span>
    </div>
  );
}

/**
 * Znak marki z podpisem z treści instancji: nazwisko posła, bez nazwiska - tytuł ("Poseł na Sejm RP").
 * Ekrany logowania działają bez sesji, więc dane z GET /api/public-site (anon nie czyta bazy).
 */
function SiteBrandMark() {
  const { data: site, isPending } = usePublicSite();
  const subtitle = isPending ? null : site ? site.identity.mp_name || site.identity.mp_title : '';
  return <BrandMark subtitle={subtitle} />;
}

interface AuthHeaderProps {
  icon?: LucideIcon;
  iconTone?: 'primary' | 'destructive';
  title: ReactNode;
  description?: ReactNode;
  /** Poziom nagłówka; `h2` gdy ekran nakłada się na stronę z własnym `h1`. */
  as?: 'h1' | 'h2';
}

/** Nagłówek karty auth: ikona w miękkim kwadracie, tytuł i opis. */
export function AuthHeader({ icon: Icon, iconTone = 'primary', title, description, as: Heading = 'h1' }: AuthHeaderProps) {
  return (
    <div className="space-y-3 text-center">
      {Icon && (
        <div
          className={cn(
            'mx-auto flex h-12 w-12 items-center justify-center rounded-xl',
            iconTone === 'destructive' ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary',
          )}
        >
          <Icon className="h-6 w-6" aria-hidden="true" />
        </div>
      )}
      <div className="space-y-1.5">
        <Heading className="text-xl font-semibold tracking-tight md:text-2xl">{title}</Heading>
        {description && <p className="text-balance text-sm text-muted-foreground">{description}</p>}
      </div>
    </div>
  );
}

interface AuthLayoutProps {
  children: ReactNode;
  /** Klasy kontenera ekranu (np. `min-h-screen` gdy rodzic nie ma wysokości). */
  className?: string;
  /** Klasy kolumny z treścią (np. szerokość `max-w-xl`). */
  contentClassName?: string;
  /** Treść pod kartą (drobny tekst pomocniczy). */
  footer?: ReactNode;
  showBrand?: boolean;
  /**
   * Stały podpis pod logo zamiast nazwiska z treści instancji. Podany = bez zapytania o treść
   * (np. ekran braku konfiguracji, renderowany poza QueryClientProvider).
   */
  brandSubtitle?: string;
}

/** Wspólny układ ekranów auth: jasne tło z rozmytymi plamami, logo i wyśrodkowana karta. */
export function AuthLayout({
  children,
  className,
  contentClassName,
  footer,
  showBrand = true,
  brandSubtitle,
}: AuthLayoutProps) {
  return (
    <div
      className={cn(
        'relative isolate flex min-h-full w-full items-center justify-center overflow-hidden bg-background px-4 py-10',
        className,
      )}
    >
      <AuthBackdrop />
      <div className={cn('w-full max-w-md space-y-6', contentClassName)}>
        {showBrand && (brandSubtitle === undefined ? <SiteBrandMark /> : <BrandMark subtitle={brandSubtitle} />)}
        <Card className="rounded-2xl p-6 shadow-popover md:p-8">{children}</Card>
        {footer && <div className="text-balance text-center text-xs text-muted-foreground">{footer}</div>}
        <ProductCredit className="text-center text-muted-foreground" />
      </div>
    </div>
  );
}
