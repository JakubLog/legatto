# Supabase MCP - Źródło Wiedzy o Backendzie

> Kiedy potrzebujesz informacji o backendzie (DB, RLS, Edge Functions, Storage, Auth) - **ZAWSZE** korzystaj z Supabase MCP zamiast zgadywac.

---

## Reguła Główna: Supabase MCP jako Single Source of Truth

Gdy masz pytanie dotyczące backendu Supabase - **NIE opieraj się wyłącznie na dokumentacji w `ai-lib/context-map/`**. Dokumentacja może być nieaktualna. Supabase MCP daje Ci dostęp do **aktualnego stanu** bazy danych i konfiguracji.

---

## Kiedy MUSISZ użyć Supabase MCP

| Sytuacja | Co zrobić |
|----------|-----------|
| Sprawdzenie struktury tabeli | Odpytaj MCP o schemat tabeli |
| Sprawdzenie RLS policies | Zapytaj MCP o aktywne policies |
| Sprawdzenie istniejących funkcji SQL | Zapytaj MCP o definicje funkcji |
| Debugowanie błędów bazy | Użyj MCP do zapytań diagnostycznych |
| Weryfikacja danych | Użyj MCP do sprawdzenia stanu danych |
| Sprawdzenie konfiguracji Storage | Zapytaj MCP o buckety i policies |
| Sprawdzenie konfiguracji Auth | Zapytaj MCP o ustawienia auth |
| Tworzenie/modyfikacja migracji | Najpierw sprawdź aktualny stan przez MCP |

---

## Kiedy NIE musisz używać MCP

- Pisanie kodu frontend (komponenty, style, layout)
- Praca z context-map / dokumentacja
- Czysto klienckie zmiany (hooki, UI)
- Zmiana logiki w hookach (chyba ze potrzebujesz zweryfikować schemat)

---

## Workflow z MCP

### Przed zmiana w bazie:
1. **Sprawdź aktualny stan** przez Supabase MCP (schemat, RLS, funkcje)
2. Zaplanuj zmianę
3. Napisz migracje SQL (w `supabase/migrations/`)
4. Zweryfikuj wynik przez MCP

### Przy debugowaniu:
1. **Odpytaj MCP** o dane/schemat zamiast zgadywac
2. Sprawdź RLS policies jeśli problem dotyczy uprawnien
3. Sprawdź logi/błędy

---

## Priorytet źródeł wiedzy o backendzie

1. **Supabase MCP** (live data) - najwyższy priorytet, zawsze aktualny
2. **Kod źródłowy** (`src/integrations/supabase/`, `supabase/functions/`)
3. **ai-lib/context-map/infrastructure/** - kontekst i historia, może być nieaktualny

---

_Ostatnia aktualizacja: 2026-02-22_
