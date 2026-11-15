# Feature: Sprawy wyborców (Faza 3)

> CRUD spraw z 5 statusami, 4 priorytetami, kategoriami (predefined + custom), opcjonalnym przypisaniem do kontaktu lub ad-hoc reporter.

## Cel

Rejestrowanie i obsługa spraw kierowanych do biura. Lista, filtrowanie po wielu wymiarach, formularz pełny.

## Role

- **Poseł** - pełne CRUD, w tym usuwanie i zarządzanie własnymi kategoriami. Zawsze widzi wszystkie sprawy.
- **Pracownik** - read + write (bez delete spraw, ale może tworzyć kategorie). Domyślnie widzi wszystkie sprawy; Poseł moze ograniczyć przez `profiles.scope_cases='own'` (wtedy widzi tylko `created_by = self` lub `assigned_to = self`).
- **Asystent** - read-only. Ten sam mechanizm scope co Pracownik.

## Statusy

| Wartość enum | Etykieta | Notes |
|--------------|----------|-------|
| `nowa` | Nowa | default |
| `w_toku` | W toku | aktywna obsługa |
| `oczekuje` | Oczekuje | np. czeka na odpowiedź urzędu |
| `załatwiona` | Załatwiona | trigger ustawia `resolved_at` |
| `odrzucona` | Odrzucona | trigger ustawia `resolved_at` |

## Priorytety

`low` / `normal` (default) / `high` / `urgent`

## Kategorie

10 systemowych (is_system=true, niemodyfikowalne):
Zdrowie, Edukacja, Infrastruktura, Podatki i finanse, Polityka społeczna, Rolnictwo, Bezpieczeństwo, Mieszkalnictwo, Obywatelska, Inne.

User-added (is_system=false): writer może dodawać (przez button "+ Dodaj kategorie" w formularzu sprawy lub przez AddCategoryDialog), Poseł może edytować/usuwać.

## Routing

| Ścieżka | Strona | Guard |
|---------|--------|-------|
| `/sprawy` | Sprawy | ProtectedRoute (any active) |

## Key Files

### Schema
- `supabase/migrations/20260425200000_init_cases.sql` - enum case_status/case_priority, tabele case_categories (z 10 wpisami seedu) + cases, triggery, RLS

### Frontend
- `src/lib/cases.ts` - labels, colors, helpery
- `src/hooks/useCaseCategories.ts` - useCaseCategories + useCreateCaseCategory
- `src/hooks/useCases.ts` - useCases(filters) + useCreateCase + useUpdateCase + useDeleteCase
- `src/pages/Sprawy.tsx`
- `src/components/cases/CasesFilters.tsx` - Select status/priorytet/kategoria/assigned + Input szukaj
- `src/components/cases/CasesList.tsx` - karty z badge statusu, klikalne na klik całej karty
- `src/components/cases/CaseFormDialog.tsx` - tylko nowa sprawa: tytuł, pasek chipów (przypisanie, termin, lokalizacja), status/priorytet/kategoria, opis i zgłaszający on-demand, załączniki przed zapisem (`PendingAttachmentsPicker`)
- `src/components/cases/CaseDetailsDialog.tsx` - podgląd edytowany w miejscu (`CaseProperties`, `CaseDescription`, `CaseInlineEditor`, `CaseReporterEditor`, `inlineEdit.ts`)
- `src/components/cases/CasesColumnsHeader.tsx` - nagłówek listy z filtrami/sortowaniem
- `src/components/cases/AddCategoryDialog.tsx` - mini-dialog dodawania kategorii
- `src/components/cases/DeleteCaseDialog.tsx` - potwierdzenie przeniesienia do kosza

## Triggery DB

