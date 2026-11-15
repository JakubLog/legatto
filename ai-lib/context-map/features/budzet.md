# Budżet biura (Faza 8)

> Pojedynczy globalny rejestr wydatków biura poselskiego. Faktury, rachunki, paragony. Koszyk = miesiąc kalendarzowy, limit miesięczny w `app_settings.budget_settings` (domyślnie **25 000 zł / miesiąc**, edycja Poseł/Administrator).

---

## Cel

Centralizacja wydatków biura Posła w jednym miejscu: kto, kiedy, ile, na co i z jakim dowodem (skan faktury/paragonu). Audyt kompletny, kontrola wykorzystania miesięcznego limitu (progress bar). Eksport PDF planowany w kolejnej iteracji.

---

## Model "koszyka miesięcznego"

- Miesiąc kalendarzowy = jeden koszyk. Granica: `expense_date` w przedziale `[startOfMonth, endOfMonth]`.
- **Limit:** `app_settings.budget_settings = {"monthly_limit_pln": <int 1..1 000 000>}` (migracja `20261107100000_budget_settings.sql`, seed 25 000 `on conflict do nothing`). Jeden limit dla wszystkich miesięcy (także archiwalnych i wykresu 12 mies.) - bez historii zmian limitu poza audytem `setting.update`.
  - Odczyt: aktywny użytkownik + aal2 (polityka `app_settings_select_budget_settings_active`, tylko ten klucz). Zapis: `app_settings_update_posel` (Poseł/Administrator + aal2); restrykcyjna `app_settings_no_secret_keys` dotyczy tylko kluczy API, więc nie blokuje. Constraint `app_settings_budget_settings_valid` pilnuje kształtu (liczba całkowita 1..1 000 000).
  - FE: `useBudgetSettings()` / `useMonthlyBudgetLimit()` → `{ limit, isLoading }` / `useUpdateBudgetSettings()` (`src/hooks/useBudgetSettings.ts`, klucz `['budget-settings']`). Wartość domyślna `DEFAULT_MONTHLY_LIMIT_PLN` w `src/lib/expenses.ts` tylko przy braku/niepoprawnym wierszu i do czasu odczytu. Helpery `budgetUsagePercent(spent, budget)` / `budgetLevel(spent, budget)` wymagają limitu parametrem.
  - Edycja: przycisk "Ustaw limit" w nagłówku widoku Wydatki (tylko `isAdmin`) → `BudgetLimitDialog` (zod `budgetSettingsSchema`, toast, invalidate).
  - API: `api/_lib/poliai/budget-report.ts` czyta limit service clientem (`loadMonthlyLimit`, domyślnie 25 000) i dopisuje go do migawki `budget_reports.analytics.monthly_limit_pln`; `BudgetReportKpis` pokazuje limit z migawki (starsze raporty: bieżący limit).
  - 25 000 zł to nie kwota ustawowa: ryczałt na biuro poselskie ustala Kancelaria Sejmu i zmienia się w czasie (2025: ok. 23,3 tys. zł), stąd ustawienie w bazie.
  - **ADR 018 (zmiana 2026-11-07):** limit nie jest już stałą w kodzie (`MONTHLY_BUDGET_PLN` usunięte z FE i API) - żyje w `app_settings.budget_settings` (jedna instancja = jeden poseł, ADR 026).
- Domyślny widok = bieżący miesiąc. Strzałki prev/next + native `<input type="month">` (max=bieżący) pozwalają cofnąć się w archiwalne miesiące.
- **Dodawanie / edycja wydatkow tylko w bieżącym miesiącu** (UX guard - przycisk "Dodaj" ukryty w archiwalnych, komunikat informacyjny). RLS pozwoliłaby pisać retroaktywnie - świadomy kompromis (Poseł i tak może edytować rekord, jeśli zmieni `expense_date`).
- Progress bar: zielony <60%, amber 60-85%, orange 85-100%, destructive ≥100% (z badge "Przekroczono o X zł").

---

