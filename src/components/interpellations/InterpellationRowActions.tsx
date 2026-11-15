import { useNavigate } from 'react-router-dom';
import { Eye, MoreHorizontal, Send, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { InterpellationListItem } from '@/integrations/supabase/types';

interface Props {
  item: InterpellationListItem;
  writer: boolean;
  admin: boolean;
  onMarkSent: (i: InterpellationListItem) => void;
  onDelete: (i: InterpellationListItem) => void;
}

/** Akcje wiersza: na desktopie odsłaniane po najechaniu, na dotyku zawsze widoczne. */
export function InterpellationRowActions({ item, writer, admin, onMarkSent, onDelete }: Props) {
  const navigate = useNavigate();
  const sendable = writer && item.status === 'zaakceptowana';

  if (!writer && !admin) return null;

  return (
    <div className="flex shrink-0 items-center gap-2 transition-opacity md:gap-0.5 md:opacity-0 md:focus-within:opacity-100 md:group-hover:opacity-100 md:has-[[data-state=open]]:opacity-100">
      {sendable && (
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground md:h-8 md:w-8"
          onClick={() => onMarkSent(item)}
          aria-label="Oznacz jako wysłaną"
          title="Oznacz jako wysłaną"
        >
          <Send />
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground md:h-8 md:w-8"
            aria-label="Opcje"
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onClick={() => navigate(`/biuro/interpelacje/${item.id}`)}>
            <Eye />
            Otwórz
          </DropdownMenuItem>
          {sendable && (
            <DropdownMenuItem onClick={() => onMarkSent(item)}>
              <Send />
              Oznacz jako wysłaną
            </DropdownMenuItem>
          )}
          {admin && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => onDelete(item)}
              >
                <Trash2 />
                Usuń
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
