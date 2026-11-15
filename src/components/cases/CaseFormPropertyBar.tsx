import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { format } from 'date-fns';
import { pl } from 'date-fns/locale';
import { CalendarIcon, ChevronDown, MapPin, Plus, X } from 'lucide-react';

import { Label } from '@/components/ui/label';
import { SearchSelect } from '@/components/ui/search-select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MiniCalendar } from '@/components/ui/mini-calendar';
import { CreatorAvatar } from '@/components/common/CreatorAvatar';
import { usePowiaty } from '@/hooks/usePowiaty';
import { useGminy } from '@/hooks/useGminy';
import { useAssignableUsers } from '@/hooks/useUsers';
import { useAuth } from '@/contexts/AuthContext';
import { groupUsersByOffice } from '@/lib/assignableUsers.utils';
import { cn } from '@/lib/utils';
import type { CaseFormValues } from './caseFormSchema';

interface Props {
  form: UseFormReturn<CaseFormValues>;
  locationOpen: boolean;
  onLocationOpenChange: (open: boolean) => void;
}

// max-md: wyższe pigułki na telefonie, długie nazwy obcinane zamiast rozpychać arkusz.
const CHIP =
  'inline-flex h-8 items-center gap-1.5 rounded-full border border-input bg-card px-3 text-xs font-medium shadow-sm transition-colors hover:bg-accent max-md:h-10 max-md:min-w-0 max-md:max-w-full max-md:text-sm';

