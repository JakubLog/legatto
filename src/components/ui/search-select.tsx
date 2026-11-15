import * as React from 'react';
import { Check, ChevronDown, Loader2 } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { foldForSearch } from '@/lib/caseHistory';
import { cn } from '@/lib/utils';

export interface SearchSelectOption {
  value: string;
  label: string;
  /** Druga linia (wyszarzona); też przeszukiwana. */
  description?: string;
  /** Element przed etykietą (awatar, kropka koloru). */
  icon?: React.ReactNode;
  /** Nagłówek grupy; kolejne opcje z tą samą grupą trafiają pod jeden nagłówek. */
  group?: string;
  /** Dodatkowe słowa do wyszukiwania (niewidoczne). */
  keywords?: string;
  disabled?: boolean;
}

/** Ile opcji renderujemy naraz - dłuższe listy zawężamy wpisanym tekstem. */
const MAX_RENDERED = 100;
const SEARCH_DEBOUNCE_MS = 250;

function nextEnabled(options: SearchSelectOption[], from: number, step: 1 | -1): number {
  const n = options.length;
  for (let i = 1; i <= n; i++) {
    const idx = (((from + step * i) % n) + n) % n;
    if (!options[idx].disabled) return idx;
  }
  return -1;
}

interface ComboboxState {
  open: boolean;
  setOpen: (open: boolean) => void;
  active: number;
  setActive: (index: number) => void;
}

/**
 * Klawiatura listy: przy zamkniętej liście ↓/↑/Enter otwiera; przy otwartej ↓/Tab i ↑/Shift+Tab
 * przechodzą po opcjach (w kółko), Enter wybiera, Esc zamyka tylko listę (nie okno ani edycję w miejscu).
 */
function handleListKeys(
  e: React.KeyboardEvent<HTMLInputElement>,
  state: ComboboxState,
  options: SearchSelectOption[],
  onPick: (option: SearchSelectOption) => void,
) {
  const { open, setOpen, active, setActive } = state;
  if (!open) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
      e.preventDefault();
      setOpen(true);
    }
    return;
  }
  const forward = e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey);
  const backward = e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey);
  if (forward || backward) {
    e.preventDefault();
    if (options.length) setActive(nextEnabled(options, active, forward ? 1 : -1));
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const option = options[active];
    if (option && !option.disabled) onPick(option);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    setOpen(false);
  }
}

function useFiltered(options: SearchSelectOption[], query: string, filter: boolean) {
  return React.useMemo(() => {
    const folded = filter ? foldForSearch(query.trim()) : '';
    const hits = folded
      ? options.filter((o) =>
          foldForSearch([o.label, o.description, o.group, o.keywords].filter(Boolean).join(' ')).includes(folded),
        )
      : options;
    return { shown: hits.slice(0, MAX_RENDERED), total: hits.length };
  }, [options, query, filter]);
}

interface OptionListProps {
  id: string;
  options: SearchSelectOption[];
  total: number;
  active: number;
  selectedValue?: string | null;
  loading?: boolean;
  emptyText: string;
  label?: string;
  onActiveChange: (index: number) => void;
  onPick: (option: SearchSelectOption) => void;
}