## Role i uprawnienia

| Rola | Lista | Dodaj | Edytuj | Usuń | Kategorie |
|------|-------|-------|--------|------|-----------|
| Poseł | ✓ | ✓ | ✓ | ✓ | CRUD non-system |
| Pracownik | ✓ | ✓ | ✓ | - | dodaj non-system |
| Asystent | ✓ | - | - | - | - |

Poseł zawsze widzi wszystko (bypass scope). Faktury to dane wrażliwe - bucket prywatny, signed URL z ekspiracją 1h.

---

## Tabele

### `expense_categories`

Słownik kategorii. Identyczny wzór jak `case_categories`.

| Kolumna | Typ | Notes |
|---------|-----|-------|
| id | int PK identity | |
| name | text UNIQUE | |
| slug | text UNIQUE | auto-generowany ze `slugifyExpenseCategory` |
| color | text | nazwa koloru badge |
| is_system | boolean | systemowych nie da się modyfikować/usuwać |
| created_by | uuid FK profiles | null dla systemowych |
| settlement_item | text | pozycja sprawozdania z wydatkowania ryczałtu: `'1'..'21'`, `'22.1'..'22.5'` (CHECK `expense_categories_settlement_item_valid`); null = nieprzypisana. Zmiana tylko RPC `set_expense_category_settlement_item` |
| created_at | timestamptz | |

**Słownik = pozycje sprawozdania (od 2026-11-07, migracja `20261107850000_numeric_expense_categories.sql`):** kategorie "01." - "22." (zwykłe, nie systemowe, bez koloru), każda z przypisaną pozycją (`22. Inne wydatki` → 22.5; podpozycje 22.1-22.4 jako osobne kategorie w razie potrzeby). Dawny seed 9 kategorii systemowych (Czynsz i media, Materiały biurowe, Sprzęt biurowy, Wynagrodzenia, Transport / Paliwo, Komunikacja, Catering / Reprezentacja, Druk / Materiały promocyjne, Inne) z `20260507100000_init_office_expenses.sql` jest usuwany; ich wydatki przechodzą do kategorii numerycznej z tą samą pozycją sprawozdania (brak odpowiednika przy istniejących wydatkach = błąd migracji).

### `office_expenses`

Główny rejestr wydatków.

| Kolumna | Typ | Notes |
|---------|-----|-------|
| id | uuid PK | gen_random_uuid() |
| title | text NOT NULL | 2-200 znaków (CHECK) |
| description | text | |
| amount | numeric(12,2) NOT NULL | CHECK > 0 |
| category_id | int FK expense_categories | nullable |
| expense_date | date NOT NULL | |
| vendor | text | np. "ENEA SA" |
| invoice_number | text | np. "FV/2026/04/123" |
| payment_method | text | CHECK in ('przelew','karta','gotowka','inne'), nullable |
| receipt_path | text | path w bucketcie `receipts` (NIE URL) |
| receipt_mime | text | `application/pdf` / `image/*` |
| notes | text | wewnętrzne |
| missing_invoice_file | boolean GENERATED (stored) | `receipt_path is null` - brak pliku faktury/paragonu; tylko odczyt (MCP `budget_list` filtr + pole, `budget_get`) |
| created_by | uuid FK profiles | auto z auth.uid() przez trigger |
| created_at | timestamptz | |
| updated_at | timestamptz | |

**Indeksy:** `expense_date desc`, `category_id`, `created_at desc`, GIN `tsvector(title || description || vendor || invoice_number)`.

**Triggery:**
- `set_updated_at` (BEFORE UPDATE)
- `set_created_by` (BEFORE INSERT, fills auth.uid())
- `office_expenses_audit` (AFTER INSERT/UPDATE/DELETE → `expense.create` / `expense.update` / `expense.delete`)

---

## RLS

Wszystkie polityki mają `AND is_aal2()` (spójnie z innymi wrażliwymi tabelami po migracji `rls_aal2_hardening`).