- `set_updated_at` (BEFORE UPDATE)
- `set_created_by` (BEFORE INSERT - auto auth.uid())
- `cases_set_resolved_at` - auto-fill kiedy status → załatwiona/odrzucona, clear gdy status z powrotem aktywny
- `validate_case_gmina` - gmina musi należeć do powiatu (i wymaga powiat_id)
- `case_audit_trigger` - emituje:
  - `case.create` przy INSERT
  - `case.status_change` przy UPDATE gdzie status się zmienił (z metadata `from`/`to`)
  - `case.update` przy innych UPDATE
  - `case.delete` przy DELETE

## Filtrowanie (useCases)

```typescript
interface CasesFilters {
  status?: CaseStatus | 'open' | null; // 'open' = OPEN_CASE_STATUSES
  priority?: CasePriority | null;
  categoryId?: number | null;
  assignedTo?: string | null;
  source?: CaseSource | null;
  search?: string; // ilike na title || description (min 2 znaki)
}
```

Limit 200 wyników per query (paginacja w przyszłości). Sort: `created_at desc`.

## UX szczegóły

- Klik w wiersz (albo „Podgląd”) otwiera `CaseDetailsDialog`; osobnego trybu „Edytuj” nie ma. Osoba z prawem zapisu edytuje w miejscu: tytuł (Enter/wyjście zapisuje, Esc anuluje), status/priorytet/kategoria (menu, „Nowa kategoria”), termin (`MiniCalendar` w `ui/popover`), lokalizacja (powiat/gmina w popoverze), „Przypisana do” (otwiera `ReassignCaseDialog`), opis i notatki rozwiązania (`CaseInlineEditor`, Ctrl/⌘+Enter), osoba zgłaszająca (`CaseReporterEditor`, ta sama sekcja co w formularzu). Każda zmiana to osobny `useCasePatch(id).save(patch)` (toast przy błędzie); `useUpdateCase` czeka na odświeżenie listy, więc pole zamyka się już z nową wartością. Esc w polu edycji nie zamyka podglądu (`data-inline-edit`).
- Podgląd czyta sprawę przez `useCase(id)` - po zmianie statusu sprawa może wypaść z filtrowanej listy, a okno zostaje aktualne.
- Stopka podglądu: tylko „Usuń” (Poseł/administrator) - przenosi do kosza ([kosz.md](kosz.md)).
- Załączniki w podglądzie: kafelki obok siebie (zawijane), „Dodaj plik” jako ostatni kafelek; stan wczytywania i pusty mają wysokość jednego rzędu (bez przeskoku okna).
- Sprawy z `due_date` zaległym (gdy nie są rozwiązane) - "(zaległa)" przy terminie
- „Notatki rozwiązania” tylko gdy status = załatwiona/odrzucona
- Sprawa z formularza publicznego (`source='public_form'`) ma ikonę na liście + info-box w podglądzie ze zgodami marketingowymi zgłaszającego
- Lista: nagłówki kolumn (`CasesColumnsHeader`, od `@md`) - Status/Kategoria/Priorytet/Osoba otwierają filtr (te same co pigułki), Nazwa i Termin sortują po stronie klienta (`CasesSort`).
- Domyślne filtry (`defaultCasesFilters`): status `open` (bez załatwionych i odrzuconych); pracownik/asystent startują z „Moje sprawy” (= `assignedTo` = ja), Poseł/administrator bez filtra osoby.

## Publiczny formularz (Faza 7)

Formularz `#zglos` na stronie głównej `/` (PublicSubmissionForm) wstawia rekord do `cases` z:
- `source = 'public_form'`
- `status = 'nowa'`, `priority = 'normal'`
- `consent_newsletter`, `consent_contacts_db` (opcjonalne checkboxy w formularzu)
- `submission_ip_hash` (SHA-256 IP+salt - RODO; raw IP nie trafia do bazy)
- `submission_user_agent`

