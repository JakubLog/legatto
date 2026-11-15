import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

const STEPS = [
  { key: 'upload', label: 'Plik' },
  { key: 'mapping', label: 'Kolumny' },
  { key: 'preview', label: 'Podgląd' },
  { key: 'done', label: 'Gotowe' },
] as const;

export type ImportStep = (typeof STEPS)[number]['key'];

/** Kompaktowy wskaźnik kroków kreatora importu. */
export function ImportStepper({ step }: { step: ImportStep }) {
  const current = STEPS.findIndex(s => s.key === step);
  return (
    <ol className="flex items-center gap-2 text-xs" aria-label="Kroki importu">
      {STEPS.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={s.key} className="flex items-center gap-2" aria-current={active ? 'step' : undefined}>
            {i > 0 && <span aria-hidden className={cn('h-px w-4 sm:w-8', done || active ? 'bg-primary/40' : 'bg-border')} />}
            <span
              className={cn(
                'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold',
                done && 'bg-primary text-primary-foreground',
                active && 'bg-primary/10 text-primary ring-1 ring-primary/40',
                !done && !active && 'bg-muted text-muted-foreground',
              )}
            >
              {done ? <Check className="h-3 w-3" /> : i + 1}
            </span>
            <span className={cn('hidden sm:inline', active ? 'font-medium text-foreground' : 'text-muted-foreground')}>
              {s.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