/** Pasek właściwości sprawy (przypisanie, termin, lokalizacja) w formie pigułek. */
export function CaseFormPropertyBar({ form, locationOpen, onLocationOpenChange }: Props) {
  const { data: powiaty } = usePowiaty();
  const { data: users } = useAssignableUsers();
  const { profile } = useAuth();
  const userGroups = useMemo(
    () => groupUsersByOffice(users ?? [], profile?.office_id),
    [users, profile?.office_id],
  );
  const dueDatePopoverRef = useRef<HTMLDivElement>(null);
  const [dueDateOpen, setDueDateOpen] = useState(false);

  const assignedTo = form.watch('assigned_to');
  const dueDate = form.watch('due_date');
  const powiatId = form.watch('powiat_id');
  const gminaId = form.watch('gmina_id');
  const { data: gminy } = useGminy(powiatId ?? null);

  const assignedUser = users?.find((u) => u.id === assignedTo) ?? null;
  const selectedPowiat = powiaty?.find((p) => p.id === powiatId) ?? null;
  const selectedGmina = gminy?.find((g) => g.id === gminaId) ?? null;
  const errors = form.formState.errors;

  useEffect(() => {
    if (!dueDateOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (
        dueDatePopoverRef.current &&
        !dueDatePopoverRef.current.contains(e.target as Node)
      ) {
        setDueDateOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDueDateOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [dueDateOpen]);

  const clearDueDate = () => {
    form.setValue('due_date', '', { shouldValidate: true });
    setDueDateOpen(false);
  };

  return (
    <div className="space-y-3">
      {/* Telefon: kalendarz terminu pozycjonowany względem całego paska (od lewej krawędzi), żeby nie wychodził poza ekran. */}
      <div className="flex flex-wrap items-center gap-2 max-md:relative max-md:gap-3">
        {/* Przypisanie */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(CHIP, 'pl-1.5', errors.assigned_to && 'border-destructive text-destructive')}
            >
              {assignedUser ? (
                <>
                  <CreatorAvatar
                    name={assignedUser.full_name}
                    avatarUrl={assignedUser.avatar_url}
                    className="h-5 w-5"
                    fallbackClassName="text-[8px]"
                  />
                  <span className="max-md:truncate">{assignedUser.full_name}</span>
                </>
              ) : (
                <>
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-muted-foreground/50 text-muted-foreground">
                    <Plus className="h-3 w-3" />
                  </span>
                  <span className="text-muted-foreground">Przypisz osobę</span>
                </>
              )}
              <ChevronDown className="h-3.5 w-3.5 opacity-60 max-md:shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
            {userGroups.map((g, i) => (
              <Fragment key={g.key}>
                {i > 0 && <DropdownMenuSeparator />}
                <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
                  {g.label}
                </DropdownMenuLabel>
                {g.users.map((u) => (
                  <DropdownMenuItem
                    key={u.id}
                    onClick={() => form.setValue('assigned_to', u.id, { shouldValidate: true })}
                  >
                    <CreatorAvatar name={u.full_name} avatarUrl={u.avatar_url} className="mr-2" />
                    {u.full_name}
                  </DropdownMenuItem>
                ))}
              </Fragment>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Termin (chip + popover z MiniCalendar) */}
        <div ref={dueDatePopoverRef} className="relative inline-flex items-center max-md:static">
          <button
            type="button"
            className={cn(
              CHIP,
              dueDate && 'rounded-r-none border-r-0',
              errors.due_date && 'border-destructive text-destructive',
            )}
            onClick={() => setDueDateOpen((v) => !v)}
            aria-expanded={dueDateOpen}
          >
            <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
            {dueDate ? (
              <span>{format(new Date(dueDate), 'd MMM yyyy', { locale: pl })}</span>
            ) : (
              <span className="text-muted-foreground">Termin</span>
            )}
          </button>
          {dueDate && (
            <button
              type="button"
              className="inline-flex h-8 items-center justify-center rounded-r-full border border-l-0 border-input bg-card px-2 shadow-sm hover:bg-accent max-md:h-10 max-md:px-3"
              onClick={clearDueDate}
              aria-label="Wyczyść termin"
            >
              <X className="h-3 w-3" />
            </button>
          )}

          {dueDateOpen && (
            <div className="absolute left-0 top-full z-50 mt-1 rounded-lg border bg-popover text-popover-foreground shadow-popover">
              <MiniCalendar
                value={dueDate}
                onChange={(date) => {
                  form.setValue('due_date', date, { shouldValidate: true });
                  setDueDateOpen(false);
                }}
                onClear={dueDate ? clearDueDate : undefined}
              />
            </div>
          )}
        </div>

        {/* Lokalizacja - toggle */}
        <button
          type="button"
          className={CHIP}
          onClick={() => onLocationOpenChange(!locationOpen)}
          aria-expanded={locationOpen}
        >
          <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
          {selectedPowiat ? (
            <span className="max-md:truncate">
              {selectedPowiat.name}
              {selectedGmina ? ` / ${selectedGmina.name}` : ''}
            </span>
          ) : (
            <span className="text-muted-foreground">Lokalizacja</span>
          )}
          <ChevronDown
            className={cn('h-3.5 w-3.5 opacity-60 transition-transform max-md:shrink-0', locationOpen && 'rotate-180')}
          />
        </button>
      </div>

      {(errors.assigned_to || errors.due_date) && (
        <p className="text-xs text-destructive">
          {[errors.assigned_to?.message, errors.due_date?.message].filter(Boolean).join(' • ')}
        </p>
      )}

      {locationOpen && (
        <div className="grid gap-3 rounded-lg border bg-muted/40 p-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="case_powiat" className="text-xs text-muted-foreground">
              Powiat
            </Label>
            <SearchSelect
              id="case_powiat"
              value={powiatId ? String(powiatId) : null}
              onChange={(v) => {
                form.setValue('powiat_id', v ? Number(v) : undefined, { shouldValidate: true });
                form.setValue('gmina_id', undefined);
              }}
              noneLabel="- brak -"
              placeholder="Wybierz"
              options={(powiaty ?? []).map((p) => ({ value: String(p.id), label: p.name }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="case_gmina" className="text-xs text-muted-foreground">
              Gmina
            </Label>
            <SearchSelect
              id="case_gmina"
              value={gminaId ? String(gminaId) : null}
              onChange={(v) =>
                form.setValue('gmina_id', v ? Number(v) : undefined, { shouldValidate: true })
              }
              disabled={!powiatId}
              noneLabel="- brak -"
              placeholder={powiatId ? 'Wybierz' : 'Wybierz powiat'}
              options={(gminy ?? []).map((g) => ({ value: String(g.id), label: g.name }))}
            />
          </div>
        </div>
      )}
    </div>
  );
}
