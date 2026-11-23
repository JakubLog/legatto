import { useEffect, useMemo, useState } from 'react';
import { eachDayOfInterval, format, isSameMonth, parseISO, startOfDay, startOfMonth } from 'date-fns';
import { pl } from 'date-fns/locale';
import { useSejmSittings, type SejmSitting } from '@/hooks/useSejmSittings';
import { EVENT_TYPE_DOT, EVENT_TYPE_LABELS } from '@/lib/events';
import { cn } from '@/lib/utils';
import type { SiteEvent } from '@/lib/siteSnapshot';
import { SectionHeading } from '@/components/public/SectionHeading';
import { PublicMonthGrid } from '@/components/public/PublicMonthGrid';
import { dayKey, formatTimeRange, locationLabel } from '@/components/public/publicFormat';
import { publicContainer, publicFocus, publicInner, publicSection } from '@/components/public/styles';
import type { PublicSectionLayout } from '@/lib/publicTheme';
import { HOMEPAGE_SECTION_ANCHORS } from '@/lib/siteContent';

const UPCOMING_LIMIT = 4;
/** Górna granica dni zaznaczanych dla jednego wydarzenia wielodniowego. */
const MAX_EVENT_DAYS = 31;

type AgendaItem =
  | { kind: 'event'; id: string; start: Date; event: SiteEvent }
  | { kind: 'sejm'; id: string; start: Date; end: Date; sitting: SejmSitting };

function eventDayKeys(event: SiteEvent): string[] {
  const start = startOfDay(new Date(event.starts_at));
  const end = event.ends_at ? startOfDay(new Date(event.ends_at)) : start;
  if (end <= start) return [dayKey(start)];
  return eachDayOfInterval({ start, end }).slice(0, MAX_EVENT_DAYS).map(dayKey);
}

function sittingRange(start: Date, end: Date): string {
  if (dayKey(start) === dayKey(end)) return format(start, 'EEEE, d MMMM', { locale: pl });
  if (isSameMonth(start, end)) return `${format(start, 'd')}-${format(end, 'd MMMM', { locale: pl })}`;
  return `${format(start, 'd MMMM', { locale: pl })} - ${format(end, 'd MMMM', { locale: pl })}`;
}

/** Wiersz agendy: data po lewej, rodzaj + tytuł + szczegóły po prawej. */
function AgendaRow({ item }: { item: AgendaItem }) {
  const isSejm = item.kind === 'sejm';
  const where = isSejm ? null : locationLabel(item.event);

  return (
    <article className="flex gap-4 py-4">
      <div className="w-11 shrink-0 pt-0.5 text-center">
        <p className="text-[22px] font-bold leading-none tabular-nums">{format(item.start, 'd')}</p>
        <p className="mt-1 text-xs text-muted-foreground">{format(item.start, 'LLL', { locale: pl }).replace(/\.$/, '')}</p>
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <span
            aria-hidden
            className={cn('h-2 w-2 shrink-0 rounded-full', isSejm ? 'bg-foreground' : EVENT_TYPE_DOT[item.event.type])}
          />
          {isSejm ? 'Sejm RP' : EVENT_TYPE_LABELS[item.event.type]}
          {isSejm && item.sitting.current && <span className="font-semibold text-brand">· trwa</span>}
        </p>
        <h4 className="mt-1 font-semibold leading-snug">
          {isSejm
            ? item.sitting.number > 0
              ? `${item.sitting.number}. posiedzenie Sejmu`
              : 'Planowane posiedzenie Sejmu'
            : item.event.title}
        </h4>
        <p className="mt-0.5 text-sm text-muted-foreground first-letter:uppercase">
          {isSejm
            ? sittingRange(item.start, item.end)
            : [format(item.start, 'EEEE', { locale: pl }), formatTimeRange(item.event), where].filter(Boolean).join(' · ')}
        </p>
        {!isSejm && item.event.description && (
          <p className="mt-1.5 line-clamp-2 text-sm text-foreground/80">{item.event.description}</p>
        )}
      </div>
    </article>
  );
}

export interface PublicCalendarSectionProps {
  title: string;
  /** Opcjonalny lead pod tytułem. */
  description?: string;
  /** Siatka miesiąca po lewej (`start`), po prawej (`end`) albo nad agendą w jednej kolumnie (`stacked`). */
  layout: PublicSectionLayout;
  /** Tło sekcji (HomePage naprzemiennie krem/biel wg kolejności sekcji). */
  className?: string;
  /** Publiczne wydarzenia biura z migawki strony (najbliższe, maks. 24). */
  events: SiteEvent[];
  /**
   * Chwila renderowania po stronie serwera (strona statyczna, ISO). Pierwszy render w przeglądarce
   * używa tej samej daty (zgodna hydratacja), po montażu kalendarz przechodzi na bieżącą datę.
   */
  initialNow?: string;
}

