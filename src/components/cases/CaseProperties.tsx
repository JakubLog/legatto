import { useState, type ReactNode } from 'react';
import { format, isPast } from 'date-fns';
import { pl } from 'date-fns/locale';
import {
  CalendarDays,
  Check,
  CircleDot,
  Flag,
  Globe,
  MapPin,
  Plus,
  Tag,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { CreatorAvatar } from '@/components/common/CreatorAvatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { MiniCalendar } from '@/components/ui/mini-calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SearchSelect } from '@/components/ui/search-select';
import { useCaseCategories } from '@/hooks/useCaseCategories';
import { useCasePatch, type CaseInput } from '@/hooks/useCases';
import { useGminy } from '@/hooks/useGminy';
import { usePowiaty } from '@/hooks/usePowiaty';
import { CASE_PRIORITIES, CASE_STATUSES, isCaseResolved } from '@/lib/cases';
import type { CaseWithRelations } from '@/integrations/supabase/types';
import { cn } from '@/lib/utils';
import { AddCategoryDialog } from './AddCategoryDialog';
import { CasePriorityFlag, CaseStatusPill } from './CaseBadges';
import { EDITABLE_VALUE } from './inlineEdit';

function Property({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    // Telefon: węższa kolumna etykiety i ukryta ikonka — więcej miejsca na wartość przy 360px.
    <div className="grid min-h-9 grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-2 max-md:min-h-10 max-md:grid-cols-[6rem_minmax(0,1fr)] max-md:gap-x-2">
      <dt className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className="h-4 w-4 shrink-0 max-md:hidden" aria-hidden />
        <span className="truncate">{label}</span>
      </dt>
      <dd className="flex min-w-0 items-center text-sm">{children}</dd>
    </div>
  );
}

const EMPTY = <span className="text-muted-foreground">—</span>;

interface Props {
  case_: CaseWithRelations;
  /**
   * Gdy podane - wartości są klikalne (edycja w miejscu, zapis od razu), a klik w „Przypisana do”
   * otwiera przepisanie sprawy.
   */
  onReassign?: () => void;
}

