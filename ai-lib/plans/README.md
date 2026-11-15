# Plans - Konwencje

> Katalog na plany implementacyjne tworzone przez Claude Code.

---

## Konwencja Nazewnictwa

```
YYYY-MM-DD-krótki-opis.md
```

**Przykłady**:
- `2026-02-22-migracja-ai-lib.md`
- `2026-03-01-nowy-feature-budget.md`

---

## Szablon Planu

```markdown
# Plan: [Tytuł]

## Kontekst
[Dlaczego ta zmiana jest potrzebna? Jaki problem rozwiązuje?]

## Cel
[Co chcemy osiagnac? Jakie są kryteria sukcesu?]

## Zakres Zmian

### Pliki do utworzenia
- `ścieżka/plik.ts` - [opis]

### Pliki do modyfikacji
- `ścieżka/plik.ts` - [co się zmieni]

### Pliki do usunięcia (jeśli dotyczy)
- `ścieżka/plik.ts` - [dlaczego]

## Podejscie Techniczne
[Jak zamierzamy to zrobić? Jakie patterny/technologie?]

## Kolejność Implementacji
1. [krok 1]
2. [krok 2]
3. ...

## Wplyw na Istniejący Kod
[Co się może zepsuc? Jakie side-effects?]

## Weryfikacja
- [ ] [check 1]
- [ ] [check 2]

## Notatki
[Dodatkowe uwagi, pytania, alternatywne podejscia]
```

---

## Zasady

1. **Każdy nietrywialny task** powinien mieć plan przed implementacja
2. Plan jest **żywym dokumentem** - aktualizuj go w trakcie pracy jeśli się zmieni
3. Po zakończeniu implementacji plan pozostaje jako **dokumentacja historyczna**
4. Plany są **czytelne dla człowieka** - pisz jasno, bez zbędnego żargonu

---

_Ostatnia aktualizacja: 2026-02-22_