### Pola formularza
- Imię i nazwisko, e-mail LUB telefon, powiat, gmina (opcjonalnie), kategoria (tylko systemowe), tytuł, opis
- Zgoda RODO (wymagana)
- Zgoda na newsletter + SMS (opcjonalna)
- Zgoda na zapis do bazy kontaktów jako wyborca (opcjonalna)
- Honeypot `website` (hidden, jeśli wypełnione → cichy 200 OK bez insertu)
- Widget Cloudflare Turnstile (`src/components/public/TurnstileWidget.tsx`, klucz witryny `TURNSTILE_KEY`)

### Edge Function `public-submit-case`
Lokalizacja: `supabase/functions/public-submit-case/index.ts`. Wstawia przez service_role (anon i authenticated nie mają INSERT na cases z internetu - muszą przejść przez funkcję). Walidacja: typy i długości wszystkich pól, e-mail/telefon regex, e-mail LUB telefon, FK powiat/gmina/kategoria. Anti-spam: honeypot + Turnstile weryfikowany po stronie serwera (fail-closed, sprawdzany hostname) + rate limit 3/h po hashu IP, atomowo przez RPC `claim_public_submission_slot` (advisory lock, tabela `public_submission_attempts`). Wymagane secrets: `PUBLIC_SUBMISSION_IP_SALT`, `TURNSTILE_SECRET`.

### Filtrowanie w UI
Filtr "Źródło" w `CasesFilters`: `wszystkie / wewnętrzne / publiczne`. Badge "Publiczne" (niebieski) na kartach z source='public_form'.

## Załączniki

Wiele plików per sprawa, przechowywane w Storage buckecie `case-attachments` (prywatny, 10 MB).

### Tabela `case_attachments`
| Kolumna | Typ | Opis |
|---------|-----|------|
| `id` | uuid PK | |
| `case_id` | uuid FK → cases(id) | ON DELETE CASCADE |
| `storage_path` | text | ścieżka w buckecie: `{case_id}/{timestamp}-{random}.{ext}` |
| `filename` | text | oryginalna nazwa pliku (do wyświetlenia) |
| `mime_type` | text | |
| `size_bytes` | bigint | |
| `created_by` | uuid FK → auth.users | ON DELETE SET NULL; przy INSERT zawsze `auth.uid()`, przy UPDATE niezmienne (trigger `set_created_by`) |
| `created_at` | timestamptz | |

### RLS `case_attachments`
Widoczność załącznika wynika z widoczności sprawy nadrzędnej (RLS `cases` = `data_scope`).
- SELECT (`ca_select`): `is_authenticated_active() AND is_aal2()` + sprawa nadrzędna widoczna
- INSERT (`ca_insert`): `is_writer() AND is_aal2()` (pracownik + poseł) + sprawa widoczna + pierwszy segment `storage_path` = `case_id`
- DELETE: `is_posel() AND is_aal2()`
- Trigger `case_attachments_audit` (`case_attachment.create/update/delete`)

### Storage `case-attachments`
- INSERT (`case_attachments_upload`): `is_writer() AND is_aal2()` + pierwszy segment ścieżki = id widocznej sprawy
- SELECT (`case_attachments_read`): `is_authenticated_active() AND is_aal2()` + istnieje widoczny wiersz `case_attachments` wskazujący obiekt (Poseł także bez wiersza - do `storage.remove`); podgląd i pobieranie przez `storage.download` z tokenem sesji (bez signed URL)
- DELETE: `is_posel() AND is_aal2()`
- Bucket wymuszony migracją: prywatny, 10 MB, MIME PDF, JPG, PNG, WebP, DOC, DOCX, TXT

