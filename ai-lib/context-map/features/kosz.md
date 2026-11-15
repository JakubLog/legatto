# Kosz

> Usunięte rekordy przez 7 dni czekają w koszu z możliwością przywrócenia, potem znikają trwale razem z plikami.

## Zakres

| Encja (`entity`) | Tabela | Razem z rodzicem (kaskada) | Pliki |
|---|---|---|---|
| `case` | `cases` | `case_attachments`, `case_comments`, `case_activity` | `case-attachments` |
| `case_attachment` | `case_attachments` (też samodzielnie) | - | `case-attachments` |
| `case_comment` | `case_comments` (też samodzielnie) | - | - |
| `contact` | `contacts` | - | - |
| `interpellation` | `interpellations` | `interpellation_duration_samples` | - |
| `expense` | `office_expenses` | - | `receipts` (`receipt_path`) |
| `budget_report` | `budget_reports` | - | - |
| `signing_document` | `signing_documents` | `signing_document_files`, `signing_batch_items` | `signing-documents` |

Poza koszem (usuwane od razu): wydarzenia kalendarza, źródła ICS, rozmowy PoliAI, tokeny MCP, konta użytkowników, sprzątanie systemowe (`signing_purge_cancelled` ustawia `eposel.trash_skip`).

## Model (migracja `20261112100000_trash.sql`, APPLIED 2026-11-12)

- Usunięcie zostaje zwykłym `DELETE` (klient, MCP, `signing_delete`). Wyzwalacz `trash_capture` (BEFORE DELETE) zapisuje migawkę wiersza do `trash_items` (`row_data`, `row_key`). Dlatego odczyty (listy, RLS, RPC, MCP, PoliAI, puls) nie wymagają filtra `deleted_at`.
- Grupa (`group_id`): rekord usunięty bezpośrednio (`is_root`) + dzieci usunięte kaskadą w tej samej transakcji (`tx_id`). Przywraca się i usuwa trwale całą grupę.
- Odpięcia `on delete set null` (np. `events.case_id`, `cases.contact_id`, `signing_documents.case_id`) zapisują się w `relinks` i wracają przy przywróceniu, jeśli wiersz nadal istnieje i nie dostał innej wartości.
- Przywrócenie wstawia wiersze z migawki z GUC `eposel.trash_restoring`; wszystkie wyzwalacze użytkownika na tabelach kosza i tabelach z odpięciami mają `when (not public.trash_restoring())` (nie nadpisują autora, nie dublują audytu, historii ani powiadomień). **Nowy wyzwalacz na tych tabelach:** na końcu migracji `select public.trash_guard_triggers();`.
- Konfiguracja tabel: `trash_entities` (kolejność przywracania, rodzic, czy może być samodzielną pozycją, kolumna pliku).
- Pliki zostają w storage, dopóki pozycja jest w koszu: `case_attachments_orphan_objects`, `receipts_orphan_objects`, `signing_orphan_objects` pomijają ścieżki z `trash_items.storage_objects`. Klient nie usuwa już plików przy usuwaniu załącznika ani wydatku.
- Retencja: pg_cron `trash-retention` (`0 3 * * *`) usuwa pozycje po `purge_after` (7 dni); pliki usuwa nocny cron `poliai-purge` (03:30) jak każde sieroty.

## Uprawnienia (RPC, sesja aal2)

- `trash_list()` - Poseł/administrator: wszystkie pozycje; pozostali: usunięte przez siebie (`deleted_by = auth.uid()`). Usunięcia przez MCP/service role mają `deleted_by = null` - widzi je tylko Poseł/administrator.
- `trash_restore(p_group_id)`, `trash_restore_row(p_entity, p_row_id)` („Cofnij” w toaście) - ten sam zakres co lista.
- `trash_purge(p_group_id)`, `trash_empty()` - tylko Poseł/administrator.
- `trash_items`/`trash_entities`: RLS bez polityk, bez grantów dla `authenticated`.
- Audyt: `trash.restore`, `trash.purge`, `trash.empty` (usunięcie nadal loguje `*.delete`).
- Błędy przywracania: `23503` (np. załącznik sprawy, która sama jest w koszu - najpierw przywróć sprawę), `23505` (rekord o tym id już istnieje).

## UI

- `/biuro/kosz` (`src/pages/Kosz.tsx`), pozycja „Kosz” w menu każdej roli (`TRASH_NAV_ITEM` w `navigation.ts`).
- Lista: rodzaj, tytuł, kontekst, kto i kiedy usunął, ile dni do trwałego usunięcia, liczba powiązanych rekordów i plików; filtr rodzaju; „Przywróć”; dla Posła/administratora „Usuń trwale” i „Opróżnij kosz” z potwierdzeniem.
- `src/hooks/useTrash.ts`: `useTrash`, `useRestoreTrash`, `usePurgeTrash`, `useEmptyTrash`, `useMovedToTrashToast` (toast „Przeniesiono do kosza” + „Cofnij”), `TRASH_ENTITY_LABELS`.
- Okna usuwania spraw, kontaktów (też zbiorczo), interpelacji, wydatków, raportów AI i dokumentów mówią „Przenieś do kosza”; usunięcie załącznika i komentarza sprawy też trafia do kosza.

## Ograniczenia

- Przywrócenie nie dopisuje wpisu do historii sprawy (`case_activity`) - zostaje wpis „Usunięto załącznik”; audyt ma `trash.restore`.
- Kontakt zsynchronizowany z GetResponse: usunięcie/przywrócenie nie zmienia GetResponse.
