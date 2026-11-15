import { useEffect, useState } from 'react';
import type { PulseLevel } from '@/integrations/supabase/types';
import { cn } from '@/lib/utils';

const LEVEL_SCORE: Record<PulseLevel, number> = { ok: 100, warning: 50, critical: 0 };

type OfficeState = 'good' | 'attention' | 'critical';

const STATE: Record<OfficeState, { label: string; text: string; glow: string; beatSeconds: number }> = {
  good: { label: 'Dobry', text: 'text-emerald-500', glow: 'bg-emerald-500', beatSeconds: 2.4 },
  attention: { label: 'Wymaga uwagi', text: 'text-amber-500', glow: 'bg-amber-500', beatSeconds: 1.6 },
  critical: { label: 'Krytyczny', text: 'text-red-500', glow: 'bg-red-500', beatSeconds: 0.9 },
};

const COUNT_ITEMS: { level: PulseLevel; label: string; dot: string }[] = [
  { level: 'ok', label: 'w normie', dot: 'bg-emerald-500' },
  { level: 'warning', label: 'osłabienie działań', dot: 'bg-amber-500' },
  { level: 'critical', label: 'bardzo duży spadek', dot: 'bg-red-500' },
];

/** Dwa uderzenia serca w EKG (viewBox 300x80, linia bazowa y=40). */
const ECG_PATH =
  'M0 40 H40 l6 -6 l6 6 H70 l4 8 l8 -34 l8 40 l6 -14 H120 q8 -12 16 0 H150 ' +
  'H190 l6 -6 l6 6 H220 l4 8 l8 -34 l8 40 l6 -14 H270 q8 -12 16 0 H300';

const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Licznik od 0 do `target` (ease-out); bez animacji przy prefers-reduced-motion. */
function useCountUp(target: number, durationMs = 1200): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setValue(target);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / durationMs, 1);
      setValue(target * (1 - (1 - t) ** 3));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs]);
  return value;
}

interface Props {
  /** Poziomy obszarów, dla których jest sygnał. */
  levels: PulseLevel[];
  loading: boolean;
  /** Nagłówek nad stanem (domyślnie "Stan biura"; dla osoby np. "Obszary: Jan Kowalski"). */
  caption?: string;
}

/** Hero Pulsu Biura: animowany wskaźnik 0-100, linia EKG i liczniki obszarów. */
export function PulseGauge({ levels, loading, caption = 'Stan biura' }: Props) {
  const total = levels.length;
  const score = total > 0 ? Math.round(levels.reduce((sum, l) => sum + LEVEL_SCORE[l], 0) / total) : 0;
  const state: OfficeState = score >= 80 ? 'good' : score >= 50 ? 'attention' : 'critical';
  const s = STATE[state];
  const ready = !loading && total > 0;
  const shown = useCountUp(ready ? score : 0);
  const attention = levels.filter((l) => l !== 'ok').length;

  return (
    <section
      aria-label="Puls biura"
      className="relative overflow-hidden rounded-2xl border bg-card p-5 shadow-card @sm:p-6"
    >
      <div
        className={cn('pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full opacity-15 blur-3xl', s.glow)}
        aria-hidden
      />

      <div className="relative flex flex-col items-center gap-6 @sm:flex-row @sm:items-center">
        <div className="relative h-40 w-40 shrink-0">
          <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden>
            <circle cx="60" cy="60" r={RADIUS} fill="none" strokeWidth="10" className="stroke-muted" />
            <circle
              cx="60"
              cy="60"
              r={RADIUS}
              fill="none"
              stroke="currentColor"
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={CIRCUMFERENCE * (1 - shown / 100)}
              className={cn(s.text, 'drop-shadow-[0_0_6px_currentColor]')}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-4xl font-bold tabular-nums tracking-tight">{ready ? Math.round(shown) : '–'}</span>
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">puls / 100</span>
          </div>
        </div>

        <div className="w-full min-w-0 flex-1 space-y-3">
          <div>
            <p className="truncate text-xs font-medium uppercase tracking-wider text-muted-foreground">{caption}</p>
            <p className={cn('text-2xl font-semibold tracking-tight', ready ? s.text : 'text-muted-foreground')}>
              {ready ? s.label : 'Liczenie sygnałów...'}
            </p>
            {ready && (
              <p className="text-sm text-muted-foreground">
                {attention === 0
                  ? 'Wszystkie obszary w normie'
                  : `${attention} z ${total} obszarów wymaga uwagi`}
              </p>
            )}
          </div>

          <svg viewBox="0 0 300 80" preserveAspectRatio="none" className={cn('h-14 w-full', s.text)} aria-hidden>
            <path d={ECG_PATH} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.18" vectorEffect="non-scaling-stroke" />
            {ready && (
              <path
                d={ECG_PATH}
                pathLength={1}
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray="0.3 1"
                vectorEffect="non-scaling-stroke"
                className="drop-shadow-[0_0_4px_currentColor] motion-reduce:hidden"
                style={{ animation: `pulse-sweep ${s.beatSeconds}s linear infinite` }}
              />
            )}
          </svg>

          <div className="flex flex-wrap gap-2">
            {COUNT_ITEMS.map((item) => (
              <CountChip
                key={item.level}
                value={ready ? levels.filter((l) => l === item.level).length : 0}
                label={item.label}
                dot={item.dot}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function CountChip({ value, label, dot }: { value: number; label: string; dot: string }) {
  const shown = useCountUp(value, 900);
  return (
    <span className="inline-flex items-center gap-2 rounded-full border bg-background/60 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
      <span className={cn('h-2 w-2 rounded-full', dot, value > 0 && 'animate-pulse')} aria-hidden />
      <span className="text-sm font-semibold tabular-nums text-foreground">{Math.round(shown)}</span>
      {label}
    </span>
  );
}