### Frontend
- `src/hooks/useCaseAttachments.ts` — `useCaseAttachments(caseId)`, `useUploadCaseAttachment`, `useDeleteCaseAttachment`, `fetchCaseAttachmentBlob` (zawartość do podglądu i zapisu)
- `src/components/cases/CaseAttachments.tsx` — lista + upload + podgląd (klik w nazwę / ikona oka) + pobieranie + delete (Poseł)
- `src/components/files/FilePreviewDialog.tsx` — podgląd w aplikacji: PDF (`PdfViewer.tsx`, pdf.js, leniwe rysowanie stron, zoom), JPG/PNG/WebP, TXT (UTF-8, fallback Windows-1250), DOCX (mammoth → HTML w `iframe sandbox` z CSP); DOC tylko pobranie. pdf.js i mammoth w osobnych chunkach. Pliki pomocnicze pdf.js (`/pdfjs/cmaps`, `/pdfjs/standard_fonts`, `/pdfjs/wasm/*_nowasm_fallback.js`) kopiuje plugin `pdfjsAssets` w `vite.config.ts`; `useWasm: false`, bo CSP nie ma `wasm-unsafe-eval`
- Załączniki istniejącej sprawy dodaje się i usuwa w podglądzie (`CaseAttachments`, kafelki); w `CaseFormDialog` (nowa sprawa) `PendingAttachmentsPicker`. Usunięty załącznik trafia do kosza, plik zostaje w storage do trwałego usunięcia ([kosz.md](kosz.md)).

## Historia sprawy i komentarze

Okno podglądu sprawy (`CaseDetailsDialog`) od `lg` ma dwie kolumny (`max-w-5xl`): lewa - szczegóły (własne przewijanie, stopka z akcjami), prawa - panel „Historia” (własne przewijanie, pole komentarza przypięte na dole). Poniżej `lg` (tablet, arkusz na telefonie) zakładki „Szczegóły / Historia” - w niskim arkuszu historia pod szczegółami wymagałaby przewinięcia całej sprawy; w zakładce „Historia” pole komentarza jest `sticky` na dole arkusza. Wysokość okna wynika z treści (`lg:max-h-[min(90vh,60rem)]`, `lg:min-h-[min(36rem,90vh)]`).

Animacja: okno trzyma ostatnio pokazaną sprawę podczas zamykania (stan `shown`), więc animacja wyjścia Radix (fade + zoom, na telefonie zjazd arkusza) gra z treścią. „Ograniczenie animacji” (`html.a11y-reduce-motion`) skraca ją globalnie do 0,01 ms. Każde otwarcie zaczyna od zakładki „Szczegóły”.

### Oś czasu
Jedna lista, najstarsze u góry, najnowsze na dole (jak czat; kolumna przewija się na dół po wczytaniu i po nowym wpisie), separatory dni („Dziś”, „Wczoraj”, data). Wpisy dziennika w formie bezosobowej (płeć autora nieznana): „Utworzono sprawę”, „Status: Nowa → W toku”, „Przypisanie: brak → Piotr …”, „Priorytet”, „Termin”, „Kategoria”, „Zmieniono tytuł/opis”, „Dodano/Usunięto załącznik”; pod spodem autor (`System`, gdy brak) i godzina. Komentarze: awatar, imię i nazwisko, godzina, treść z podświetlonymi `@Imię Nazwisko` (mocniej, gdy wzmianka dotyczy mnie), usuwanie z potwierdzeniem w miejscu (autor; Poseł/administrator - każdy). Odświeżanie: invalidacja `['case-history', caseId]` po dodaniu/usunięciu komentarza, `useUpdateCase` i zmianie załączników + realtime (`case_comments`, `case_activity` w publikacji `supabase_realtime`).

### Pole komentarza
`@` otwiera listę osób widzących sprawę (`get_assignable_users` ∩ `get_case_mentionable_users`, bez mnie), filtr wpisywanym tekstem bez polskich znaków, strzałki / Enter / Tab / Esc (Esc zamyka tylko listę: `DialogContent.onEscapeKeyDown` sprawdza `data-mention-open`). Ctrl/⌘+Enter wysyła, Enter = nowa linia. Wzmianki = osoby, których `@Imię Nazwisko` zostało w treści. Asystent widzi komunikat „tylko do odczytu”. Limit 4000 znaków (licznik od 3500).