| Tabela | SELECT | INSERT | UPDATE | DELETE |
|--------|--------|--------|--------|--------|
| `expense_categories` | active user | writer + non-system | poseł + non-system | poseł + non-system |
| `office_expenses` | active user | writer | writer | poseł |

---

## Storage bucket `receipts`

- Private (`public=false`).
- 5 MB limit, MIME: `application/pdf`, `image/jpeg`, `image/png`, `image/webp`.
- Path: `{user_id}/{timestamp}-{slugified-filename}.{ext}`.
- RLS:
  - SELECT: `is_authenticated_active() AND is_aal2()` (cały zespół widzi).
  - INSERT/UPDATE/DELETE w własnym folderze: `(storage.foldername(name))[1] = auth.uid()::text` + writer + aal2.
  - Poseł - dowolny folder.
- Frontend: `useReceiptSignedUrl(path, 3600)` przy podglądzie generuje 1h signed URL.
- Jeden plik = jeden wydatek: indeks unikalny `office_expenses_receipt_path_key` (`receipt_path`, `where receipt_path is not null`), migracja `20261107910000_receipts_integrity.sql`.
- Pliki starsze niż 7 dni bez wydatku (`receipts_orphan_objects(max_rows)`, tylko service_role) usuwa codziennie cron `/api/cron/poliai-purge` - m.in. upload_url z MCP bez podpięcia, porzucony formularz, plik po `budget_delete` przez MCP. Formularz aplikacji zapisuje zmianę pliku warunkowo (`useUpdateExpense` z `expectedReceiptPath`), żeby nie nadpisać pliku podpiętego w międzyczasie przez MCP.

---

## Hooki

```
src/hooks/
  useExpenses.ts
    - useExpenses(filters: { categoryId, dateFrom, dateTo, search })
    - useCreateExpense()
    - useUpdateExpense()
    - useDeleteExpense() — kasuje rekord + plik z bucketu
  useExpenseCategories.ts
    - useExpenseCategories()
    - useCreateExpenseCategory(name)
  useReceipts.ts
    - useUploadReceipt({ userId, file })  → { path, mime }
    - useDeleteReceipt(path)
    - useReceiptSignedUrl(path, expiresIn=3600)
```

**Query keys:**
- `['expenses', categoryId, dateFrom, dateTo, search]` (staleTime 30s, limit 500)
- `['expense-categories']` (staleTime 5 min)
- `['receipt-url', path, expiresIn]` (staleTime expiresIn-300s)

---

## Komponenty

```
src/components/expenses/
  MonthSelector.tsx          — prev/next + native month picker + "Bieżący miesiąc" + max=current
  BudgetProgressCard.tsx     — progress bar wg limitu (prop `budget`), semantyczne kolory, alert over-budget
  BudgetLimitDialog.tsx      — edycja limitu miesięcznego (Poseł/Administrator)
  ExpensesList.tsx           — karty z badge kategorii + kwota + akcje + podgląd skanu
  ExpensesFilters.tsx        — kategoria + search (date range usunięty - miesiąc wybiera selector)
  ExpenseFormDialog.tsx      — react-hook-form + Zod, upload paragonu w środku
  DeleteExpenseDialog.tsx    — confirm + kasacja pliku z bucketu
  AddExpenseCategoryDialog.tsx — szybkie dodanie non-system
  ReceiptUploadButton.tsx    — wgraj/zmień/usuń + podgląd
  ReceiptViewer.tsx          — Dialog z iframe (PDF) lub <img> (obrazy)

src/components/ui/progress.tsx  — primitives (div-based, BEZ Radix)
```

---

## lib/

