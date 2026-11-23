import { createContext, useContext, useMemo, useState, type ComponentProps, type ComponentType, type ReactElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PublicCalendarSection } from '@/components/public/PublicCalendarSection';
import { PublicHeader } from '@/components/public/PublicHeader';
import { PublicOfficeCard } from '@/components/public/PublicOfficeCard';
import { PublicSubmissionForm, type PublicSubmissionFormProps } from '@/components/public/PublicSubmissionForm';
import { sealedSubmissionStrategy } from '@/lib/publicSubmission';

// Wyspy strony statycznej: komponenty publiczne hydratowane w przeglądarce (menu mobilne, kalendarz
// z posiedzeniami Sejmu z /api/sejm-sittings Workera, okno zespołu biura, formularz zgłoszeń).
// Reszta strony to czysty HTML z SSR. Każda wyspa jest renderowana na serwerze osobnym
// renderToString z tym samym opakowaniem (IslandShell) co hydrateRoot w przeglądarce, więc
// identyfikatory useId (Radix) i znaczniki zgadzają się 1:1. Props wysp muszą być serializowalne
// (JSON w <script type="application/json" id="legatto-islands">).

interface SealedSubmissionFormProps extends PublicSubmissionFormProps {
  /** Klucz witryny Turnstile z site-config (strona statyczna nie ma runtime-config.js). */
  turnstileSiteKey: string;
}

/** Formularz strony statycznej: szyfrowanie w przeglądarce kluczem z /data/form-key.json, POST /api/submit. */
function SealedSubmissionForm({ turnstileSiteKey, ...props }: SealedSubmissionFormProps) {
  const strategy = useMemo(() => sealedSubmissionStrategy(turnstileSiteKey), [turnstileSiteKey]);
  return <PublicSubmissionForm {...props} strategy={strategy} />;
}

export const ISLANDS = {
  header: PublicHeader,
  calendar: PublicCalendarSection,
  'office-card': PublicOfficeCard,
  'submit-form': SealedSubmissionForm,
} as const;

export type IslandName = keyof typeof ISLANDS;
export type IslandProps<N extends IslandName> = ComponentProps<(typeof ISLANDS)[N]>;

export const ISLANDS_SCRIPT_ID = 'legatto-islands';

/** Zapis wyspy w JSON strony: nazwa komponentu i jego props. */
export interface IslandRecord {
  name: IslandName;
  props: object;
}

/** Wspólne opakowanie wyspy (serwer i przeglądarka): React Query dla useSejmSittings. */
export function IslandShell({ client, children }: { client: QueryClient; children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

export function islandElement(record: IslandRecord, client: QueryClient): ReactElement {
  // Rejestr łączy różne typy props; zgodność nazwy i props gwarantuje Island<N> przy SSR.
  const Component = ISLANDS[record.name] as ComponentType<object>;
  return (
    <IslandShell client={client}>
      <Component {...record.props} />
    </IslandShell>
  );
}

export function islandPlaceholder(id: string, name: IslandName): string {
  return `<div data-island="${name}" data-island-id="${id}" style="display:contents"></div>`;
}

/** Zbiera wyspy podczas SSR strony; HTML wysp wstawia render.tsx w miejsce pustych kontenerów. */
export class IslandCollector {
  readonly records: IslandRecord[] = [];

  add(name: IslandName, props: object): string {
    this.records.push({ name, props });
    return String(this.records.length - 1);
  }
}

export const IslandCollectorContext = createContext<IslandCollector | null>(null);

/**
 * Pusty kontener wyspy (display: contents - nie zmienia układu siatki/flex rodzica). Rejestracja
 * w useState: React woła inicjalizator raz na instancję, także przy renderToString.
 */
export function Island<N extends IslandName>({ name, props }: { name: N; props: IslandProps<N> }) {
  const collector = useContext(IslandCollectorContext);
  if (!collector) throw new Error('Island: brak IslandCollectorContext (wyspy renderuje tylko site/render.tsx)');
  const [id] = useState(() => collector.add(name, props));
  return <div data-island={name} data-island-id={id} style={{ display: 'contents' }} />;
}

export function newIslandQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });
}
