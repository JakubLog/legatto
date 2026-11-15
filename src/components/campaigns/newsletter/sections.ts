import {
  CalendarDays,
  Clapperboard,
  Hash,
  Images,
  Landmark,
  Mic,
  Microscope,
  Newspaper,
  Quote,
  SearchCheck,
  Star,
  Trees,
  Tv,
  Vote,
  type LucideIcon,
} from 'lucide-react';

import type { PreviewBlockKey } from '@/lib/newsletter/render';
import type { NewsletterTemplate, SectionKey } from '@/lib/newsletter/types';

/** id elementu DOM karty bloku w edytorze (cel przewijania z podglądu / walidacji). */
export const blockDomId = (key: PreviewBlockKey | 'basics') => `nl-block-${key}`;

/** Liczba błędów walidacji w poddrzewie błędów react-hook-form. */
export function countErrors(node: unknown): number {
  if (!node || typeof node !== 'object') return 0;
  if ('message' in node && typeof node.message === 'string') return 1;
  return Object.values(node).reduce<number>((n, child) => n + countErrors(child), 0);
}

// ============================================================================
// Katalog sekcji wymiennych: nazwa, opis w palecie "Dodaj sekcję", ikona
// i jednolinijkowe podsumowanie treści widoczne na zwiniętej karcie.
// ============================================================================

export interface SectionMeta {
  label: string;
  description: string;
  Icon: LucideIcon;
  summary: (t: NewsletterTemplate) => string;
}

/** Polska fleksja liczebnika: "1 pozycja", "3 pozycje", "5 pozycji". */
export const pluralize = (n: number, one: string, few: string, many: string) => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word = n === 1 ? one : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? few : many;
  return `${n} ${word}`;
};

const filled = (values: string[]) => values.filter((v) => v.trim()).length;

export const SECTION_META: Record<SectionKey, SectionMeta> = {
  lead: {
    label: 'Temat tygodnia',
    description: 'Duże zdjęcie, tytuł, opis i przycisk do artykułu.',
    Icon: Newspaper,
    summary: (t) => t.lead.title,
  },
  sejm: {
    label: 'Co w Sejmie?',
    description: 'Wynik głosowania z wykresem klubów i Twoim komentarzem.',
    Icon: Landmark,
    summary: (t) => t.sejm.title,
  },
  commentary: {
    label: 'Komentarz polityczny',
    description: 'Twoja opinia z wyróżnionym zdaniem.',
    Icon: Mic,
    summary: (t) => t.commentary.title || t.commentary.body,
  },
  region_news: {
    label: 'Z regionu',
    description: 'News z regionu ze zdjęciem. Nazwa regionu - pole „Region” w nagłówku.',
    Icon: Trees,
    summary: (t) => t.region_news.title,
  },
  expert: {
    label: 'Okiem eksperta',
    description: 'Analiza z tagami tematycznymi i linkiem do raportu.',
    Icon: Microscope,
    summary: (t) => t.expert.title || t.expert.body,
  },
  number_of_week: {
    label: 'Liczba tygodnia',
    description: 'Jedna duża liczba z krótkim kontekstem.',
    Icon: Hash,
    summary: (t) => [t.number_of_week.value, t.number_of_week.context].filter(Boolean).join(' — '),
  },
  media: {
    label: 'W mediach',
    description: 'Wywiady i artykuły z miniaturami.',
    Icon: Tv,
    summary: (t) => {
      const n = filled(t.media.items.map((i) => i.title));
      return n ? pluralize(n, 'pozycja', 'pozycje', 'pozycji') : '';
    },
  },
  reel: {
    label: 'Rolka tygodnia',
    description: 'Kadr z wideo i linki do Instagrama / TikToka.',
    Icon: Clapperboard,
    summary: (t) => t.reel.title,
  },
  events: {
    label: 'Zapraszam',
    description: 'Nadchodzące spotkania — można wstawić z kalendarza.',
    Icon: CalendarDays,
    summary: (t) => {
      const n = filled(t.events.items.map((i) => i.title));
      return n ? pluralize(n, 'wydarzenie', 'wydarzenia', 'wydarzeń') : '';
    },
  },
  reader_question: {
    label: 'Pytanie do czytelników',
    description: 'Ankieta z odpowiedziami-przyciskami.',
    Icon: Vote,
    summary: (t) => t.reader_question.question,
  },
  fact_check: {
    label: 'Fact-check',
    description: 'Sprawdzenie czyjejś wypowiedzi z werdyktem.',
    Icon: SearchCheck,
    summary: (t) => t.fact_check.statement,
  },
  gallery: {
    label: 'Galeria',
    description: 'Zdjęcia z tygodnia w siatce 2 × N.',
    Icon: Images,
    summary: (t) => {
      const n = filled(t.gallery.images.map((i) => i.url ?? ''));
      return n ? pluralize(n, 'zdjęcie', 'zdjęcia', 'zdjęć') : '';
    },
  },
  quote: {
    label: 'Cytat tygodnia',
    description: 'Wyróżniona sentencja na ciemnym tle.',
    Icon: Quote,
    summary: (t) => t.quote.body,
  },
  recommend: {
    label: 'Polecam',
    description: 'Książki, podcasty i artykuły warte uwagi.',
    Icon: Star,
    summary: (t) => {
      const n = filled(t.recommend.items.map((i) => i.title));
      return n ? pluralize(n, 'rekomendacja', 'rekomendacje', 'rekomendacji') : '';
    },
  },
};
