Wykonaj audyt bezpieczeństwa projektu Legatto (OWASP Top 10 + Supabase + Vercel Functions).

Przeczytaj `ai-lib/context-map/security-rules.md` przed rozpoczęciem.

## Checklist

### 1. Authentication (A07)
- [ ] Hasła: min 12 znaków, małe/duże litery, cyfry, znaki specjalne (`config.toml`, `provision.mjs`)
- [ ] 2FA (TOTP) wymagane; dane i RLS dostępne dopiero przy aal2
- [ ] Logout: `signOut()` + `clearClientData()` (cache, "Ostatnie", push urządzenia)
- [ ] Rejestracja wyłączona; konta tylko przez `admin-create-user`

### 2. Authorization / Access Control (A01)
- [ ] RLS włączone na WSZYSTKICH tabelach z danymi użytkowników
- [ ] Rola i `data_scope` respektowane; user nie może zmienić własnej roli ani aktywności
- [ ] Protected routes: `ProtectedRoute` + `RoleGuard` (UX), egzekucja w RLS
- [ ] Edge Functions i `api/`: auth + rola + aal2 na początku każdej

### 3. API Security (A07, A09)
- [ ] VITE_* prefix TYLKO dla publicznych wartości (URL, anon key, Turnstile site key)
- [ ] service_role key i klucze API NIGDY w kodzie frontend (sekrety w Vault)
- [ ] Edge Functions: bearer JWT verification
- [ ] Environment variables poprawnie użyte

### 4. Input Validation (A03)
- [ ] Formularze: Zod schema + zodResolver
- [ ] Edge Functions: server-side Zod validation
- [ ] Upload: size, MIME type, extension validation
- [ ] Brak raw SQL (supabase client = parameterized)

### 5. Data Protection (A02, A04)
- [ ] Explicit .select() kolumny (NIGDY select('*'))
- [ ] PII nie logowane (e-maile, imiona, dane wyborców, IP)
- [ ] Publiczny formularz: Turnstile + honeypot + limit + hash IP
- [ ] Pobieranie URL-i od użytkownika tylko przez `safeFetch`

### 6. Database (A01, A08)
- [ ] RLS policies pokrywają SELECT, INSERT, UPDATE, DELETE
- [ ] CASCADE deletes na foreign keys
- [ ] Operacje wieloetapowe atomowo (RPC / upsert)
- [ ] Brak string concatenation w zapytaniach

### 7. Frontend (A05)
- [ ] Brak dangerouslySetInnerHTML (HTML z zewnątrz sanitizowany po stronie serwera)
- [ ] Brak window.confirm / window.alert
- [ ] Error messages nie ujawniają szczegółów DB
- [ ] CSP w `vercel.json` aktualny (nowe źródła zewnętrzne dopisane)

### 8. Storage
- [ ] Ścieżki w folderze rekordu nadrzędnego / użytkownika; polityki sprawdzają widoczność rodzica
- [ ] Limity rozmiaru i MIME na bucketach (`file_size_limit`, `allowed_mime_types`)
- [ ] Publiczne buckety tylko dla treści publicznych (`avatars`, `site-assets`, `newsletter-assets`); dane biura przez signed URL

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
