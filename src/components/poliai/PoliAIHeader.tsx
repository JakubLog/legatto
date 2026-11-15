import { SquarePen, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PoliAIMark } from './PoliAIMark';
import { PoliAIHistoryMenu } from './PoliAIHistoryMenu';

interface PoliAIHeaderProps {
  conversationId: string | null;
  title: string | null;
  canReset: boolean;
  onReset: () => void;
  onClose: () => void;
  onOpen: (id: string) => void;
}

export function PoliAIHeader({ conversationId, title, canReset, onReset, onClose, onOpen }: PoliAIHeaderProps) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2.5 border-b px-3 md:px-4">
      <PoliAIMark className="h-8 w-8" />
      <div className="min-w-0 flex-1">
        <PoliAIHistoryMenu activeId={conversationId} onOpen={onOpen}>
          <h2 className="truncate text-sm font-semibold">{title ?? 'PoliAI'}</h2>
          <p className="truncate text-xs text-muted-foreground">{title ? 'PoliAI · Asystent biura' : 'Asystent biura'}</p>
        </PoliAIHistoryMenu>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onReset}
        disabled={!canReset}
        className="text-muted-foreground hover:text-foreground max-sm:h-11 max-sm:w-11 max-sm:px-0"
      >
        <SquarePen />
        <span className="max-sm:sr-only">Nowa rozmowa</span>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onClose}
        aria-label="Zamknij PoliAI"
        className="text-muted-foreground hover:text-foreground max-md:h-11 max-md:w-11"
      >
        <X />
      </Button>
    </header>
  );
}
