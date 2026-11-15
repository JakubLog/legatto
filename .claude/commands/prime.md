Załaduj pełny kontekst projektu OurMoney przed rozpoczęciem pracy.

1. Przeczytaj `ai-lib/context-map/INDEX.md` (Feature Registry, ADRs, Log Zmian)
2. Przeczytaj relevantne pliki z `ai-lib/context-map/features/` - te które dotyczą Twojej pracy
3. Przeczytaj `ai-lib/context-map/infrastructure/` jeśli praca dotyczy DB/API/Storage
4. Przeczytaj `ai-lib/context-map/infrastructure/analytics.md` jeśli dotykasz trackingu/eventow/PostHog
5. Przeczytaj `ai-lib/context-map/security-rules.md` jeśli dotykasz auth/inputow/API/danych użytkowników
6. `git status --short` + `git log --oneline -5`

## Checklist przed kodowaniem
- [ ] Wiem jakie pliki będę modyfikować (Key Files z feature doc)
- [ ] Rozumiem istniejące patterny (hooki, konteksty, komponenty)
- [ ] Sprawdziłem reguły bezpieczeństwa (jeśli dotyczy)
- [ ] Sprawdziłem analytics doc jeśli dodaje/zmieniam user-facing akcje
- [ ] Wiem jak przetestować zmianę

Output:
> Primed. Context-map: [X features] | Infrastructure: [loaded/skipped] | Analytics: [loaded/skipped]
> Branch: [nazwa] | Last: [hash] [msg]
> Ready.
