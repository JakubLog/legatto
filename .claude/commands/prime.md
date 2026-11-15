Załaduj pełny kontekst projektu Legatto przed rozpoczęciem pracy.

1. Przeczytaj `ai-lib/context-map/INDEX.md` (Feature Registry, ADRs, Log Zmian)
2. Przeczytaj relevantne pliki z `ai-lib/context-map/features/` - te które dotyczą Twojej pracy
3. Przeczytaj `ai-lib/context-map/infrastructure/` jeśli praca dotyczy DB/API/Storage
4. Przeczytaj `ai-lib/context-map/security-rules.md` jeśli dotykasz auth/inputów/API/danych osobowych
5. `git status --short` + `git log --oneline -5`

## Checklist przed kodowaniem
- [ ] Wiem jakie pliki będę modyfikować (Key Files z feature doc)
- [ ] Rozumiem istniejące patterny (hooki, konteksty, komponenty)
- [ ] Sprawdziłem reguły bezpieczeństwa (jeśli dotyczy)
- [ ] Nie wprowadzam danych konkretnego posła/biura do kodu (ADR 026)
- [ ] Wiem jak przetestować zmianę

Output:
> Primed. Context-map: [X features] | Infrastructure: [loaded/skipped] | Security: [loaded/skipped]
> Branch: [nazwa] | Last: [hash] [msg]
> Ready.
