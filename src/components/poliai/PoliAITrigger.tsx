import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { usePoliAIPanel } from './PoliAIProvider';
import { POLIAI_SHORTCUT_LABEL } from './constants';

/** Przycisk PoliAI w TopBarze: ikona na mobile, etykieta + skrót na desktopie. */
export function PoliAITrigger() {
  const panel = usePoliAIPanel();
  if (!panel) return null;
  const { open, toggle } = panel;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={toggle}
        aria-pressed={open}
        aria-label="PoliAI"
        className={cn('h-10 w-10 md:hidden max-md:h-[44px] max-md:w-[44px]', open && 'bg-primary/10 text-primary')}
      >
        <Sparkles className="h-5 w-5" />
      </Button>
      <button
        type="button"
        onClick={toggle}
        aria-pressed={open}
        title={`PoliAI (${POLIAI_SHORTCUT_LABEL})`}
        className={cn(
          'group hidden h-8 items-center gap-2 rounded-lg border px-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:flex',
          open
            ? 'border-primary/30 bg-primary/10 text-primary'
            : 'border-primary/15 bg-gradient-to-r from-primary/5 to-brand/5 text-foreground hover:border-primary/30 hover:from-primary/10 hover:to-brand/10',
        )}
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-gradient-to-br from-primary to-brand text-primary-foreground">
          <Sparkles className="h-3 w-3" aria-hidden />
        </span>
        PoliAI
        <kbd className="rounded border bg-card px-1.5 font-sans text-[11px] font-medium text-muted-foreground">
          {POLIAI_SHORTCUT_LABEL}
        </kbd>
      </button>
    </>
  );
}