### Schema (`20261111300000_case_history.sql`)
- `case_activity` (`case_id` CASCADE, `kind` CHECK: created/status/assigned/priority/due_date/category/title/description/attachment_added/attachment_removed, `data` jsonb z `from`/`to` (+ `from_name`/`to_name` - migawka nazw przy assigned/category, `source` przy created, `filename` przy załącznikach), `actor_id` → profiles SET NULL). Zapisują tylko triggery `cases_activity` (AFTER INSERT/UPDATE na `cases`) i `case_attachments_activity`; aktor = `auth.uid()`, przy zapisie serwisowym INSERT = `created_by`, UPDATE = NULL (jak `notifications_cases_trigger`). Backfill: utworzenie każdej sprawy + zmiany statusu/przypisania z `audit_log` (`case.status_change`, `case.reassign`).
- `case_comments` (`body` 1..4000 po przycięciu, `author_id`, `mentions uuid[]` ≤ 50). BEFORE INSERT `case_comments_prepare`: przycięcie, autor = sesja, czas serwera, wzmianki bez duplikatów, bez autora, tylko aktywne osoby widzące sprawę (`case_visible_to(case_id, user_id)` - ten sam predykat co RLS `cases`). Usuwanie twarde. Brak UPDATE.
- RLS: SELECT obu tabel `is_authenticated_active() AND is_aal2()` + widoczna sprawa nadrzędna; INSERT komentarza `is_writer() AND is_aal2()` + `author_id = auth.uid()` + widoczna sprawa; DELETE autor albo `is_posel()` + widoczna sprawa. `case_activity` bez zapisu dla klienta (tylko grant SELECT). anon/PUBLIC bez dostępu. Nazwiska/awatary przez embed `profiles` (RLS `profiles_select_self_or_team` - każdy aktywny użytkownik z aal2).
- AFTER INSERT `case_comments_after_insert`: `log_audit('case.comment', 'case', case_id, {comment_id})`, `notify()` `case_mention` dla wzmiankowanych i `case_comment` dla `assigned_to` + `created_by` (bez autora i wzmiankowanych); payload `{case_id, case_title, actor_name, excerpt ≤160, comment_id}`, dedupe `comment:<id>`; błąd powiadomienia tylko `raise warning`. AFTER DELETE: `case.comment_delete` (pomijane przy kaskadowym usunięciu sprawy).
- RPC `get_case_mentionable_users(case_id)` (authenticated): id aktywnych osób widzących sprawę, bez wywołującego; 42501, gdy wywołujący jej nie widzi.

### Frontend
- `src/hooks/useCaseHistory.ts` - `useCaseActivity`, `useCaseComments`, `useCaseMentionableUserIds`, `useCaseHistoryRealtime`, `useAddCaseComment`, `useDeleteCaseComment`, `invalidateCaseHistory`
- `src/lib/caseHistory.ts` - opisy wpisów, separatory dni, wykrywanie `@` przed kursorem, podział treści na wzmianki
- `src/components/cases/CaseHistoryPanel.tsx`, `CaseCommentComposer.tsx`

## Historia Zmian

