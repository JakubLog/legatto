// Roczne rozliczenie ryczałtu na prowadzenie biura poselskiego.
//
// Pozycje = "Sprawozdanie z wydatkowania kwoty ryczałtu przeznaczonego na prowadzenie biura
// poselskiego" (załącznik nr 3 do zarządzenia nr 8 Marszałka Sejmu z 25.09.2001, brzmienie
// z zarządzenia nr 11 z 30.12.2025). Pozycja 22 "Inne wydatki" ma w formularzu podpozycje
// 1-4 i wiersz bez nazwy - tu 22.1-22.5. Kategoria wydatku wskazuje pozycję
// (`expense_categories.settlement_item`, constraint expense_categories_settlement_item_valid).

import type { BudgetYearCategoryTotal, ExpenseCategory } from '@/integrations/supabase/types';

export const SETTLEMENT_ITEMS = [
  {
    code: '1',
    label: 'Wynagrodzenia pracowników biura poselskiego zatrudnionych na podstawie umowy o pracę wraz z pochodnymi',
    short: 'Wynagrodzenia pracowników (umowy o pracę)',
  },
  {
    code: '2',
    label: 'Wynagrodzenia osób zatrudnionych przez posła na podstawie umów cywilnoprawnych',
    short: 'Umowy cywilnoprawne',
  },
  {
    code: '3',
    label: 'Koszty badań lekarskich i szkoleń pracowników, o których mowa w pkt 1',
    short: 'Badania lekarskie i szkolenia pracowników',
  },
  {
    code: '4',
    label: 'Świadczenia urlopowe wypłacane pracownikom biura poselskiego, o których mowa w pkt 1',
    short: 'Świadczenia urlopowe pracowników',
  },
  {
    code: '5',
    label: 'Koszty usług, konsultacyjnych, doradczych, eksperckich oraz tłumaczeń',
    short: 'Usługi doradcze, eksperckie, tłumaczenia',
  },
  { code: '6', label: 'Koszty usług telekomunikacyjnych', short: 'Usługi telekomunikacyjne' },
  {
    code: '7',
    label:
      'Koszty usług pocztowych i kurierskich oraz ogłoszeń i informacji zw. z wykonywaniem mandatu poselskiego w terenie',
    short: 'Poczta, kurierzy, ogłoszenia i informacje',
  },
  {
    code: '8',
    label: 'Koszty organizacji spotkań z wyborcami (w tym najem sal, koszty obsługi technicznej)',
    short: 'Spotkania z wyborcami',
  },
  {
    code: '9',
    label: 'Koszty przejazdów posła w związku z wykonywaniem mandatu w okręgu wyborczym',
    short: 'Przejazdy posła w okręgu',
  },
  {
    code: '10',
    label: 'Koszty przejazdów posła w związku z wykonywaniem mandatu poza okręg wyborczy',
    short: 'Przejazdy posła poza okręg',
  },
  {
    code: '11',
    label: 'Koszty najmu samochodu lub innego pojazdu oraz korzystania z taksówek i innych usług przewozu osób',
    short: 'Najem pojazdu, taksówki, przewóz osób',
  },
  {
    code: '12',
    label: 'Koszty podróży służbowych pracowników biura poselskiego, o których mowa w pkt 1',
    short: 'Podróże służbowe pracowników',
  },
  {
    code: '13',
    label: 'Koszty podróży asystentów społecznych i osób, o których mowa w pkt 2',
    short: 'Podróże asystentów i zleceniobiorców',
  },
  {
    code: '14',
    label: 'Koszty obsługi bankowej i rachunkowo-księgowej biura poselskiego',
    short: 'Obsługa bankowa i księgowa',
  },
  {
    code: '15',
    label:
      'Koszty utworzenia oraz obsługi strony internetowej, mediów społecznościowych, subskrypcji oprogramowania, dostępu do serwisów internetowych',
    short: 'Strona www, social media, subskrypcje',
  },
  {
    code: '16',
    label:
      'Koszty najmu lokalu biura poselskiego, w tym: czynsz, opłaty za energię elektryczną i cieplną, gaz, wodę, wywóz śmieci, podatki i opłaty lokalne, abonament RTV, ubezpieczenie OC',
    short: 'Najem lokalu biura z opłatami',
  },
  {
    code: '17',
    label: 'Koszty konserwacji i naprawy sprzętu technicznego biura poselskiego oraz koszty jego eksploatacji',
    short: 'Konserwacja, naprawa i eksploatacja sprzętu',
  },
  {
    code: '18',
    label: 'Koszty drobnych napraw i remontów lokalu biura poselskiego',
    short: 'Drobne naprawy i remonty lokalu',
  },
  {
    code: '19',
    label: 'Koszty zakupu środków trwałych o charakterze wyposażenia oraz wartości niematerialnych i prawnych',
    short: 'Środki trwałe i wartości niematerialne',
  },
  {
    code: '20',
    label:
      'Koszty zakupu materiałów biurowych, prasy, wydawnictw, nagród rzeczowych oraz rekwizytów zw. z obchodami świąt państwowych',
    short: 'Materiały biurowe, prasa, wydawnictwa',
  },
  {
    code: '21',
    label: 'Koszty zakupu środków czystości, art. elektrotechnicznych, art. dekoracyjnych itp.',
    short: 'Środki czystości, art. elektrotechniczne',
  },
  { code: '22.1', label: 'Art. spożywcze', short: 'Inne: art. spożywcze' },
  { code: '22.2', label: 'Kwiaty, wieńce', short: 'Inne: kwiaty, wieńce' },
  { code: '22.3', label: 'Autostrady, parkingi', short: 'Inne: autostrady, parkingi' },
  { code: '22.4', label: 'Materiały patriotyczne', short: 'Inne: materiały patriotyczne' },
  { code: '22.5', label: 'Pozostałe', short: 'Inne: pozostałe wydatki' },
] as const;