/** Lista właściwości sprawy w stylu widoku zadania ClickUp: etykieta | wartość, dwie kolumny od sm. */
export function CaseProperties({ case_: c, onReassign }: Props) {
  const editable = Boolean(onReassign);
  const { save } = useCasePatch(c.id);
  const { data: categories } = useCaseCategories();
  const [dueOpen, setDueOpen] = useState(false);
  const [addCategoryOpen, setAddCategoryOpen] = useState(false);
  const overdue = Boolean(c.due_date) && !isCaseResolved(c.status) && isPast(new Date(c.due_date ?? ''));

  const status = <CaseStatusPill status={c.status} />;
  const priority = <CasePriorityFlag priority={c.priority} showLabel className="text-sm" />;
  const assigned = c.assigned ? (
    <>
      <CreatorAvatar name={c.assigned.full_name} avatarUrl={c.assigned.avatar_url} />
      <span className="truncate font-medium" title={c.assigned.full_name}>{c.assigned.full_name}</span>
    </>
  ) : (
    EMPTY
  );
  const due = c.due_date ? (
    <span className={cn(overdue && 'font-medium text-destructive')}>
      {format(new Date(c.due_date), 'd MMM yyyy', { locale: pl })}
      {overdue && <span className="ml-1 text-xs">(zaległy)</span>}
    </span>
  ) : (
    EMPTY
  );
  const category = c.category ? (
    <span className="inline-block max-w-full truncate rounded-full bg-muted px-2 py-0.5 text-xs">{c.category.name}</span>
  ) : (
    EMPTY
  );
  const location =
    c.powiat || c.gmina ? (
      <span className="truncate">
        {c.powiat?.name}
        {c.gmina ? ` / ${c.gmina.name}` : ''}
      </span>
    ) : (
      EMPTY
    );

  if (!editable) {
    return (
      <dl className="grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
        <Property icon={CircleDot} label="Status">{status}</Property>
        <Property icon={Flag} label="Priorytet">{priority}</Property>
        <Property icon={UserRound} label="Przypisana do"><span className="flex min-w-0 items-center gap-2">{assigned}</span></Property>
        <Property icon={CalendarDays} label="Termin">{due}</Property>
        <Property icon={Tag} label="Kategoria">{category}</Property>
        <Property icon={MapPin} label="Lokalizacja">{location}</Property>
        <Property icon={Globe} label="Źródło">{c.source === 'public_form' ? 'Formularz publiczny' : 'Wewnętrzne'}</Property>
      </dl>
    );
  }

  return (
    <>
      <dl className="grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
        <Property icon={CircleDot} label="Status">
          <DropdownMenu>
            <DropdownMenuTrigger className={EDITABLE_VALUE} aria-label="Zmień status">
              {status}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
              {CASE_STATUSES.map((s) => (
                <DropdownMenuItem key={s} onSelect={() => s !== c.status && void save({ status: s })}>
                  <CaseStatusPill status={s} />
                  {s === c.status && <Check className="ml-auto" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </Property>

        <Property icon={Flag} label="Priorytet">
          <DropdownMenu>
            <DropdownMenuTrigger className={EDITABLE_VALUE} aria-label="Zmień priorytet">
              {priority}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
              {CASE_PRIORITIES.map((p) => (
                <DropdownMenuItem key={p} onSelect={() => p !== c.priority && void save({ priority: p })}>
                  <CasePriorityFlag priority={p} showLabel className="text-sm" />
                  {p === c.priority && <Check className="ml-auto" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </Property>

        <Property icon={UserRound} label="Przypisana do">
          <button type="button" className={EDITABLE_VALUE} onClick={onReassign} aria-label="Przepisz sprawę" title="Przepisz sprawę">
            {assigned}
          </button>
        </Property>

        <Property icon={CalendarDays} label="Termin">
          <Popover open={dueOpen} onOpenChange={setDueOpen}>
            <PopoverTrigger className={EDITABLE_VALUE} aria-label="Zmień termin">
              {due}
            </PopoverTrigger>
            <PopoverContent>
              <MiniCalendar
                value={c.due_date}
                onChange={(date) => {
                  setDueOpen(false);
                  if (date !== c.due_date) void save({ due_date: date });
                }}
              />
            </PopoverContent>
          </Popover>
        </Property>

        <Property icon={Tag} label="Kategoria">
          <DropdownMenu>
            <DropdownMenuTrigger className={EDITABLE_VALUE} aria-label="Zmień kategorię">
              {category}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-72 w-56 overflow-y-auto">
              {categories?.map((cat) => (
                <DropdownMenuItem key={cat.id} onSelect={() => cat.id !== c.category_id && void save({ category_id: cat.id })}>
                  <span className="min-w-0 flex-1 truncate">{cat.name}</span>
                  {cat.id === c.category_id && <Check />}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setAddCategoryOpen(true)}>
                <Plus />
                Nowa kategoria
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Property>

        <Property icon={MapPin} label="Lokalizacja">
          <Popover>
            <PopoverTrigger className={EDITABLE_VALUE} aria-label="Zmień lokalizację">
              {location}
            </PopoverTrigger>
            <PopoverContent className="w-72 p-3">
              <LocationEditor case_={c} onSave={save} />
            </PopoverContent>
          </Popover>
        </Property>

        <Property icon={Globe} label="Źródło">
          {c.source === 'public_form' ? 'Formularz publiczny' : 'Wewnętrzne'}
        </Property>
      </dl>

      <AddCategoryDialog
        open={addCategoryOpen}
        onOpenChange={setAddCategoryOpen}
        onCreated={(created) => void save({ category_id: created.id })}
      />
    </>
  );
}

interface LocationProps {
  case_: CaseWithRelations;
  onSave: (patch: Partial<CaseInput>) => Promise<boolean>;
}

/** Powiat i gmina - każda zmiana zapisuje się od razu (zmiana powiatu czyści gminę). */
function LocationEditor({ case_: c, onSave }: LocationProps) {
  const { data: powiaty } = usePowiaty();
  const { data: gminy } = useGminy(c.powiat_id);

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="case-prop-powiat" className="text-xs text-muted-foreground">Powiat</Label>
        <SearchSelect
          id="case-prop-powiat"
          value={c.powiat_id ? String(c.powiat_id) : null}
          onChange={(v) => void onSave({ powiat_id: v ? Number(v) : null, gmina_id: null })}
          options={(powiaty ?? []).map((p) => ({ value: String(p.id), label: p.name }))}
          noneLabel="- brak -"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="case-prop-gmina" className="text-xs text-muted-foreground">Gmina</Label>
        <SearchSelect
          id="case-prop-gmina"
          value={c.gmina_id ? String(c.gmina_id) : null}
          onChange={(v) => void onSave({ gmina_id: v ? Number(v) : null })}
          options={(gminy ?? []).map((g) => ({ value: String(g.id), label: g.name }))}
          noneLabel="- brak -"
          placeholder={c.powiat_id ? 'Wybierz' : 'Wybierz powiat'}
          disabled={!c.powiat_id}
        />
      </div>
    </div>
  );
}
