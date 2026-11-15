import { useEffect, useState } from 'react';
import { ChevronDown, Workflow } from 'lucide-react';
import type { ProcessItem } from '@/lib/poliai';
import { cn } from '@/lib/utils';
import { PulsingDots } from './PoliAIMark';
import { ThinkingItem, ToolItem } from './PoliAIProcessItems';

function pluralTools(n: number): string {
  if (n === 1) return '1 narzędzie';
  const lastTwo = n % 100;
  const last = n % 10;
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return `${n} narzędzia`;
  return `${n} narzędzi`;
}

function summary(items: ProcessItem[]): string {
  const tools = items.filter((i) => i.kind === 'tool').length;
  const thought = items.some((i) => i.kind !== 'tool');
  const parts = [thought ? 'Przemyślano' : 'Sprawdzono', tools > 0 ? pluralTools(tools) : null];
  return parts.filter(Boolean).join(' · ');
}

/**
 * Kafelek pracy: myślenie i wywołania narzędzi. Jedyny loader dla tej fazy odpowiedzi - gdy tura
 * trwa i nie ma jeszcze żadnego kroku, sam jest animowanym „Pracuję…”. Rozwinięty, gdy tura trwa;
 * po jej zakończeniu zwija się do jednej linii (użytkownik może go rozwinąć).
 */
export function PoliAIProcess({ items, live }: { items: ProcessItem[]; live: boolean }) {
  const [expanded, setExpanded] = useState(live);

  useEffect(() => {
    setExpanded(live);
  }, [live]);

  if (items.length === 0 && !live) return null;

  return (
    <div className="rounded-xl border bg-muted/30">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        disabled={items.length === 0}
        aria-expanded={items.length > 0 ? expanded : undefined}
        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-medium text-muted-foreground transition-colors enabled:hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Workflow className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="flex-1">{live ? 'Pracuję' : summary(items)}</span>
        {live && <PulsingDots className="text-primary" />}
        {items.length > 0 && (
          <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 transition-transform', expanded && 'rotate-180')} aria-hidden />
        )}
      </button>
      {expanded && items.length > 0 && (
        <ol className="space-y-0.5 px-2 pb-2">
          {items.map((item) =>
            item.kind === 'tool' ? (
              <ToolItem key={item.key} item={item} />
            ) : (
              <ThinkingItem key={item.key} text={item.kind === 'thinking' ? item.text : ''} live={item.kind === 'thinking' && item.live} />
            ),
          )}
        </ol>
      )}
    </div>
  );
}