```
src/lib/expenses.ts
  DEFAULT_MONTHLY_LIMIT_PLN = 25_000, MAX_MONTHLY_LIMIT_PLN = 1_000_000
  budgetSettingsSchema / parseBudgetSettings(value) — kształt app_settings.budget_settings
  PAYMENT_METHODS, PAYMENT_METHOD_LABELS
  formatPLN(amount)              — Intl.NumberFormat('pl-PL', PLN)
  formatPercent1(percent)        — "16,7%" (polski przecinek, 1 miejsce; KPI i analityka)
  slugifyExpenseCategory(name)
  slugifyReceiptFilename(file)
  RECEIPT_MAX_BYTES = 5 MB
  RECEIPT_ALLOWED_MIME
  isAllowedReceiptMime / isReceiptPdf
  // Helpery miesieczne (koszyk):
  currentMonthIso() / currentYearIso()
  parseYearMonth('YYYY-MM')
  monthRangeIso('YYYY-MM') -> { from, to }
  formatMonthLabel('YYYY-MM') -> 'maj 2026'
  shiftMonth('YYYY-MM', n)
  budgetUsagePercent(spent, budget) / budgetLevel(spent, budget)
```

---

## Strona

`src/pages/Budzet.tsx` — `/biuro/budzet`

**Sekcje:**
1. Header + akcja "Dodaj wydatek" (writer-only **i tylko gdy bieżący miesiąc**) + "Ustaw limit" (Poseł/Administrator).
2. `MonthSelector` (prev/next/picker/quick "Bieżący").
3. `BudgetProgressCard` z progress barem dla wybranego miesiąca (limit z `useMonthlyBudgetLimit`).
4. Dwie karty z dodatkowymi sumami: rok-do-daty wybranego roku + suma w aktualnym widoku z filtrami.
5. Komunikat "miesiąc archiwalny - read-only w UI" gdy nie bieżący (dla writer).
6. Filtry (kategoria + search).
7. Lista wydatków z miesiąca (limit 500, sortowanie expense_date desc).

**Sidebar:** Wallet icon, kolor `text-sky-600`, między Interpelacjami a Administracja.

---

## Analityka i raporty AI (2026-10-26)

Migracja `20261026200000_budget_analytics_reports.sql`.

**Widoki strony** (`?widok=`, przełącznik `BudgetViewTabs` obok `MonthSelector`, miesiąc wspólny; `?open=` zawsze pokazuje Wydatki):
- `Wydatki` (domyślny) - dotychczasowa lista (`WydatkiView` w `Budzet.tsx`).
- `Analityka` (`?widok=analityka`, `components/expenses/analytics/`) - KPI (do dziś vs poprzedni miesiąc do tego samego dnia, vs średnia 3 mies., prognoza końca miesiąca, rok-do-daty vs rok wcześniej), wykres 12 miesięcy w SVG z linią limitu (klik = wybór miesiąca), kategorie, top kontrahenci, sygnały: koszty stałe, możliwe duplikaty, nietypowo wysokie wydatki, opłaty/prowizje, drobne wydatki, kompletność dokumentacji, metody płatności.
- `Raporty AI` (`?widok=raporty`, `components/expenses/reports/`) - raporty miesiąca (najnowszy + historia), generowanie (Poseł/Administrator/Pracownik), usuwanie (Poseł/Administrator), linki do wydatków `?open=<id>`.

**Liczby w bazie:** `get_budget_analytics(p_month)` (authenticated, aktywny + aal2) / `service_budget_analytics(p_month)` (service_role), wspólny rdzeń `budget_analytics_core`. Wynik = `BudgetAnalytics` (`src/integrations/supabase/types.ts`). Bieżący miesiąc porównywany przez `current_to_date` (bez wydatków z datą przyszłą); prognoza = `max(suma, current_to_date / dni minione * dni miesiąca)`.

**Raport AI:** `POST /api/poliai?op=budget-report` (`api/_lib/poliai/budget-report.ts`): analityka + wydatki miesiąca i poprzedniego (maks. 400, pola przycięte) → główny model z Integracje → AI, structured outputs (`structuredOutput` w `anthropic.ts`, schemat `BUDGET_REPORT_SCHEMA` = `BudgetReportContent`: headline, summary, comparisons, insights, hidden_costs, recommendations, forecast), łagodna walidacja zod, `expense_ids` tylko z danych wejściowych. Wymuszone narzędzie odpada: `claude-sonnet-5-5` nie przyjmuje `tool_choice` "tool" ani thinking "disabled". Zapis w `budget_reports` z migawką analityki. Limit 20 raportów / 24 h / osoba (audyt `budget.report`).

