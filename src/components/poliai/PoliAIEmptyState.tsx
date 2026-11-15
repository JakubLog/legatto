import { useLocation } from 'react-router-dom';
import {
  Activity,
  CalendarClock,
  CalendarDays,
  FileText,
  ListTodo,
  NotebookPen,
  UserPlus,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { PoliAIMark } from './PoliAIMark';

interface Starter {
  prompt: string;
  Icon: LucideIcon;
}

const ROUTE_STARTERS: [prefix: string, starters: Starter[]][] = [
  ['/biuro/sprawy', [{ prompt: 'Podsumuj otwarte sprawy i wskaż przeterminowane', Icon: ListTodo }]],
  ['/biuro/kalendarz', [{ prompt: 'Co mam w kalendarzu w tym tygodniu?', Icon: CalendarDays }]],
  ['/biuro/interpelacje', [{ prompt: 'Pokaż interpelacje czekające na decyzję', Icon: FileText }]],
  ['/biuro/kontakty', [{ prompt: 'Kogo ostatnio dodaliśmy do kontaktów?', Icon: UserPlus }]],
  ['/biuro/budzet', [{ prompt: 'Ile wydaliśmy w tym miesiącu i na co?', Icon: Wallet }]],
  ['/biuro/puls', [{ prompt: 'Które obszary biura wymagają uwagi?', Icon: Activity }]],
];

const GENERIC_STARTERS: Starter[] = [
  { prompt: 'Co mam dziś do zrobienia?', Icon: ListTodo },
  { prompt: 'Przygotuj podsumowanie tygodnia biura', Icon: NotebookPen },
  { prompt: 'Jakie terminy zbliżają się w najbliższych dniach?', Icon: CalendarClock },
];

function startersFor(pathname: string): Starter[] {
  const routeSpecific = ROUTE_STARTERS.find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? [];
  return [...routeSpecific, ...GENERIC_STARTERS].slice(0, 4);
}

/**
 * Ekran startowy rozmowy: znak PoliAI z miękkim, barwnym cieniem i powitanie na tle panelu,
 * pod spodem propozycje pierwszych pytań zależne od ekranu - pastylki w kolumnie.
 */
export function PoliAIEmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  const { profile } = useAuth();
  const { pathname } = useLocation();
  const firstName = profile?.full_name.split(' ')[0] ?? '';

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-5 py-10 md:px-10">
      <div className="w-full max-w-xl text-center">
        <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-700">
          <PoliAIMark
            animated
            className="mx-auto h-16 w-16 rounded-2xl shadow-[0_14px_32px_-10px_hsl(var(--brand)/0.5),0_6px_14px_-6px_hsl(var(--primary)/0.45)] ring-1 ring-white/20"
            iconClassName="h-7 w-7"
          />
        </div>
        <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:fill-mode-both motion-safe:delay-150 motion-safe:duration-700">
          <h3 className="mt-6 text-xl font-semibold tracking-tight">Cześć{firstName ? `, ${firstName}` : ''}!</h3>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            Jestem PoliAI. Przeszukam sprawy, kontakty, kalendarz, interpelacje i budżet biura, podsumuję je
            i przygotuję kolejne kroki. Zmiany w systemie wykonam dopiero po Twoim zatwierdzeniu.
          </p>
        </div>

        {/* Telefon: propozycje jako lista na całą szerokość (długie pytania zawijały się w owalnych pastylkach). */}
        <div className="mt-8 flex flex-col items-center gap-2 max-md:items-stretch">
          {startersFor(pathname).map(({ prompt, Icon }, i) => (
            <button
              key={prompt}
              type="button"
              onClick={() => onPick(prompt)}
              style={{ animationDelay: `${300 + i * 80}ms` }}
              className="group inline-flex w-fit max-w-full items-center gap-2 rounded-full border bg-card px-3.5 py-1.5 text-left text-sm shadow-sm transition-colors hover:border-primary/30 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:fill-mode-both motion-safe:duration-500 max-md:min-h-11 max-md:w-full max-md:rounded-xl max-md:px-4 max-md:py-2.5"
            >
              <Icon
                className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
                aria-hidden
              />
              <span>{prompt}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
