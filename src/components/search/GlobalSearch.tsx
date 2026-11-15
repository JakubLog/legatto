import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { History, Loader2, SearchX, Trash2 } from 'lucide-react';
import {
  SEARCH_MIN_LENGTH,
  SEARCH_RESULT_HREF,
  useGlobalSearch,
  type SearchResult,
} from '@/hooks/useGlobalSearch';
import { normalizeText, PROFILE_NAV_ITEM, type NavItem } from '@/components/layout/navigation';
import { useNavSections } from '@/components/layout/useNavSections';
import { Command, CommandDialog, CommandGroup, CommandInput, CommandList } from './command';
import { RESULT_TYPE_META, RESULT_TYPES } from './constants';
import { clearRecent, pushRecent, readRecent, type RecentRecord } from './recent';
import { SearchFooter, SearchItem, SearchSkeleton } from './SearchItem';
import { useSearch } from './SearchProvider';
import { useIsMobile } from '@/hooks/useIsMobile';

function matchesNav(item: NavItem, tokens: string[]): boolean {
  const haystack = normalizeText([item.label, ...(item.keywords ?? [])].join(' '));
  return tokens.every((t) => haystack.includes(t));
}

function SearchPalette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const navSections = useNavSections();
  const isMobile = useIsMobile();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('');
  const [recent, setRecent] = useState<RecentRecord[]>(readRecent);
  const search = useGlobalSearch(query);

  const trimmed = query.trim();
  const tokens = useMemo(() => normalizeText(trimmed).split(/\s+/).filter(Boolean), [trimmed]);
  const navItems = useMemo(
    () => navSections.flatMap((s) => s.items).filter((item) => !isMobile || !item.desktopOnly),
    [isMobile, navSections],
  );
  const visibleNav = tokens.length ? navItems.filter((i) => matchesNav(i, tokens)) : navItems;
  const quickActions = [PROFILE_NAV_ITEM].filter((i) => !tokens.length || matchesNav(i, tokens));

  const remoteActive = trimmed.length >= SEARCH_MIN_LENGTH;
  const data = remoteActive ? search.data : undefined;
  const remoteGroups = RESULT_TYPES.map((type) => ({ type, items: data?.results[type] ?? [] })).filter(
    (g) => g.items.length > 0,
  );
  const remoteCount = remoteGroups.reduce((n, g) => n + g.items.length, 0);
  const showSkeleton = remoteActive && search.isSearching && !data;
  const noResults =
    remoteActive && !search.isSearching && !search.isError && remoteCount === 0 && visibleNav.length === 0 && quickActions.length === 0;

  // Wartości elementów w kolejności renderowania. Nowy pierwszy element (zmiana zapytania lub
  // dojście wyników z serwera) przenosi zaznaczenie na górę - Enter otwiera najlepsze trafienie.
  const showRecent = !trimmed && recent.length > 0;
  const itemValues = [
    ...(showRecent ? recent.map((r) => `recent:${r.type}:${r.id}`) : []),
    ...remoteGroups.flatMap((g) => g.items.map((r) => `${r.type}:${r.id}`)),
    ...quickActions.map((i) => `action:${i.to}`),
    ...visibleNav.map((i) => `nav:${i.to}`),
  ];
  const firstValue = itemValues[0] ?? '';
  const selectedExists = itemValues.includes(selected);
  useEffect(() => {
    setSelected(firstValue);
  }, [firstValue]);
  useEffect(() => {
    if (!selectedExists) setSelected(firstValue);
  }, [selectedExists, firstValue]);

  const go = (href: string) => {
    onClose();
    navigate(href);
  };
  const openRecord = (record: SearchResult | RecentRecord) => {
    setRecent(pushRecent({ type: record.type, id: record.id, title: record.title }));
    go(SEARCH_RESULT_HREF[record.type](record.id));
  };

  return (
    <Command shouldFilter={false} value={selected} onValueChange={setSelected} loop label="Wyszukiwarka">
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder={isMobile ? 'Szukaj w portalu…' : 'Szukaj spraw, kontaktów, wydarzeń, stron…'}
        aria-label="Szukaj w portalu"
        trailing={
          <>
            {search.isSearching && data ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
            ) : null}
            {/* Na telefonie brak Esc - jawny przycisk zamknięcia palety. */}
            <button
              type="button"
              onClick={onClose}
              className="-mr-2 h-11 shrink-0 rounded-lg px-3 text-sm font-medium text-primary hover:bg-muted md:hidden"
            >
              Anuluj
            </button>
          </>
        }
      />
      <CommandList>
        {trimmed.length > 0 && !remoteActive && (
          <p className="px-2.5 py-2 text-xs text-muted-foreground">
            Wpisz co najmniej {SEARCH_MIN_LENGTH} znaki, aby przeszukać rekordy.
          </p>
        )}

        {!trimmed && !showRecent && (
          <p className="flex items-center gap-2 px-2.5 py-2 text-xs text-muted-foreground">
            <History className="h-3.5 w-3.5" aria-hidden />
            Tu pojawią się ostatnio otwierane rekordy.
          </p>
        )}

        {showRecent && (
          <CommandGroup heading="Ostatnio otwierane">
            {recent.map((r) => (
              <SearchItem
                key={`${r.type}:${r.id}`}
                value={`recent:${r.type}:${r.id}`}
                Icon={RESULT_TYPE_META[r.type].Icon}
                title={r.title}
                subtitle={RESULT_TYPE_META[r.type].label}
                tone="record"
                onSelect={() => openRecord(r)}
              />
            ))}
          </CommandGroup>
        )}

        {showSkeleton && <SearchSkeleton />}

        {remoteActive && search.isError && (
          <p className="px-2.5 py-3 text-sm text-destructive">
            Nie udało się wyszukać. Sprawdź połączenie i spróbuj ponownie.
          </p>
        )}

        {remoteGroups.map(({ type, items }) => (
          <CommandGroup key={type} heading={RESULT_TYPE_META[type].group}>
            {items.map((r) => (
              <SearchItem
                key={r.id}
                value={`${r.type}:${r.id}`}
                Icon={RESULT_TYPE_META[type].Icon}
                title={r.title}
                subtitle={r.subtitle}
                tone="record"
                onSelect={() => openRecord(r)}
              />
            ))}
          </CommandGroup>
        ))}

        {data && data.failed.length > 0 && !search.isSearching && (
          <p className="px-2.5 py-1.5 text-xs text-muted-foreground">
            Nie udało się przeszukać: {data.failed.map((t) => RESULT_TYPE_META[t].group).join(', ')}.
          </p>
        )}

        {noResults && (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
              <SearchX className="h-5 w-5 text-muted-foreground" aria-hidden />
            </span>
            <p className="text-sm text-muted-foreground">Brak wyników dla „{trimmed}”.</p>
          </div>
        )}

        {(quickActions.length > 0 || showRecent) && (
          <CommandGroup heading="Szybkie akcje">
            {quickActions.map((i) => (
              <SearchItem key={i.to} value={`action:${i.to}`} Icon={i.Icon} title={i.label} onSelect={() => go(i.to)} />
            ))}
            {showRecent && (
              <SearchItem
                value="action:clear-recent"
                Icon={Trash2}
                title="Wyczyść historię wyszukiwania"
                onSelect={() => {
                  clearRecent();
                  setRecent([]);
                }}
              />
            )}
          </CommandGroup>
        )}

        {visibleNav.length > 0 && (
          <CommandGroup heading="Nawigacja">
            {visibleNav.map((i) => (
              <SearchItem key={i.to} value={`nav:${i.to}`} Icon={i.Icon} title={i.label} onSelect={() => go(i.to)} />
            ))}
          </CommandGroup>
        )}
      </CommandList>
      <SearchFooter />
    </Command>
  );
}

/** Paleta wyszukiwania globalnego (Ctrl/Cmd+K, "/"). Stan otwarcia w SearchProvider. */
export function GlobalSearch() {
  const { open, setOpen } = useSearch();
  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Wyszukiwarka"
      description="Przeszukaj sprawy, kontakty, wydarzenia, interpelacje, wydatki i strony portalu."
    >
      {open && <SearchPalette onClose={() => setOpen(false)} />}
    </CommandDialog>
  );
}