**Tabela `budget_reports`:** `id`, `period` (YYYY-MM), `content jsonb`, `analytics jsonb`, `model`, `created_by`, `created_at`. RLS: select aktywny + aal2, delete Poseł + aal2, zapis tylko service_role. Audyt usunięcia `budget.report_delete`.

**Hooki:** `useBudgetAnalytics(month)` (`['budget-analytics', month]`, unieważniany po każdej zmianie wydatków), `useBudgetReports(month)` / `useGenerateBudgetReport()` / `useDeleteBudgetReport()` (`['budget-reports', ...]`).

---

## Podsumowanie i rozliczenie (2026-11-07)

Migracja `20261107300000_budget_settlement.sql`. Widok `?widok=rozliczenie` (`components/expenses/settlement/`), w nagłówku `YearSelector` zamiast `MonthSelector` (rok domyślnie bieżący, bez przyszłych lat).

**Formularz:** "Sprawozdanie z wydatkowania kwoty ryczałtu przeznaczonego na prowadzenie biura poselskiego" - załącznik nr 3 do zarządzenia nr 8 Marszałka Sejmu z 25.09.2001 (brzmienie z zarządzenia nr 11 z 30.12.2025). 22 pozycje; pozycja 22 "Inne wydatki" ma podpozycje 1-4 (art. spożywcze, kwiaty/wieńce, autostrady/parkingi, materiały patriotyczne) i pusty wiersz 5 = u nas `22.5` "Pozostałe". Lista pozycji (oficjalne brzmienie + skrót do selecta): `SETTLEMENT_ITEMS` w `src/lib/settlement.ts`.

**Przypisanie kategoria → pozycja:** `expense_categories.settlement_item`. Seed migracji: kategorie z numerem w nazwie ("16. Najem lokalu biura" → 16, "22. ..." → 22.5) i jednoznaczne systemowe (czynsz 16, materiały 20, sprzęt 19, wynagrodzenia 1, komunikacja 6, druk 7, inne 22.5); "Transport / Paliwo" i "Catering / Reprezentacja" celowo nieprzypisane. Zmiana: RPC `set_expense_category_settlement_item(p_category_id, p_item)` - Poseł/Administrator + aal2, także kategorie systemowe (polityka UPDATE je blokuje), pusty `p_item` = brak pozycji, audyt `expense_category.settlement` `{category_id, name, old, new}`.

**Liczby:** RPC `get_budget_year_summary(p_year)` (aktywny + aal2; rok 2000..bieżący) → `BudgetYearSummary`: okres 1 stycznia - dziś (Europe/Warsaw) dla bieżącego roku, inaczej 31 grudnia (wydatki z datą przyszłą pominięte), `total`, `count`, `missing_invoice_count` / `missing_invoice_total` (`missing_invoice_file`), sumy per `category_id` (null = bez kategorii), `fixed_assets` = wydatki kategorii z pozycją 19 (do wykazu). Hook `useBudgetYearSummary(year)` pod kluczem `['budget-analytics', 'rok', year]` - unieważniany po zmianie wydatków i po zmianie przypisania (`useSetCategorySettlementItem`). Agregacja pozycji w przeglądarce: `buildSettlement(categories, totals)` (sumy w groszach; pozycja 22 = suma 22.1-22.5; `unassigned` = kategorie bez pozycji + wydatki bez kategorii).

**Widok:** KPI (wydatki roku, ryczałt w okresie = limit miesięczny × liczba miesięcy do miesiąca końca okresu, pozostało, dokumenty bez faktury z kwotą), ostrzeżenie o nieprzypisanych wydatkach, lista wszystkich kategorii (kwota, udział, braki faktur, select pozycji dla Poseł/Administrator), podgląd tabeli formularza z kategoriami źródłowymi i "Razem".

