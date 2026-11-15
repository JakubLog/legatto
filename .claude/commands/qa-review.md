Wykonaj QA review kodu projektu OurMoney (Vite + React SPA + Supabase).

## Checklist

### 1. Architektura
- [ ] Pliki w poprawnych lokalizacjach (pages/, hooks/, components/, lib/)
- [ ] Hooki w src/hooks/ (nie w components/)
- [ ] Importy przez @/ alias (NIGDY relative ../../)
- [ ] Komponenty <150 linii (split jeśli większe)

### 2. TypeScript
- [ ] Zero `any` types (użyj `unknown` lub `z.infer<>`)
- [ ] Props = explicit interface
- [ ] Funkcje <50 linii (extract helpers)
- [ ] Brak unused imports/variables

### 3. Styling
- [ ] Tailwind classes (NIGDY hardcoded hex)
- [ ] Mobile-first: bazowe = mobile, `md:` = desktop
- [ ] cn() dla conditional styles
- [ ] Shadcn/UI dla UI primitives (sprawdź src/components/ui/)
- [ ] Touch targets min 44x44px

### 4. Data
- [ ] React Query z staleTime (WYMAGANE)
- [ ] Explicit kolumny w .select() (NIGDY select('*'))
- [ ] Zod validation na formularzach
- [ ] Error handling (try/catch, toast na błędy)
- [ ] Workspace-scoped queries (workspace_id)

### 5. Security
- [ ] Auth check na poczatku operacji (useAuth)
- [ ] Brak API keys w kodzie frontend
- [ ] Brak PII w console.log / PostHog
- [ ] Brak select('*') na sensitive data
- [ ] Edge Functions: auth + Zod validation

### 6. Testing & Quality
- [ ] `pnpm lint` PASS
- [ ] `pnpm build:dev` PASS
- [ ] Happy path + edge cases testowane
- [ ] Skeleton loading (nie spinnery)

### 7. i18n (wielojęzyczność)
- [ ] Brak hardcoded polskich/angielskich stringow w JSX → użyj `t('key')`
- [ ] Brak `{ locale: pl }` → użyj `getDateLocale(i18n.language)`
- [ ] Brak hardcoded `"zł"` → użyj `getCurrencySymbol()`
- [ ] Nowe user-facing stringi maja klucze w obu `src/i18n/locales/{pl,en}/*.json`
- [ ] Brak shadowing `t` w iteratorach (`.map(t =>` → `.map(tx =>`)
- [ ] Placeholdery formularzy przetłumaczone

### 8. Red Flags (STOP jeśli znalezione)
- TypeScript errors
- Hardcoded API keys / secrets
- Missing auth checks
- SQL injection vectors
- Missing RLS na nowych tabelach
- console.log z danymi użytkowników
- Hardcoded polskie stringi w nowym kodzie (brak i18n)

## Output
```
## QA Review Report

| Kategoria | Status | Uwagi |
|-----------|--------|-------|
| Architektura | OK/WARN/FAIL | ... |
| TypeScript | OK/WARN/FAIL | ... |
| Styling | OK/WARN/FAIL | ... |
| Data | OK/WARN/FAIL | ... |
| Security | OK/WARN/FAIL | ... |
| Testing | OK/WARN/FAIL | ... |

Red Flags: [none / lista]
Rekomendacje: [lista]
```
