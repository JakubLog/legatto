import { useState } from 'react';
import { useSmoothText } from '@/hooks/useSmoothText';
import { Brain, Check, ChevronRight, CircleDashed, CircleMinus, Hand, X } from 'lucide-react';
import { formatToolResult, getToolMeta, stringifyValue, truncate, type ProcessItem, type ToolStatus } from '@/lib/poliai';
import { cn } from '@/lib/utils';
import { PulsingDots } from './PoliAIMark';

type ToolProcessItem = Extract<ProcessItem, { kind: 'tool' }>;

const STATUS_LABEL: Record<ToolStatus, string> = {
  running: 'w toku',
  queued: 'w kolejce',
  done: 'gotowe',
  error: 'błąd',
  awaiting_approval: 'czeka na zatwierdzenie',
  skipped: 'pominięto',
};

function StatusIcon({ status }: { status: ToolStatus }) {
  switch (status) {
    case 'running':
      return <PulsingDots className="text-primary" />;
    case 'queued':
      return <CircleDashed className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />;
    case 'done':
      return <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden />;
    case 'error':
      return <X className="h-3.5 w-3.5 text-destructive" aria-hidden />;
    case 'awaiting_approval':
      return <Hand className="h-3.5 w-3.5 text-amber-600" aria-hidden />;
    case 'skipped':
      return <CircleMinus className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />;
  }
}

/** Krótkie argumenty wywołania jako „klucz: wartość” (bez długich tekstów). */
function argChips(input: Record<string, unknown> | null): string[] {
  if (!input) return [];
  return Object.entries(input)
    .filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object')
    .map(([k, v]) => `${k}: ${truncate(stringifyValue(v), 32)}`)
    .slice(0, 3);
}

export function ToolItem({ item }: { item: ToolProcessItem }) {
  const [open, setOpen] = useState(false);
  const { verb, module, Icon } = getToolMeta(item.name);
  const chips = argChips(item.input);
  const canExpand = Boolean(item.result);

  return (
    <li>
      <button
        type="button"
        disabled={!canExpand}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={canExpand ? open : undefined}
        className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left text-xs transition-colors enabled:hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border bg-card text-muted-foreground">
          <Icon className="h-3.5 w-3.5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="font-medium text-foreground">{verb}</span>
          {module && <span className="text-muted-foreground"> · {module}</span>}
          {chips.length > 0 && (
            <span className="ml-1.5 inline-flex flex-wrap gap-1 align-middle">
              {chips.map((chip) => (
                <span key={chip} className="rounded bg-muted px-1.5 py-px font-mono text-[10.5px] text-muted-foreground">
                  {chip}
                </span>
              ))}
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1.5" title={STATUS_LABEL[item.status]}>
          <span className="sr-only">{STATUS_LABEL[item.status]}</span>
          <StatusIcon status={item.status} />
          {canExpand && (
            <ChevronRight className={cn('h-3 w-3 text-muted-foreground transition-transform', open && 'rotate-90')} aria-hidden />
          )}
        </span>
      </button>
      {open && item.result && (
        <pre className="ml-8 mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-card p-2.5 font-mono text-[11px] leading-relaxed text-muted-foreground">
          {formatToolResult(item.result.content)}
        </pre>
      )}
    </li>
  );
}

export function ThinkingItem({ text, live }: { text: string; live: boolean }) {
  const [open, setOpen] = useState(false);
  const shown = useSmoothText(text, live);
  const showText = live || open;

  return (
    <li>
      <button
        type="button"
        disabled={live || !text}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={text && !live ? open : undefined}
        className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left text-xs transition-colors enabled:hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border bg-card text-primary">
          <Brain className="h-3.5 w-3.5" aria-hidden />
        </span>
        <span className="flex-1 font-medium text-foreground">{live ? 'Myślę' : 'Proces myślenia'}</span>
        {live ? (
          <PulsingDots className="text-primary" />
        ) : (
          text && <ChevronRight className={cn('h-3 w-3 text-muted-foreground transition-transform', open && 'rotate-90')} aria-hidden />
        )}
      </button>
      {showText && text && (
        <p
          className={cn(
            'ml-8 mt-0.5 whitespace-pre-wrap border-l-2 border-primary/20 pl-2.5 text-xs leading-relaxed text-muted-foreground',
            live && 'max-h-40 overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,black_2.5rem)] [display:flex] [flex-direction:column-reverse]',
          )}
        >
          {shown}
        </p>
      )}
    </li>
  );
}