function OptionList({
  id,
  options,
  total,
  active,
  selectedValue,
  loading,
  emptyText,
  label,
  onActiveChange,
  onPick,
}: OptionListProps) {
  const listRef = React.useRef<HTMLUListElement>(null);

  React.useEffect(() => {
    if (active < 0) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!options.length) {
    return (
      <p className="flex items-center gap-2 px-3 py-2.5 text-sm text-muted-foreground">
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {loading ? 'Wczytywanie…' : emptyText}
      </p>
    );
  }

  return (
    <ul
      ref={listRef}
      id={id}
      role="listbox"
      aria-label={label}
      className="max-h-[min(18rem,calc(var(--radix-popover-content-available-height)-0.5rem))] overflow-y-auto overscroll-contain p-1"
    >
      {options.map((o, i) => {
        const header = o.group && o.group !== options[i - 1]?.group;
        const selected = o.value === selectedValue;
        return (
          <React.Fragment key={o.value}>
            {header && (
              <li role="presentation" className="px-2 pb-1 pt-2 text-[11px] font-medium text-muted-foreground first:pt-1">
                {o.group}
              </li>
            )}
            <li
              id={`${id}-${i}`}
              data-index={i}
              role="option"
              aria-selected={i === active}
              aria-checked={selected}
              aria-disabled={o.disabled || undefined}
              title={o.label}
              className={cn(
                'relative flex min-h-8 cursor-pointer select-none items-center gap-2 rounded-md py-1.5 pl-8 pr-2 text-sm max-md:min-h-11 max-md:text-base',
                i === active && 'bg-accent text-accent-foreground',
                selected && 'font-medium',
                o.disabled && 'pointer-events-none opacity-50',
              )}
              onMouseMove={() => i !== active && onActiveChange(i)}
              onClick={() => !o.disabled && onPick(o)}
            >
              <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                {selected && <Check className="h-4 w-4 text-primary" />}
              </span>
              {o.icon}
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 break-words">{o.label}</span>
                {o.description && (
                  <span className="block truncate text-xs font-normal text-muted-foreground">{o.description}</span>
                )}
              </span>
            </li>
          </React.Fragment>
        );
      })}
      {total > options.length && (
        <li role="presentation" className="px-2 py-1.5 text-xs text-muted-foreground">
          Pokazano {options.length} z {total}. Wpisz więcej, aby zawęzić.
        </li>
      )}
    </ul>
  );
}

interface PopupProps {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLDivElement | null>;
  anchor: React.ReactNode;
  children: React.ReactNode;
}

/** Lista pod polem: szerokość = szerokość pola (nigdy szersza), fokus zostaje w polu. */
function ComboboxPopup({ open, onClose, anchorRef, anchor, children }: PopupProps) {
  return (
    <Popover open={open} onOpenChange={(o) => !o && onClose()}>
      <PopoverAnchor asChild>{anchor}</PopoverAnchor>
      <PopoverContent
        data-search-select-popup=""
        className="w-[var(--radix-popover-trigger-width)] max-w-[var(--radix-popover-trigger-width)] overflow-hidden p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          if (anchorRef.current?.contains(e.target as Node)) e.preventDefault();
        }}
        // Klik w listę nie zabiera fokusu z pola.
        onMouseDown={(e) => e.preventDefault()}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

export interface SearchSelectProps {
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  options: SearchSelectOption[];
  /** Tekst pustego pola (nic nie wybrano). */
  placeholder?: string;
  /** Pierwsza opcja czyszcząca wybór (np. „- brak -”); bez niej wyboru nie da się usunąć. */
  noneLabel?: string;
  /** Etykieta wybranej wartości spoza `options` (np. spoza pierwszej strony wyników). */
  selectedOption?: SearchSelectOption | null;
  /**
   * Wyszukiwanie po stronie serwera: dostaje wpisany tekst (z opóźnieniem), a `options` to już wyniki
   * - pole nie filtruje ich lokalnie.
   */
  onSearchChange?: (query: string) => void;
  loading?: boolean;
  emptyText?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  'aria-label'?: string;
  'aria-invalid'?: boolean;
}

/**
 * Pole wyboru z wyszukiwaniem (zamiast `Select` dla list z danych): klik otwiera listę i od razu
 * pozwala pisać, lista ma szerokość pola, ↓↑/Tab nawigują, Enter lub klik wybiera.
 */
export const SearchSelect = React.forwardRef<HTMLInputElement, SearchSelectProps>(function SearchSelect(
  {
    value,
    onChange,
    options,
    placeholder = 'Wybierz…',
    noneLabel,
    selectedOption,
    onSearchChange,
    loading,
    emptyText = 'Brak wyników',
    disabled,
    id,
    className,
    'aria-label': ariaLabel,
    'aria-invalid': ariaInvalid,
  },
  ref,
) {
  const listId = React.useId();
  const anchorRef = React.useRef<HTMLDivElement>(null);

  const [open, setOpenState] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [active, setActive] = React.useState(-1);
  const [picked, setPicked] = React.useState<SearchSelectOption | null>(null);

  const onSearchRef = React.useRef(onSearchChange);
  onSearchRef.current = onSearchChange;
  const serverSearch = Boolean(onSearchChange);
  React.useEffect(() => {
    if (!onSearchRef.current) return;
    const t = window.setTimeout(() => onSearchRef.current?.(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [query]);

  const selected =
    (value ? options.find((o) => o.value === value) : undefined) ??
    (value && picked?.value === value ? picked : undefined) ??
    (value && selectedOption?.value === value ? selectedOption : undefined) ??
    null;

  const { shown, total } = useFiltered(options, query, !serverSearch);
  const list = React.useMemo(
    () => (!noneLabel || query.trim() ? shown : [{ value: '', label: noneLabel }, ...shown]),
    [noneLabel, query, shown],
  );

  // Po otwarciu i każdej zmianie wyników podświetlona jest wybrana opcja albo pierwsza
  // (klucz z wartości, bo wywołujący zwykle podaje nową tablicę `options` przy każdym renderze).
  const listKey = list.map((o) => o.value).join('\u0000');
  React.useEffect(() => {
    if (!open) return;
    const idx = list.findIndex((o) => (o.value || null) === (value ?? null));
    setActive(idx >= 0 ? idx : nextEnabled(list, -1, 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `list` opisuje `listKey`
  }, [open, listKey, value]);

  const setOpen = (next: boolean) => {
    if (next === open) return;
    setOpenState(next);
    if (!next) setQuery('');
  };

  const pick = (option: SearchSelectOption) => {
    if (option.value) setPicked(option);
    onChange(option.value || null);
    setOpen(false);
  };

  const selectedLabel = selected?.label ?? '';
  const anchor = (
    <div ref={anchorRef} className={cn('relative w-full min-w-0', className)}>
      <Input
        ref={ref}
        id={id}
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid || undefined}
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        disabled={disabled}
        value={query}
        // Wybrana wartość jest „placeholderem” w kolorze tekstu - wpisywanie od razu szuka.
        placeholder={open ? selectedLabel || 'Szukaj…' : selectedLabel || placeholder}
        className={cn(
          'pr-9 text-ellipsis',
          ariaInvalid && 'border-destructive',
          selected && !open && 'placeholder:text-foreground',
          open && 'border-brand ring-[3px] ring-brand/20',
        )}
        onClick={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => handleListKeys(e, { open, setOpen, active, setActive }, list, pick)}
      />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground">
        {loading && open ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronDown className="h-4 w-4" />}
      </span>
    </div>
  );

  return (
    <ComboboxPopup open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} anchor={anchor}>
      <OptionList
        id={listId}
        options={list}
        total={total + list.length - shown.length}
        active={active}
        selectedValue={value ?? ''}
        loading={loading}
        emptyText={emptyText}
        label={ariaLabel}
        onActiveChange={setActive}
        onPick={pick}
      />
    </ComboboxPopup>
  );
});
