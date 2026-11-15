import { Briefcase, Map as MapIcon, MapPin, MoreHorizontal, User as UserIcon } from 'lucide-react';
import { CreatorAvatar } from '@/components/common/CreatorAvatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EVENT_TYPE_DOT } from '@/lib/events';
import type { CalendarEventWithRelations } from '@/integrations/supabase/types';
import { cn } from '@/lib/utils';
import { EventTypePill } from './EventTypePill';
import { formatEventTime } from './eventFormat';

interface Props {
  event: CalendarEventWithRelations;
  writer: boolean;
  admin: boolean;
  onEdit: (e: CalendarEventWithRelations) => void;
  onDelete: (e: CalendarEventWithRelations) => void;
}

/** Kompaktowy wiersz wydarzenia w stylu ClickUp: godzina, kropka typu, tytuł, meta, akcje. */
export function EventRow({ event: e, writer, admin, onEdit, onDelete }: Props) {
  const hasMeta = Boolean(e.location || e.powiat || e.case || e.contact);

  return (
    <li className="group flex items-center gap-2 pr-1.5 transition-colors hover:bg-muted/60 md:gap-1">
      <button
        type="button"
        onClick={() => onEdit(e)}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-3 py-2 pl-3 text-left outline-none focus-visible:bg-muted/60"
      >
        <span className="w-[5.5rem] shrink-0 text-xs tabular-nums text-muted-foreground">
          {formatEventTime(e.starts_at, e.ends_at, e.all_day)}
        </span>
        <span className={cn('h-2 w-2 shrink-0 rounded-full', EVENT_TYPE_DOT[e.type])} aria-hidden />
        <span className="min-w-0 flex-1">
          {/* Wąski obszar modułu: tytuł w dwóch liniach zamiast ucinania po kilku słowach. */}
          <span
            className="block truncate text-sm font-medium @max-md:line-clamp-2 @max-md:whitespace-normal @max-md:break-words"
            title={e.title}
          >
            {e.title}
          </span>
          {hasMeta && (
            <span className="mt-0.5 flex min-w-0 items-center gap-3 overflow-hidden text-xs text-muted-foreground">
              {e.location && (
                <span className="inline-flex min-w-0 items-center gap-1">
                  <MapPin className="h-3 w-3 shrink-0" aria-hidden />
                  <span className="truncate">{e.location}</span>
                </span>
              )}
              {e.powiat && (
                <span className="hidden min-w-0 items-center gap-1 @md:inline-flex">
                  <MapIcon className="h-3 w-3 shrink-0" aria-hidden />
                  <span className="truncate">{e.powiat.name}</span>
                </span>
              )}
              {e.case && (
                <span className="hidden min-w-0 items-center gap-1 @md:inline-flex">
                  <Briefcase className="h-3 w-3 shrink-0" aria-hidden />
                  <span className="truncate">Sprawa: {e.case.title}</span>
                </span>
              )}
              {e.contact && (
                <span className="hidden min-w-0 items-center gap-1 @md:inline-flex">
                  <UserIcon className="h-3 w-3 shrink-0" aria-hidden />
                  <span className="truncate">
                    {e.contact.first_name} {e.contact.last_name}
                  </span>
                </span>
              )}
            </span>
          )}
        </span>
        <EventTypePill type={e.type} className="hidden @md:inline-flex" />
        {e.assigned && (
          <span className="shrink-0 @max-md:hidden">
            <CreatorAvatar name={e.assigned.full_name} avatarUrl={e.assigned.avatar_url} />
            <span className="sr-only">Odpowiedzialny: {e.assigned.full_name}</span>
          </span>
        )}
      </button>

      {(writer || admin) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0 text-muted-foreground transition-opacity hover:text-foreground [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100 [@media(hover:hover)]:data-[state=open]:opacity-100"
              aria-label="Opcje"
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            {writer && <DropdownMenuItem onClick={() => onEdit(e)}>Edytuj</DropdownMenuItem>}
            {admin && (
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => onDelete(e)}
              >
                Usuń
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}
