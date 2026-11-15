Wykonaj przegląd konfiguracji i danych PostHog dla projektu OurMoney. Wygeneruj raport z uwagami i sugestiami.

## Flow

### 1. Kontekst projektu
Przeczytaj:
- `src/lib/posthog.ts` - konfiguracja PostHog
- `src/lib/analytics.ts` - trackFeature(), trackError(), identifyUser()
- `src/hooks/usePostHogPageview.ts` - auto pageview
- `src/hooks/usePostHogIdentify.ts` - auto identify

### 2. Dane z PostHog MCP
Użyj PostHog MCP aby zebrać dane. Wykonaj równolegle gdzie możliwe:

#### a) Organizacja i projekt
- `organizations-get` - sprawdź organizacje
- `projects-get` - sprawdź aktywny projekt

#### b) Eventy i definicje
- `event-definitions-list` - lista zdefiniowanych eventow
- `properties-list` - lista properties

#### c) Feature flags
- `feature-flag-get-all` - aktywne feature flags

#### d) Dashboardy i insighty
- `dashboards-get-all` - lista dashboardów
- `insights-get-all` - lista insightow

#### e) Kohorty i akcje
- `cohorts-list` - lista kohort
- `actions-get-all` - lista akcji

#### f) Ankiety
- `surveys-get-all` - aktywne ankiety
- `surveys-global-stats` - statystyki ankiet

#### g) Eksperymenty
- `experiment-get-all` - lista eksperymentów

#### h) Error tracking
- `error-tracking-issues-list` - lista błędów (jeśli dostępne)

#### i) Analiza kosztów
- `get-llm-total-costs-for-project` - koszty LLM (jeśli używane)

### 3. Audyt kodu vs PostHog
Użyj Grep aby przeszukać codebase:
- Wszystkie wywołania `posthog.capture(` - lista eventow wysyłanych z kodu
- Wszystkie wywołania `trackFeature(` - lista feature events
- Wszystkie wywołania `trackError(` - lista error events
- Wszystkie wywołania `posthog.register(` - super properties
- Szukaj `console.log` z danymi PII w kontekście PostHog

### 4. Analiza i raport
Porównaj dane z MCP z kodem i wygeneruj raport.

## Checklist analizy

### Konfiguracja
- [ ] autocapture OFF (privacy-first)
- [ ] capture_pageview OFF (manual tracking)
- [ ] session_recording.maskAllInputs: true
- [ ] persistence poprawna
- [ ] API host EU (eu.i.posthog.com)
- [ ] Brak debug: true w produkcji
- [ ] Brak console.log z PostHog w produkcji

### Eventy
- [ ] Naming: snake_case
- [ ] Brak PII (emaile, imiona, exact kwoty)
- [ ] Kwoty jako ranges (getAmountRange)
- [ ] Eventy z kodu maja definicje w PostHog
- [ ] Brak orphaned events (w PostHog ale nie w kodzie)
- [ ] Brak duplikatów eventow

### Feature Flags
- [ ] Aktywne flagi maja sens
- [ ] Brak starych/nieużywanych flag
- [ ] Flagi używane w kodzie

### Dashboardy & Insighty
- [ ] Istnieją kluczowe dashboardy
- [ ] Insighty pokrywają kluczowe metryki
- [ ] Brak pustych/zepsutych insightow

### Kohorty & Akcje
- [ ] Kohorty są aktualne
- [ ] Akcje odpowiadają celom biznesowym

### Privacy & Security
- [ ] Brak PII w event properties
- [ ] Brak exact kwot (użyj ranges)
- [ ] maskAllInputs w session recording
- [ ] Brak user emails/names w properties
- [ ] GDPR compliance (EU hosting)

## Output

Zapisz raport do `ai-lib/posthog-reviews/YYYY-MM-DD-review.md` z aktualną datą.

Format raportu:
```markdown
# PostHog Review - YYYY-MM-DD

## Podsumowanie
[Krótkie podsumowanie stanu PostHog - 2-3 zdania]

## Statystyki
| Metryka | Wartość |
|---------|---------|
| Zdefiniowane eventy | N |
| Feature flags | N |
| Dashboardy | N |
| Insighty | N |
| Kohorty | N |
| Akcje | N |
| Ankiety | N |
| Eksperymenty | N |

## Konfiguracja
| Check | Status | Uwagi |
|-------|--------|-------|
| autocapture OFF | OK/WARN | ... |
| session recording masking | OK/WARN | ... |
| EU hosting | OK/WARN | ... |
| debug mode | OK/WARN | ... |
| ... | ... | ... |

## Eventy - Audit
### Eventy w kodzie
[Lista eventow znalezionych w kodzie z plikami źródłowymi]

### Eventy w PostHog
[Lista eventow zdefiniowanych w PostHog]

### Rozbieżności
[Eventy w kodzie ale nie w PostHog i odwrotnie]

## Feature Flags
[Status flag, uwagi o nieużywanych]

## Dashboardy & Insighty
[Przegląd, braki, sugestie]

## Privacy & Security
| Check | Status | Uwagi |
|-------|--------|-------|
| Brak PII | OK/WARN/FAIL | ... |
| Amount ranges | OK/WARN/FAIL | ... |
| Input masking | OK/WARN/FAIL | ... |
| EU hosting | OK/WARN/FAIL | ... |

## Uwagi i problemy
[Lista problemów znalezionych podczas review, posortowana wg severity]

## Sugestie
[Lista sugestii do poprawy, posortowana wg priorytetu]
- [ ] Sugestia 1
- [ ] Sugestia 2
- ...
```

Po zapisaniu raportu, wyświetl użytkownikowi krótkie podsumowanie z najważniejszymi findings.
