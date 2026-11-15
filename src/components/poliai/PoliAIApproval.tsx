import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getToolMeta, isDestructiveTool, type ToolUseBlock } from '@/lib/poliai';
import { cn } from '@/lib/utils';

interface PoliAIApprovalProps {
  uses: ToolUseBlock[];
  onDecide: (decisions: Record<string, boolean>) => void;
}

// Długie wartości (notatki, opisy, HTML interpelacji) w przewijanym bloku - pełna treść, nic nie
// jest ucinane; licznik znaków mówi wprost, że trzeba przewinąć przed zatwierdzeniem.
const LONG_VALUE = 300;

function InputList({ input }: { input: Record<string, unknown> }) {
  const entries = Object.entries(input).filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (entries.length === 0) return null;
  return (
    <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-lg bg-muted/50 px-2.5 py-2 text-xs">
      {entries.map(([key, value]) => {
        const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
        const long = text.length > LONG_VALUE;
        return (
          <div key={key} className="contents">
            <dt className="font-mono text-muted-foreground">{key}</dt>
            <dd className="min-w-0">
              {long && (
                <span className="mb-1 block text-muted-foreground">
                  Pełna treść ({text.length.toLocaleString('pl-PL')} znaków) - przewiń, aby przeczytać całość
                </span>
              )}
              <div
                className={cn(
                  'whitespace-pre-wrap break-words',
                  long && 'max-h-48 overflow-y-auto rounded-md border bg-background px-2 py-1.5',
                )}
                tabIndex={long ? 0 : undefined}
                aria-label={long ? `${key}: pełna treść` : undefined}
              >
                {text}
              </div>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/**
 * Karta zatwierdzenia operacji zapisu. Przy kilku operacjach każdą można odznaczyć;
 * niezaznaczone trafiają do serwera jako odrzucone.
 */
export function PoliAIApproval({ uses, onDecide }: PoliAIApprovalProps) {
  const [selected, setSelected] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(uses.map((u) => [u.id, true])),
  );
  const multiple = uses.length > 1;
  const destructive = uses.some((u) => selected[u.id] && isDestructiveTool(u.name));
  const anySelected = uses.some((u) => selected[u.id]);

  const decide = (approve: boolean) =>
    onDecide(Object.fromEntries(uses.map((u) => [u.id, approve && selected[u.id] === true])));

  return (
    <div
      role="group"
      aria-label="Operacje do zatwierdzenia"
      className={cn('rounded-xl border bg-card p-3 shadow-sm', destructive ? 'border-destructive/40' : 'border-amber-500/40')}
    >
      <div className="flex items-center gap-2 text-sm font-semibold">
        <ShieldCheck className={cn('h-4 w-4', destructive ? 'text-destructive' : 'text-amber-600')} aria-hidden />
        {multiple ? 'PoliAI chce wykonać operacje' : 'PoliAI chce wykonać operację'}
      </div>
      <ul className="mt-2 space-y-2">
        {uses.map((use) => {
          const { verb, module, Icon } = getToolMeta(use.name);
          return (
            <li key={use.id} className="rounded-lg border px-2.5 py-2">
              <label className={cn('flex items-center gap-2 text-sm', multiple && 'cursor-pointer')}>
                {multiple && (
                  <input
                    type="checkbox"
                    checked={selected[use.id] === true}
                    onChange={(e) => setSelected((s) => ({ ...s, [use.id]: e.target.checked }))}
                    className="h-4 w-4 accent-primary"
                  />
                )}
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className={cn('font-medium', isDestructiveTool(use.name) && 'text-destructive')}>{verb}</span>
                {module && <span className="text-muted-foreground">· {module}</span>}
              </label>
              <InputList input={use.input} />
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => decide(false)}>
          Odrzuć
        </Button>
        <Button
          type="button"
          size="sm"
          variant={destructive ? 'destructive' : 'default'}
          disabled={!anySelected}
          onClick={() => decide(true)}
        >
          {multiple ? 'Zatwierdź zaznaczone' : 'Zatwierdź'}
        </Button>
      </div>
    </div>
  );
}