export type SettlementItemCode = (typeof SETTLEMENT_ITEMS)[number]['code'];

/** Pozycja 22 formularza - suma podpozycji 22.1-22.5. */
export const SETTLEMENT_OTHER_LABEL = 'Inne wydatki związane z prowadzeniem biura poselskiego';

const ITEM_BY_CODE: Record<string, (typeof SETTLEMENT_ITEMS)[number]> = Object.fromEntries(
  SETTLEMENT_ITEMS.map((i) => [i.code, i]),
);

export function isSettlementItemCode(value: string | null | undefined): value is SettlementItemCode {
  return value != null && Object.prototype.hasOwnProperty.call(ITEM_BY_CODE, value);
}

/** "16. Najem lokalu biura z opłatami"; nieznany kod / null = null. */
export function settlementItemShortLabel(code: string | null | undefined): string | null {
  const item = code ? ITEM_BY_CODE[code] : undefined;
  return item ? `${item.code}. ${item.short}` : null;
}

export interface SettlementCategoryRef {
  id: number;
  name: string;
}

export interface SettlementLine {
  /** '1'..'21', '22' (suma inne) lub '22.1'..'22.5'. */
  code: string;
  /** Numer w formularzu: '1.'..'22.' lub '1.'..'5.' dla podpozycji 22. */
  lp: string;
  label: string;
  amount: number;
  count: number;
  /** Podpozycja pozycji 22. */
  isSub: boolean;
  categories: SettlementCategoryRef[];
}

export interface SettlementUnassigned {
  /** null = wydatki bez kategorii. */
  categoryId: number | null;
  name: string;
  total: number;
  count: number;
}

export interface Settlement {
  /** Wiersze formularza: 1-21, 22 (suma), 22.1-22.5. */
  lines: SettlementLine[];
  /** Suma pozycji formularza ("wydatkowano wg powyższego zestawienia"). */
  total: number;
  /** Kategorie z wydatkami w okresie bez przypisanej pozycji (oraz wydatki bez kategorii). */
  unassigned: SettlementUnassigned[];
  unassignedTotal: number;
}

/** Grosze - sumy pieniężne bez błędów zmiennoprzecinkowych. */
const toGrosze = (amount: number | string) => Math.round(Number(amount) * 100);

export function buildSettlement(categories: ExpenseCategory[], totals: BudgetYearCategoryTotal[]): Settlement {
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const acc = new Map<string, { grosze: number; count: number; categories: SettlementCategoryRef[] }>(
    SETTLEMENT_ITEMS.map((i) => [i.code, { grosze: 0, count: 0, categories: [] }]),
  );
  const unassigned: SettlementUnassigned[] = [];

  for (const row of totals) {
    const category = row.category_id === null ? undefined : categoryById.get(row.category_id);
    const code = category?.settlement_item;
    const bucket = isSettlementItemCode(code) ? acc.get(code) : undefined;
    if (!category || !bucket) {
      unassigned.push({
        categoryId: row.category_id,
        name: category?.name ?? (row.category_id === null ? 'Bez kategorii' : `Kategoria #${row.category_id}`),
        total: Number(row.total),
        count: row.count,
      });
      continue;
    }
    bucket.grosze += toGrosze(row.total);
    bucket.count += row.count;
    bucket.categories.push({ id: category.id, name: category.name });
  }

  const lines: SettlementLine[] = [];
  let otherGrosze = 0;
  let otherCount = 0;
  let totalGrosze = 0;
  for (const item of SETTLEMENT_ITEMS) {
    const a = acc.get(item.code)!;
    totalGrosze += a.grosze;
    const isSub = item.code.startsWith('22.');
    if (isSub) {
      otherGrosze += a.grosze;
      otherCount += a.count;
    }
    lines.push({
      code: item.code,
      lp: `${isSub ? item.code.slice(3) : item.code}.`,
      label: item.label,
      amount: a.grosze / 100,
      count: a.count,
      isSub,
      categories: a.categories,
    });
  }
  const firstSub = lines.findIndex((l) => l.isSub);
  lines.splice(firstSub, 0, {
    code: '22',
    lp: '22.',
    label: SETTLEMENT_OTHER_LABEL,
    amount: otherGrosze / 100,
    count: otherCount,
    isSub: false,
    categories: lines.filter((l) => l.isSub).flatMap((l) => l.categories),
  });

  return {
    lines,
    total: totalGrosze / 100,
    unassigned: unassigned.sort((a, b) => b.total - a.total),
    unassignedTotal: unassigned.reduce((s, u) => s + toGrosze(u.total), 0) / 100,
  };
}

/** Liczba miesięcy okresu rozliczenia (styczeń..miesiąc `dateTo`), np. 11 dla 2026-11-07. */
export function settlementMonths(dateTo: string): number {
  return Number(dateTo.slice(5, 7));
}

/** Kwota w zł bez symbolu waluty, 2 miejsca po przecinku ("1 234,56"). */
export function formatAmountPl(amount: number): string {
  return new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
}

/** Suma w groszach -> zł (dodawanie kwot pieniężnych z formularza). */
export function addAmounts(...amounts: number[]): number {
  return amounts.reduce((s, a) => s + toGrosze(a), 0) / 100;
}