**Sprawozdanie DOCX:** przycisk "Generuj sprawozdanie" (każdy z dostępem do budżetu) zablokowany, dopóki są nieprzypisane wydatki. `SettlementReportDialog`: imię i nazwisko (z `site_identity.mp_name`), nr legitymacji (do 3 cyfr w kratki), adres biura (biuro główne), pkt 1 (domyślnie ryczałt w okresie), pkt 2, pkt 3 (odsetki), miejscowość, data. `buildSettlementDocx(template, input)` (`src/lib/settlementDocx.ts`, `fflate` + DOMParser) wypełnia oficjalny szablon `src/assets/templates/sprawozdanie-ryczalt.docx` (plik Kancelarii Sejmu "ZMS2001008-ujed 26 załącznik nr 5"): akapity/komórki odnajdywane po tekstach formularza; pkt 4 = 1+2+3, "wydatkowano" = suma pozycji, "pozostało" = różnica. Wykaz składników majątkowych (pole tekstowe na stronie poziomej, w pliku 2× - DrawingML i VML) dostaje wiersze z `fixed_assets` (Lp., nazwa, data, nr dowodu, cena; nr fabryczny/ilość/miejsce puste); pole ma stałą wysokość (~14 wierszy, `INVENTORY_ROWS_CAPACITY`) - dialog ostrzega przy większej liczbie. Wynik pozostaje edytowalnym dokumentem Word (uwagi, poprawki przed podpisem). Zmiana formularza przez Kancelarię = podmiana pliku szablonu i ewentualnie tekstów-kotwic w `settlementDocx.ts` (generator rzuca błąd, gdy nie znajdzie wiersza/akapitu).

---

## Audit log

Eventy:
- `expense.create` — `{title, amount, expense_date}`
- `expense.update` — `{title, amount}`
- `expense.delete` — `{title, amount}`
- `expense_category.settlement` — `{category_id, name, old, new}` (zmiana pozycji sprawozdania)

---

## Decyzje świadomie pominięte (out of scope MVP)

- **Limit per kategoria** (np. 5 000 zł na czynsz, 2 000 zł na catering). Mamy jeden globalny limit miesięczny.
- **Limit per Poseł w jednej bazie.** Jedna instancja = jeden poseł - limit globalny w `app_settings.budget_settings`.
- **Forsowne blokowanie wydatkow w archiwalnych miesiącach.** UX guard ukrywa przycisk, ale RLS dopuszcza edycje (Poseł może retroaktywnie poprawić).
- **Carry-over niewykorzystanego limitu.** Każdy miesiąc resetuje się do limitu, niewykorzystane środki przepadają (zgodne z modelem ryczałtu).
- **Historia limitu per miesiąc.** Zmiana limitu działa wstecz na wszystkie widoki (poza raportami AI z migawką). Jeśli ryczałt zmieni się w ciągu roku i potrzebne będą stare wartości, dodamy `effective_from`.
- **Per biuro.** Globalny budżet Posła. Jeśli zajdzie potrzeba rozdzielenia (biuro główne vs filie), dodamy `office_id` + filtr.
- **Wpływy / refundacje.** Tylko strona kosztowa. Jeśli pojawi się potrzeba bilansowania, dorzucimy `expense_credits`.
- **Eksport PDF.** Druga iteracja (wykres trendu jest w widoku Analityka).
- **Captcha / OCR z faktury.** Brak.

---

## Historia zmian