const ANCHOR = HOMEPAGE_SECTION_ANCHORS.calendar;

export function PublicCalendarSection({ title, description, layout, className, events, initialNow }: PublicCalendarSectionProps) {
  const sejmQ = useSejmSittings();
  const [now, setNow] = useState(() => (initialNow ? new Date(initialNow) : new Date()));
  const [month, setMonth] = useState(() => startOfMonth(now));
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Strona statyczna: data z builda tylko do hydratacji, potem bieżąca (dziś, miesiąc, najbliższe).
  useEffect(() => {
    if (!initialNow) return;
    const current = new Date();
    setNow(current);
    setMonth(startOfMonth(current));
  }, [initialNow]);

  const { items, eventCounts, sejmByDay } = useMemo(() => {
    const items: AgendaItem[] = [];
    const eventCounts = new Map<string, number>();
    const sejmByDay = new Map<string, AgendaItem>();

    for (const event of events) {
      const item: AgendaItem = { kind: 'event', id: event.id, start: new Date(event.starts_at), event };
      items.push(item);
      for (const key of eventDayKeys(event)) eventCounts.set(key, (eventCounts.get(key) ?? 0) + 1);
    }
    for (const sitting of sejmQ.data ?? []) {
      const start = parseISO(sitting.dates[0]);
      const end = parseISO(sitting.dates[sitting.dates.length - 1]);
      const item: AgendaItem = { kind: 'sejm', id: `sejm-${sitting.dates[0]}`, start, end, sitting };
      items.push(item);
      for (const key of sitting.dates) sejmByDay.set(key, item);
    }
    items.sort((a, b) => a.start.getTime() - b.start.getTime());
    return { items, eventCounts, sejmByDay };
  }, [events, sejmQ.data]);

  const todayKey = dayKey(now);
  const visible = selectedKey
    ? items.filter((item) =>
        item.kind === 'sejm' ? sejmByDay.get(selectedKey) === item : eventDayKeys(item.event).includes(selectedKey),
      )
    : items
        .filter((item) => item.kind === 'event' || dayKey(item.end) >= todayKey)
        .slice(0, UPCOMING_LIMIT);

  const selectDay = (key: string) => {
    if (key === selectedKey) {
      setSelectedKey(null);
      return;
    }
    const day = parseISO(key);
    if (!isSameMonth(day, month)) setMonth(startOfMonth(day));
    setSelectedKey(key);
  };

  return (
    <section id={ANCHOR} aria-labelledby={`${ANCHOR}-title`} className={cn('scroll-mt-20', className, publicSection)}>
      <div className={publicContainer}>
        <div className={cn(publicInner, layout === 'stacked' && 'max-w-3xl')}>
          <SectionHeading
            id={`${ANCHOR}-title`}
            title={title}
            description={description}
            className={cn(layout === 'stacked' && 'mx-auto text-center')}
          />

          <div className={cn('mt-8 grid items-start gap-8', layout !== 'stacked' && 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-12')}>
            <PublicMonthGrid
              className={cn(layout === 'end' && 'lg:order-last')}
              month={month}
              today={now}
              onMonthChange={setMonth}
              selectedKey={selectedKey}
              onSelect={selectDay}
              eventCounts={eventCounts}
              sejmByDay={sejmByDay}
            />

            <div aria-live="polite">
              <div className="flex min-h-10 items-center justify-between gap-3 border-b border-border pb-2">
                <h3 className="text-lg font-bold first-letter:uppercase">
                  {selectedKey ? format(parseISO(selectedKey), 'EEEE, d MMMM', { locale: pl }) : 'Najbliższe'}
                </h3>
                {selectedKey && (
                  <button
                    type="button"
                    onClick={() => setSelectedKey(null)}
                    className={cn(
                      '-mr-2 inline-flex min-h-10 items-center rounded-lg px-2 text-sm font-semibold text-brand hover:underline',
                      publicFocus,
                    )}
                  >
                    Pokaż najbliższe
                  </button>
                )}
              </div>

              {visible.length === 0 ? (
                <p className="py-6 text-sm text-muted-foreground">
                  {selectedKey ? 'Brak publicznych wydarzeń w tym dniu.' : 'Brak zaplanowanych publicznych wydarzeń.'}
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {visible.map((item) => (
                    <li key={item.id}>
                      <AgendaRow item={item} />
                    </li>
                  ))}
                </ul>
              )}
              {sejmQ.isError && (
                <p className="mt-2 text-xs text-muted-foreground">Terminy posiedzeń Sejmu są chwilowo niedostępne.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
