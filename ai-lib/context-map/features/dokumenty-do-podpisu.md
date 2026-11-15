# Dokumenty do podpisu

## Cel

Biuro wgrywa pisma (PDF/DOCX) do podpisu przez Posła. Poseł pobiera je paczkami ZIP po 20 plików, podpisuje poza portalem (PAdES, XAdES, CAdES, ASiC) i wgrywa podpisane pliki. Podpisane pisma biuro wysyła poza portalem, a Poseł albo administrator oznacza je jako wysłane (`signing_mark_sent`).

## Obieg i statusy

`signing_documents.status` (text + CHECK):

| status | etykieta | przejście |
|---|---|---|
| `do_podpisu` | Do podpisu | wgranie przez piszącego |
| `pobrany` | Pobrany w paczce | `signing_create_batch` |
| `do_poprawy` | Do poprawy | `signing_return` (uwagi wymagane) |
| `podpisany` | Podpisany / „Gotowy do wysyłki” (`requires_signature=false`) | `signing_attach_signed` |
| `wyslany` | Wysłany | `signing_mark_sent` (`sent_manually = true`, `sent_at`, `sent_note`) |
| `anulowany` | Anulowany | `signing_cancel` |

Nowa wersja oryginału (`signing_replace_original`) podbija `current_version` i wraca do `do_podpisu`; podpis starszej wersji jest odrzucany (RPC i UI).

## Role i uprawnienia

- Widoczność: `signing_can_read(created_by)` = Poseł/administrator albo `scope_cases = 'all'` albo autor (zakres „Sprawy”, ADR 016, bez nowej kolumny).
- Tworzenie, edycja, nowa wersja: `is_writer()` (autor albo Poseł). Asystent tylko czyta. Autor (nie Poseł/administrator) edytuje dane dokumentu tylko w `do_podpisu`/`do_poprawy` (`canUpdateDocument` ukrywa „Edytuj”, RPC zwraca 42501 z polskim komunikatem pokazywanym w toaście).
- Zwrot, paczka, wgranie podpisu, oznaczenie wysłania, usunięcie: Poseł/administrator (`is_posel()`).

## Tabele

- `signing_documents` - kod `DP-000123` (sekwencja), tytuł, opis, adresat (`recipient_name`), temat i treść do wysyłki (`send_subject`, `send_text` ≤ 5000; pomoc przy ręcznej wysyłce), `case_id` → `cases`, `requires_signature`, status, `current_version`, `return_notes`, `due_date`, `last_batch_id`, `sent_manually`, `sent_at`, `sent_note`, znaczniki czasu.
- `signing_document_files` - `kind` (`oryginal` | `podpisany` | `podpis_zewnetrzny`), `version`, `storage_path` (unikalny), `sha256`, `is_current`; indeksy częściowe: jeden bieżący oryginał i najwyżej jeden bieżący plik podpisu.
- `signing_batches` (`PACZKA-000012`, 1..20 dokumentów) + `signing_batch_items` (`zip_name`, `position`).

## RLS

- Brak grantów INSERT/UPDATE/DELETE dla `authenticated` na tabelach modułu - zapis wyłącznie przez RPC SECURITY DEFINER z kontrolą roli, statusu, danych (ścieżka, rozszerzenie, MIME, rozmiar, SHA-256, istnienie obiektu w Storage) i blokadą wierszy.
- SELECT: aktywny + aal2 + `signing_can_read`; paczki tylko Poseł/administrator.

## Storage

- `signing-documents` (prywatny, 15 MB): `{document_id}/oryginal/v{n}-{file_id}.{ext}` (INSERT: piszący) i `{document_id}/podpisane/v{n}-{file_id}.{ext}` (INSERT: Poseł/administrator). Brak UPDATE/DELETE dla klienta; SELECT przez widoczny wiersz pliku.
- Rozszerzenia: oryginał `pdf, docx`; podpis `pdf, xml, xades, p7s, sig, p7m, asice, asics` (podpis zewnętrzny do 1 MB).
- Sprzątanie w cronie `poliai-purge`: `signing_purge_cancelled()` (pliki dokumentów anulowanych ponad 30 dni temu), sieroty `signing_orphan_objects()`.