| Data | Zmiana |
|------|--------|
| 2026-05-07 | Inicjalizacja Fazy 8 - migracja `20260507100000_init_office_expenses.sql` (PENDING APPLY), bucket receipts, FE pełen CRUD |
| 2026-05-07 | Koszyk miesięczny + limit 25 000 zł: `MONTHLY_BUDGET_PLN`, helpery `currentMonthIso/monthRangeIso/shiftMonth/formatMonthLabel/budgetUsagePercent`, `MonthSelector`, `BudgetProgressCard`, `Progress` primitive, refaktor Budzet.tsx (przycisk "Dodaj" tylko w bieżącym miesiącu). |
| 2026-10-26 | Analityka budżetu i raporty AI: widoki `?widok=analityka` / `?widok=raporty`, RPC `get_budget_analytics` / `service_budget_analytics`, tabela `budget_reports`, `POST /api/poliai?op=budget-report`. |
| 2026-10-26 | `office_expenses.missing_invoice_file` (kolumna generowana `receipt_path is null`, indeks częściowy; migracja `20261026220000_expenses_missing_invoice_file.sql`). MCP: `budget_list` zwraca pole i `missing_invoice_file_count`, filtr `missing_invoice_file`; `budget_get` zwraca pole. |
| 2026-11-07 | Limit miesięczny w bazie: migracja `20261107100000_budget_settings.sql` (`app_settings.budget_settings`, seed 25 000, SELECT aktywny + aal2, constraint kształtu), `useBudgetSettings`, `BudgetLimitDialog` ("Ustaw limit"), limit parametrem w komponentach analityki/raportów, `budget-report.ts` czyta limit z bazy i zapisuje go w migawce raportu. Usunięte `MONTHLY_BUDGET_PLN` (FE + API). |
| 2026-11-07 | MCP: dodawanie pliku faktury/paragonu do wydatku - `budget_receipt_upload_url` (signed upload URL, ścieżka `<user_id>/<timestamp>-<nazwa>` jak w aplikacji, ważny 2 h, jednorazowy, `if_blocked` z domeną dla sandboxa claude.ai) i `budget_receipt_attach` (plik we własnym folderze, typ z nagłówka PDF/JPG/PNG/WEBP zgodny z Content-Type z PUT i rozszerzeniem ścieżki, maks. 5 MB, odrzucony plik usuwany; podmiana istniejącego pliku tylko z `replace: true`, zapis warunkowy na `receipt_path` z chwili sprawdzenia, poprzedni plik usuwany; audyt z `path`/`previous`). Tylko kanał `/api/mcp`, tylko Poseł. Migracja `20261107910000_receipts_integrity.sql`: unikalny `receipt_path`, `receipts_orphan_objects` + sprzątanie w cronie `poliai-purge`. |
| 2026-11-07 | Podsumowanie i rozliczenie roku: widok `?widok=rozliczenie`, `expense_categories.settlement_item` + RPC `set_expense_category_settlement_item` / `get_budget_year_summary` (migracja `20261107300000_budget_settlement.sql`), generowanie sprawozdania z wydatkowania ryczałtu (DOCX z oficjalnego szablonu, zależność `fflate`), liczba dokumentów bez faktury w roku. |
| 2026-11-07 | Kategorie wydatków tylko numeryczne "01."-"22." (migracja `20261107850000_numeric_expense_categories.sql`): dopisane brakujące pozycje, wydatki z kategorii systemowych przeniesione wg pozycji sprawozdania, kategorie systemowe usunięte. |
| 2026-11-09 | Przegląd UI/UX (telefon, 1024, 1440, PoliAI 50%): zakładki widoków w siatce 2×2 na telefonie i z krótką etykietą "Rozliczenie" w wąskim module, `MonthSelector`/`YearSelector` na pełną szerokość wiersza, akcje nagłówka w jednej grupie (pełna szerokość na telefonie), kafelki KPI przechodzą do jednej kolumny przy powiększonym tekście, tabela kategorii analityki bez poziomego rozjechania na telefonie (zmiana pod kwotą), wiersz wydatku: data + kontrahent w jednej linii i kategoria pod spodem, przyciski 44 px, procenty "16,7%", etykieta "Rok RRRR narastająco". Poprawka: rok-do-daty liczony od `${currentYearIso()}-01-01` (wcześniej `toISOString()` w strefie +01:00 dawało 31 grudnia poprzedniego roku i podpis "Rok 2025"). |
