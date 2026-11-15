Wykonaj audyt bezpieczeństwa projektu OurMoney (OWASP Top 10 + Supabase).

Przeczytaj `ai-lib/context-map/security-rules.md` przed rozpoczęciem.

## Checklist

### 1. Authentication (A07)
- [ ] Hasła: min 8 znaków, uppercase, cyfra
- [ ] Session management via Supabase Auth (nie localStorage)
- [ ] Logout: resetAnalytics() + signOut()
- [ ] Token refresh: automatyczny (Supabase client)

### 2. Authorization / Access Control (A01)
- [ ] RLS włączone na WSZYSTKICH tabelach z danymi użytkowników
- [ ] Workspace isolation: user nie może podmieniac workspace_id
- [ ] Protected routes: auth guard + onboarding guard
- [ ] Edge Functions: auth check na poczatku każdej

### 3. API Security (A07, A09)
- [ ] VITE_* prefix TYLKO dla publicznych kluczy (anon key, URL)
- [ ] service_role key NIGDY w kodzie frontend
- [ ] Edge Functions: bearer JWT verification
- [ ] Environment variables poprawnie użyte

### 4. Input Validation (A03)
- [ ] Formularze: Zod schema + zodResolver
- [ ] Edge Functions: server-side Zod validation
- [ ] Upload: size, MIME type, extension validation
- [ ] Brak raw SQL (supabase client = parameterized)

### 5. Data Protection (A02, A04)
- [ ] Explicit .select() kolumny (NIGDY select('*'))
- [ ] PII nie logowane (emaile, imiona, IP)
- [ ] PostHog: ranges zamiast exact kwot
- [ ] Sentry: beforeSend filters
- [ ] Invitation tokens: kryptograficznie bezpieczne

### 6. Database (A01, A08)
- [ ] RLS policies pokrywają SELECT, INSERT, UPDATE, DELETE
- [ ] CASCADE deletes na foreign keys
- [ ] Atomowe operacje finansowe (RPC / upsert)
- [ ] Brak string concatenation w zapytaniach

### 7. Frontend (A05)
- [ ] Brak dangerouslySetInnerHTML
- [ ] Brak window.confirm / window.alert
- [ ] Error messages nie ujawniają szczegółów DB
- [ ] HTTPS enforced w production

### 8. Storage
- [ ] User-scoped paths (user_id w nazwie)
- [ ] Upload validation (5MB limit, image MIME)
- [ ] Public read only for avatars

## Severity Levels
- **CRITICAL**: Natychmiastowy STOP - podatność umożliwia dostęp do danych
- **HIGH**: Fix przed deployem
- **MEDIUM**: Fix w następnym sprincie

## Output
```
## Security Audit Report

| Kategoria | Status | Findings |
|-----------|--------|----------|
| Authentication | OK/WARN/CRITICAL | ... |
| Authorization | OK/WARN/CRITICAL | ... |
| API Security | OK/WARN/CRITICAL | ... |
| Input Validation | OK/WARN/CRITICAL | ... |
| Data Protection | OK/WARN/CRITICAL | ... |
| Database | OK/WARN/CRITICAL | ... |
| Frontend | OK/WARN/CRITICAL | ... |
| Storage | OK/WARN/CRITICAL | ... |

CRITICAL: [count]
HIGH: [count]
MEDIUM: [count]
```
