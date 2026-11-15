# AI-Lib Workflow Rules

> Reguły pracy z systemem ai-lib: plany, context-map, zarządzanie wiedza.

---

## Reguła 1: Plany zawsze w `ai-lib/plans/`

Kiedy tworzysz plan implementacji (EnterPlanMode lub ręcznie):
- **ZAWSZE** zapisuj plan w `ai-lib/plans/YYYY-MM-DD-krótki-opis.md`
- Użyj szablonu z `ai-lib/plans/README.md`
- Plan jest częścią repozytorium i historii projektu

---

## Reguła 2: Konsultuj Context Map przed praca

Przed rozpoczęciem implementacji:
1. Przeczytaj `ai-lib/context-map/INDEX.md` - przejrzyj Feature Registry i ostatnie zmiany
2. Przeczytaj relevantne pliki z `features/` i `infrastructure/` - zrozum istniejący kontekst
3. Sprawdź czy istnieją powiązane plany w `ai-lib/plans/`

---

## Reguła 3: Aktualizuj Context Map po zmianach

Po zakończeniu implementacji która zmienia funkcjonalność projektu:

### Kiedy aktualizować:
- Dodanie nowej feature → dodaj wpis w INDEX.md Feature Registry + nowy plik w `features/`
- Zmiana istniejącego feature → aktualizuj odpowiedni plik w `features/`
- Zmiana schematu DB → aktualizuj `infrastructure/database.md`
- Nowy endpoint API / hook → aktualizuj `infrastructure/api.md`
- Zmiana storage → aktualizuj `infrastructure/storage.md`
- Decyzja architektoniczna → dodaj ADR w INDEX.md

### Co aktualizować:
1. **INDEX.md** - Log Ostatnich Zmian (zawsze), Feature Registry (jeśli nowa feature)
2. **Relevantny feature doc** - sekcja Historia Zmian + dotknięty obszar
3. **Relevantny infrastructure doc** - jeśli zmiana dotyczy DB/API/Storage

### Kiedy NIE aktualizować:
- Poprawka typo w kodzie
- Zmiana stylowania (CSS)
- Refactoring który nie zmienia zachowania
- Aktualizacja dependencies

---

## Reguła 4: Skill `/commit` obsługuje aktualizacje

Używaj `/commit` zamiast ręcznego commitowania. Skill automatycznie:
1. Sprawdza co się zmieniło (git diff)
2. Ocenia czy context-map wymaga aktualizacji
3. Aktualizuje relevantne pliki context-map
4. Commituje zmiany z odpowiednim komunikatem

---

## Struktura ai-lib/

```
ai-lib/
  context-map/
    INDEX.md              ← Główny spis treści (czytaj ZAWSZE)
    app-context.md        ← Kontekst biznesowy, persony, user journeys
    security-rules.md     ← Reguły bezpieczeństwa (20+ reguł)
    features/             ← Dokumentacja per feature (15 plików)
      auth.md, budget.md, commitments.md, dashboard.md,
      history.md, income.md, investments.md, notifications.md,
      onboarding.md, partner-system.md, savings.md, settings.md,
      analytics.md, landing-waitlist.md
    infrastructure/       ← Dokumentacja infrastruktury
      database.md         ← 21 tabel, widoki, RPC, enumy, RLS
      api.md              ← 9 Edge Functions, hooki, routing
      storage.md          ← Supabase Storage (avatars)
      analytics.md        ← PostHog: 39 eventow, konfiguracja, privacy
  plans/                  ← Plany implementacyjne
    README.md             ← Konwencje i szablon
    YYYY-MM-DD-opis.md    ← Poszczególne plany
```

---

_Ostatnia aktualizacja: 2026-02-22_
_Wersja: 1.0.0 - Migracja na OurMoney_
