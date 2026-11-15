Wykonaj QA review kodu projektu Legatto (Vite + React SPA + Supabase + Vercel Functions).

## Checklist

### 1. Architektura
- [ ] Pliki w poprawnych lokalizacjach (pages/, hooks/, components/, lib/)
- [ ] Hooki w src/hooks/ (nie w components/)
- [ ] Importy przez @/ alias (NIGDY relative ../../)
- [ ] Nowe strony lazy-loaded w `App.tsx`

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
- [ ] Container queries (`@md:`) w modułach, które bywają wąskie

### 4. Data
- [ ] React Query z staleTime (WYMAGANE)
- [ ] Explicit kolumny w .select() (NIGDY select('*'))
- [ ] Zod validation na formularzach
- [ ] Error handling (try/catch, toast na błędy)
- [ ] Uprawnienia: role + `data_scope`; na service_role (`api/`, Edge Functions) jawnie rola i aal2

### 5. Security
- [ ] Auth check na poczatku operacji (useAuth)
- [ ] Brak API keys w kodzie frontend
- [ ] Brak PII (e-maile, imiona, dane wyborców) w `console.*`
- [ ] Brak select('*') na sensitive data
- [ ] Edge Functions: auth + Zod validation

### 6. Quality
- [ ] `pnpm exec tsc -b` PASS
- [ ] `pnpm lint` PASS
- [ ] `pnpm build:dev` PASS
- [ ] Smoke test zmienionej ścieżki (happy path + edge cases)
- [ ] Skeleton przy wczytywaniu list i kart

### 7. Dane instancji
- [ ] Brak danych konkretnego posła/biura w kodzie, migracjach i dokumentacji (ADR 026)
- [ ] Nowe treści widoczne publicznie pochodzą z `app_settings` / panelu

### 8. Red Flags (STOP jeśli znalezione)
- TypeScript errors
- Hardcoded API keys / secrets
- Missing auth checks
- SQL injection vectors
- Missing RLS na nowych tabelach
- console.log z danymi użytkowników
- Dane konkretnego posła/biura w repozytorium

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
| Quality | OK/WARN/FAIL | ... |
| Dane instancji | OK/WARN/FAIL | ... |

Red Flags: [none / lista]
Rekomendacje: [lista]
```