## RPC

`signing_create_documents(p_items)`, `signing_update_document(p_id, p_patch)`, `signing_replace_original(p_id, p_file, p_note)`, `signing_return(p_ids, p_notes)`, `signing_cancel(p_id, p_reason)`, `signing_create_batch(p_document_ids)` (zwraca `zip_name` = `{code}_v{version}_{slug(title,60)}.{ext}`), `signing_attach_signed(p_items)` (wszystko albo nic), `signing_mark_sent(p_ids, p_sent_at, p_note)`, `signing_delete(p_id)`. Błędy: 42501 uprawnienia, 22023 dane, 55000 status.

## Paczki ZIP i wgrywanie podpisanych

- ZIP budowany w przeglądarce (`fflate`, bez kompresji, synchronicznie - CSP blokuje workery `blob:`), zaznaczenie > 20 dzielone na kolejne paczki od najstarszych; w paczce `_lista.txt`.
- Dopasowanie podpisanych (`src/lib/signingMatch.ts`): kod i wersja z nazwy (`^(DP-\d{6})_v(\d{1,3})_`, przetrwa sufiksy `-signed`, `.xades`), dla PDF prefiks SHA-256 z oryginałem, inaczej wybór ręczny. Kontrole: zawiera podpis (`/ByteRange` + `/Type /Sig`, xmldsig), treść zgodna z oryginałem, nieaktualna wersja (blokuje), zastąpienie podpisu. Można wgrać `.zip` (do 40 pozycji, 300 MB).
- Walidacja kryptograficzna podpisu poza zakresem.

## Powiadomienia

Kategoria `dokumenty`: `signing_request` (Poseł/administrator), `signing_decision` (autor: `do_poprawy` / `podpisany` / `wyslany`). Szczegóły: [powiadomienia.md](powiadomienia.md).

## Frontend

- Trasy: `/biuro/dokumenty` (`src/pages/Dokumenty.tsx`, widoki `?widok=do-podpisu|podpisane|wyslane|wszystkie`, pasek „Wymaga działania”, zaznaczanie hurtowe), `/biuro/dokumenty/:id` (`src/pages/DokumentDetail.tsx`: pliki i wersje, akcje, historia).
- Komponenty: `src/components/signing/*` (lista, dialogi wgrania, podpisanych, zwrotu, anulowania, oznaczenia wysyłki `MarkSentDialog`).
- Hooki: `useSigningDocuments`, `useSigningFiles` (klucze `['signing-documents', …]`, `['signing-document', id]`).
- lib: `signing.ts` (typy, etykiety, uprawnienia), `signingZip.ts`, `signingMatch.ts`.

## Audit log

`signing.create|update|replace|return|cancel|batch_download|sign_upload|mark_sent|delete|purge_cancelled`. Metadane bez treści pism.

## Decyzje świadomie pominięte

- Walidacja kryptograficzna podpisów, podpis w aplikacji, konwersja DOCX → PDF.
- Wysyłka pism z portalu, śledzenie statusu przesyłek i odpowiedzi urzędów.
- Narzędzia MCP dla modułu.

## Historia zmian

| Data | Zmiana |
|---|---|
| 2026-11-11 | Moduł: migracja `20261111100000_signing_documents.sql`, `api/sync-ics.ts` → `api/integracje.ts`. |
| 2026-11-15 | Bez integracji wysyłki: statusy `wysylanie`, `odpowiedz` i statusy potwierdzenia odbioru, kolumny `recipient_ade` / `delivered_at` / `replied_at` i rodzaj powiadomienia `signing_reply` usunięte; wysyłka tylko ręcznie (`signing_mark_sent`). |
