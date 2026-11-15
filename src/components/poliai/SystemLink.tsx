import type { ReactNode } from 'react';
import { Link2, type LucideIcon } from 'lucide-react';
import { ALL_NAV_ITEMS, getRouteTitle } from '@/components/layout/navigation';
import { cn } from '@/lib/utils';

/** Ikona sekcji, do której prowadzi link: dokładna trasa, potem najdłuższy pasujący prefiks z nawigacji. */
function sectionIcon(href: string): LucideIcon {
  const path = href.split(/[?#]/)[0];
  const exact = getRouteTitle(path);
  if (exact) return exact.Icon;
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // niepoprawne kodowanie - porównujemy surową ścieżkę
  }
  const prefix = ALL_NAV_ITEMS.filter((item) => item.to !== '/biuro' && decoded.startsWith(`${item.to}/`)).sort(
    (a, b) => b.to.length - a.to.length,
  )[0];
  return prefix?.Icon ?? Link2;
}

interface SystemLinkProps {
  href: string;
  /** Link otwiera zdanie - bez odstępu z lewej. */
  sentenceStart: boolean;
  onNavigate: (href: string) => void;
  children: ReactNode;
}

/** Wzmianka o miejscu w systemie: ikona sekcji + tekst, po najechaniu podświetla się jak pastylka. */
export function SystemLink({ href, sentenceStart, onNavigate, children }: SystemLinkProps) {
  const Icon = sectionIcon(href);
  return (
    <a
      href={href}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        onNavigate(href);
      }}
      // Inline (nie flex): tekst zostaje na linii bazowej zdania, ikona 1em z przesunięciem -0.125em
      // siada na środku wysokości liter; box-decoration-clone zachowuje pastylkę przy zawijaniu.
      className={cn(
        'rounded-md px-1 py-0.5 font-medium text-brand transition-colors [box-decoration-break:clone] hover:bg-brand/10 focus-visible:bg-brand/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30',
        sentenceStart ? 'mr-1' : 'mx-1',
      )}
    >
      <Icon className="mr-1 inline-block h-[1em] w-[1em] align-[-0.125em]" aria-hidden />
      {children}
    </a>
  );
}
