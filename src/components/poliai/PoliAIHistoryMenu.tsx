import type { ReactNode } from 'react';
import { ChevronDown, MessageSquareText, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import {
  deletePoliAIConversation,
  POLIAI_CONVERSATIONS_KEY,
  usePoliAIConversations,
} from '@/hooks/usePoliAIConversations';

interface PoliAIHistoryMenuProps {
  activeId: string | null;
  onOpen: (id: string) => void;
  /** Tytuł bieżącej rozmowy (albo „PoliAI”, zanim go ustalimy) i stały podpis pod nim. */
  children: ReactNode;
}

/** Nagłówek rozmowy - gdy są wcześniejsze rozmowy (90 dni), klik rozwija ich listę. */
export function PoliAIHistoryMenu({ activeId, onOpen, children }: PoliAIHistoryMenuProps) {
  const queryClient = useQueryClient();
  const conversationsQ = usePoliAIConversations(true);
  const conversations = conversationsQ.data ?? [];
  const hasHistory = conversations.length > 0;

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      await deletePoliAIConversation(id);
      void queryClient.invalidateQueries({ queryKey: POLIAI_CONVERSATIONS_KEY });
      if (id === activeId) onOpen('');
    } catch {
      toast.error('Nie udało się usunąć rozmowy.');
    }
  };

  return (
    <DropdownMenu>
      {/* Strzałka tuż przy tytule: przycisk ma szerokość treści (max cała dostępna), nie całego wiersza. */}
      <DropdownMenuTrigger asChild disabled={!hasHistory}>
        <button
          type="button"
          disabled={!hasHistory}
          className="group flex w-fit min-w-0 max-w-full items-center gap-1 rounded-md text-left leading-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
        >
          <span className="min-w-0">{children}</span>
          {hasHistory && (
            <ChevronDown
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
              aria-hidden
            />
          )}
        </button>
      </DropdownMenuTrigger>
      {hasHistory && (
        <DropdownMenuContent align="start" className="max-h-80 w-72 overflow-y-auto">
          {conversations.map((c) => (
            <DropdownMenuItem
              key={c.id}
              onSelect={() => onOpen(c.id)}
              className={cn('group justify-between gap-2', c.id === activeId && 'bg-accent')}
            >
              <span className="flex min-w-0 items-center gap-2">
                <MessageSquareText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">{c.title ?? 'Nowa rozmowa'}</span>
              </span>
              <button
                type="button"
                onClick={(e) => void handleDelete(e, c.id)}
                aria-label="Usuń rozmowę"
                className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <p className="px-2 py-1.5 text-[11px] text-muted-foreground">Rozmowy przechowujemy 90 dni.</p>
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  );
}
