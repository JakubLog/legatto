Wykonaj inteligentny commit z automatyczna aktualizacja context-map.

## Flow

### 1. Review zmian
- `git diff --name-only` → lista zmienionych plików
- `git diff --staged` → co już staged

### 2. Opcjonalny QA (flaga `--qa`)
Jeśli uruchomiono z `--qa`:
- `pnpm lint` → STOP jeśli fail
- `pnpm build:dev` → STOP jeśli fail
- Quick security check (select('*'), hardcoded secrets, brak auth)
- i18n check (patrz krok 2b)

### 2b. i18n double-check (ZAWSZE)
Sprawdź czy zmienione pliki .tsx zawierają:
- Hardcoded polskie/angielskie stringi w JSX (powinny używać `t('key')`)
- Hardcoded `{ locale: pl }` lub `'pl-PL'` (powinno być `getDateLocale(i18n.language)`)
- Hardcoded `"zł"` / `"$"` / `"€"` (powinno być `getCurrencySymbol()`)
- Shadowing zmiennej `t` w iteratorach (`.map(t =>` zamiast `.map(tx =>`)
- Nowe user-facing stringi bez kluczy w `src/i18n/locales/{pl,en}/*.json`
Jeśli znaleziono → napraw PRZED commitem.

### 3. Ocena context-map
Sprawdź czy zmiany wymagają aktualizacji `ai-lib/context-map/`:
- Nowy feature → dodaj wpis w INDEX.md + nowy plik w features/
- Zmiana istniejącego feature → aktualizuj feature doc (Historia Zmian)
- Zmiana DB → aktualizuj infrastructure/database.md
- Nowy endpoint/hook → aktualizuj infrastructure/api.md
- Zmiana storage → aktualizuj infrastructure/storage.md

**NIE aktualizuj** przy: typo, CSS, refactoring bez zmiany zachowania, update deps

### 4. Aktualizacja context-map (jeśli potrzebna)
- Zaktualizuj relevantne pliki w ai-lib/context-map/
- Dodaj wpis w Log Ostatnich Zmian w INDEX.md

### 5. Stage & Commit
- `git add [konkretne pliki]` (NIGDY `git add -A` ani `git add .`)
- Conventional Commit via HEREDOC:
```bash
git commit -m "$(cat <<'EOF'
type(scope): description

EOF
)"
```
- Types: feat, fix, refactor, test, chore, docs, perf

### 6. Weryfikacja
- `git status` → upewnij się ze commit poszedł
- `git log --oneline -1` → pokaż commit

## Ważne
- NIGDY nie pushuj bez explicit prosb użytkownika
- NIGDY nie użyj `git add -A` - staguj konkretne pliki
- ZAWSZE tworzr NOWY commit (nie amend, chyba ze user prosi)
- NIGDY nie commituj .env ani credentials
- Flaga `--no-context` pomija aktualizacje context-map

## Raport
```
## Commit Report
| Step | Status |
|------|--------|
| QA | PASS / Skipped |
| Context-map | Updated [pliki] / No update needed |
| Commit | type(scope): message [hash] |
```