| Data | Zmiana |
|------|--------|
| 2026-04-25 | Inicjalizacja Fazy 3 (cases + kategorie z seedem + UI + filtry) |
| 2026-04-26 | Faza 7.1: publiczny formularz na stronie głównej trafia bezpośrednio do `cases` (kolumna `source='public_form'`), zgody marketingowe (newsletter + baza wyborców) jako boolean kolumny. Filtr źródła w liście, badge "Publiczne" na kartach, info-box ze zgodami w dialogu edycji. Anti-spam: honeypot + rate limit 3/h po hashu IP. |
| 2026-05-07 | Per-user data scope dla spraw. Migracja `20260507000000_init_data_scope.sql`: `profiles.scope_cases` (enum data_scope, default 'all') + helper `current_cases_scope()` + recreate `cases_select_authenticated` z bypassem Posla i filtrem `created_by = self OR assigned_to = self` dla scope='own'. |
| 2026-05-07 | Załączniki do spraw. Bucket `case-attachments` (prywatny, 10 MB) + tabela `case_attachments` (wiele plików per sprawa, CASCADE DELETE). Sekcja załączników w `CaseFormDialog` (tylko tryb edycji). Migracja `20260507500000_init_case_attachments.sql` — PENDING APPLY. |
| 2026-05-08 | Uproszczenie `CaseFormDialog` (tryb create). Header: "Dodaj nową sprawę wyborcy" + "Opisz problem i wypełnij wymagane pola. Działamy!". Tytuł / status / priorytet w jednym rzędzie (grid 2fr/1fr/1fr). Opis i panel zgłaszającego ukryte za przyciskami `+ Dodaj…` (reveal on click). Kategoria zmieniona z opcjonalnej na **wymaganą** (zod `.positive('Wybierz kategorię')`). Panel zgłaszającego: wyszukiwarka kontaktów (≥2 znaki, użycie `useContacts({search})`) + lista wyników + tryb manualny (name/phone/email) + przycisk `+ Dodaj nowy kontakt` otwierający `ContactFormDialog` z nowym callbackiem `onCreated(contactId)` auto-przypisującym kontakt. Przypisanie i termin osadzone jako **chipy** w pasku nad stopką (`DropdownMenu` dla assignee, natywny `<input type="date">` w chipie dla terminu); lokalizacja (powiat/gmina) jako trzeci chip-toggle ujawniający select pod paskiem. Domyślnie status=`nowa`, priorytet=`normal`. Tylko frontend - schemat DB bez zmian. |
| 2026-05-08 | `CaseFormDialog`: avatary + załączniki przed zapisem. **Avatary**: chip przypisania, dropdown userów, lista wyników wyszukiwarki kontaktów i karta wybranego kontaktu używają `CreatorAvatar` (rozszerzony o `className`/`fallbackClassName`). Dla userów ładujemy `avatar_url` z rozszerzonego RPC `get_assignable_users` (migracja `20260508200000_get_assignable_users_avatar.sql` — **PENDING APPLY**); kontakty bez `avatar_url` w schemacie → fallback inicjały. **Załączniki w create**: nowy komponent `PendingAttachmentsPicker` (lokalny `File[]` state, walidacja MIME + 10 MB, X żeby usunąć przed zapisem). Przepływ submit: po `useCreateCase.mutateAsync` iterujemy `pendingFiles` przez `useUploadCaseAttachment.mutateAsync({caseId, file})`; partial failure → toast z licznikiem (sprawa zostaje zapisana). Edit dalej używa istniejącego `CaseAttachments`. |
| 2026-10-18 | Audyt bezpieczeństwa: `case_attachments` i bucket `case-attachments` w zakresie widocznych spraw (SELECT/INSERT wymagają widocznej sprawy nadrzędnej, ścieżka pliku w folderze tej sprawy), limity bucketu wymuszone, trigger audytu `case_attachments_audit`, `created_by` wymuszane przy INSERT i niezmienne przy UPDATE (także `cases`). Publiczny formularz: Cloudflare Turnstile (`TURNSTILE_SECRET_KEY`, `VITE_TURNSTILE_SITE_KEY`) + atomowy limit `claim_public_submission_slot` + walidacja wszystkich pól. Migracje `20261018200000_security_audit_settings_oauth.sql`, `20261018210000_security_profiles_storage.sql`. |
| 2026-10-26 | Podgląd załączników w aplikacji bez pobierania (`FilePreviewDialog`, `PdfViewer`): PDF przez pdf.js (działa też na Androidzie, skany JBIG2/CCITT/JPX przez dekodery JS), obrazy, TXT, DOCX (mammoth); DOC → komunikat + pobranie. Przycisk "Pobierz" zapisuje plik pod oryginalną nazwą (blob + `<a download>`) zamiast otwierać signed URL w nowej karcie. Zależności `pdfjs-dist`, `mammoth`. Bez zmian DB i CSP. |
| 2026-11-02 | **Przepisanie sprawy + pełny opis.** `CaseDetailsDialog`: ikona „Przepisz sprawę” przy „Przypisana do” (tylko writer) otwiera `ReassignCaseDialog` - wyszukiwarka + osoby pogrupowane po biurach (najpierw moje biuro, potem inne, na końcu bez biura), zapis przez `useUpdateCase({ assigned_to })`. Ta sama grupa biur w dropdownie `CaseFormPropertyBar` (`groupUsersByOffice` w `src/lib/assignableUsers.utils.ts`). Opis wydzielony do `CaseDescription`: zwinięty do 5 linii, „Pokaż więcej” rozwija cały opis w przewijanym obszarze (`max-h-80`). `Sprawy.tsx` podaje do podglądu świeży rekord z listy (po przepisaniu widać nową osobę). Migracja `20261102100000_case_reassign_offices.sql`: biuro w `get_assignable_users`, audyt `case.reassign`. |
| 2026-11-09 | **Przegląd UI/UX (telefon + komputer + PoliAI).** Pasek filtrów: wyszukiwarka w stylu chipów (h-8, zaokrąglona, na telefonie h-10/h-11), „Wyczyść” jak w Kontaktach; licznik + „Grupuj wg statusu” (przycisk outline jak „Pokaż mapę”) w osobnym, zawijanym rzędzie poniżej `@xl`. `CaseRow`/`CaseProperties`: kategoria i priorytet wyrównane do środka wiersza (flex zamiast inline-block na linii bazowej), węższa kolumna etykiet (7.5rem) - nazwisko przypisanej osoby się nie ucina; cele dotykowe 44 px (menu wiersza, przepisanie, załączniki - na telefonie podgląd przez klik w nazwę). `CaseDetailsDialog`: pojedynczy odstęp przycisków stopki. `CaseFormDialog`: status i priorytet obok siebie na telefonie, opis dostaje fokus tylko po „+ Opis sprawy” (edycja nie przewija już do opisu). |
| 2026-11-11 | **Historia sprawy + komentarze z @wzmiankami.** `CaseDetailsDialog`: animacja zamykania z treścią (ostatnia sprawa trzymana do końca animacji), od `lg` dwie kolumny (`max-w-5xl`) z panelem „Historia”, niżej zakładki „Szczegóły / Historia”. Oś czasu (dziennik + komentarze, najnowsze na dole), pole komentarza z listą `@` (klawiatura, Ctrl/⌘+Enter), usuwanie komentarzy, realtime. Migracja `20261111300000_case_history.sql`: `case_activity` (triggery na `cases`/`case_attachments`, backfill z `audit_log`), `case_comments` (RLS widocznej sprawy, writer-only INSERT, czyszczenie wzmianek), `case_visible_to`, `get_case_mentionable_users`, powiadomienia `case_mention`/`case_comment` przez `notify()`, audyt `case.comment`/`case.comment_delete`. Szczegóły: sekcja „Historia sprawy i komentarze”. |
| 2026-11-12 | **Edycja w podglądzie + kosz.** Bez trybu „Edytuj” i przycisku „Zamknij”: podgląd edytowany w miejscu (szczegóły w „UX szczegóły”), `CaseFormDialog` tylko dla nowej sprawy, nowy `ui/popover` (`@radix-ui/react-popover` 1.1.15). Załączniki jako kafelki obok siebie bez przeskoku przy wczytywaniu. Lista: filtr/sortowanie z nagłówków kolumn, domyślnie tylko otwarte, pracownik/asystent domyślnie „Moje sprawy”. Usunięcie sprawy, załącznika i komentarza przenosi do kosza (migracja `20261112100000_trash.sql`, [kosz.md](kosz.md)). |
