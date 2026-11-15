# Legatto - Project Technology Stack

> Tech stack, patterny, konwencje, anty-wzorce.

---

## 1. Tech Stack & Versions

| Warstwa | Technologia |
|---------|-------------|
| **Runtime** | Vite 5.x + React 18.x (CSR SPA, NIE Next.js) |
| **Language** | TypeScript 5.x (strict mode) |
| **Routing** | react-router-dom 7.x; publiczna strona `/`, portal `/biuro/*` (ADR 010) |
| **Server State** | React Query (@tanstack/react-query 5.x) |
| **Client State** | React Context (`AuthContext`, `PrivacyContext`) |
| **Backend** | Supabase (Auth z TOTP/aal2, PostgreSQL, RLS, Edge Functions, Realtime, Storage, Vault) |
| **Serverless** | Vercel Functions w `api/` (MCP, OAuth, PoliAI, powiadomienia, crony) |
| **AI** | Anthropic API (klucz instancji w Vault; PoliAI, interpelacje, raporty budżetu) |
| **Styling** | Tailwind CSS 3.x + Shadcn/UI (Radix primitives) + `@tailwindcss/container-queries` |
| **Forms** | react-hook-form + Zod 4 |
| **Mapy** | d3-geo + GeoJSON okręgu w `public/geo/` (ADR 009) |
| **Pliki** | pdfjs-dist, mammoth (podgląd), fflate (DOCX/ZIP), xlsx (SheetJS z CDN) |
| **Daty** | date-fns z `pl` locale |
| **Icons** | lucide-react |
| **Toasts** | sonner |
| **PWA** | vite-plugin-pwa (wyłączone w trybie development) + web push |
| **E-mail** | Resend (powiadomienia), GetResponse (newsletter) |
| **Package Manager** | pnpm (wersja przypięta w `package.json` → `packageManager`; NIE npm, NIE yarn) |

Brak i18n (interfejs tylko po polsku, ADR 004), brak analityki produktowej i zewnętrznego error trackingu.

---

## 2. Key Architectural Patterns

### Model instancji
- **Jedna instancja = jeden poseł** (ADR 026): osobny projekt Supabase i Vercel, bez `tenant_id`.
- Dane posła wyłącznie w bazie (`app_settings`: `site_identity`, `homepage`, `district`) i w Storage `site-assets`. NIGDY nie hardkoduj danych instancji w kodzie.

### Data Flow
```
Pages → Hooks → Supabase Client → PostgreSQL (RLS) / Edge Functions
             ↘ fetch → Vercel Functions (api/) → service_role
                     ↓
              React Query Cache
```

### Autoryzacja
- RLS = źródło prawdy (ADR 001); guardy we frontendzie (`ProtectedRoute`, `RoleGuard`, `src/lib/permissions.ts`) to tylko UX.
- Role: `posel`, `administrator`, `pracownik`, `asystent`; widoczność rekordów dodatkowo przez `data_scope` (ADR 016).
- Kod na service_role (Edge Functions, `api/`) jawnie sprawdza rolę i aal2 - RLS go nie chroni.

### Hook Pattern
- **Hooki** (`src/hooks/`): React Query, wywołania Supabase, mutacje, cache
- **Logika domenowa / pure functions**: `src/lib/` (`*.ts`, `*.utils.ts`)
- Zapytania do Supabase NIE w komponentach - zawsze przez hook

### React Query Konwencje
- Query keys: tablica scoped do encji: `['cases', ...filtry]`, `['cases', 'detail', id]` (lista kluczy: `ai-lib/context-map/infrastructure/api.md`)
- `staleTime` ustawiaj jawnie (słowniki `Infinity`, ustawienia 5 min, listy 30-60 s)
- Invalidation: konkretne keys (NIGDY broad `queryClient.invalidateQueries()`)
- Select: explicit kolumny (NIGDY `select('*')`)

### Responsive Pattern
- Mobile-first: bazowe = mobile, `md:` = desktop
- Container queries (`@md:`) w modułach, które bywają wąskie (np. panel PoliAI)
- `useIsMobile()` dla warunkowej logiki
- Skeleton loaders przy wczytywaniu list i kart

---

## 3. Coding Standards

### Naming
| Element | Konwencja | Przykład |
|---------|-----------|---------|
| Komponenty | PascalCase.tsx | `CaseFormDialog.tsx` |
| Hooki | useCamelCase.ts | `useCases.ts` |
| Utils | camelCase.ts / camelCase.utils.ts | `assignableUsers.utils.ts` |
| Strony | PascalCase.tsx w src/pages/ | `Sprawy.tsx` |
| UI primitives | lowercase.tsx w src/components/ui/ | `button.tsx` |
| DB tables | snake_case | `case_attachments` |
| Edge Functions | kebab-case | `admin-create-user` |
| Migracje | `YYYYMMDDHHMMSS_opis.sql` | `20261107110000_district_settings.sql` |

### Imports
- **ZAWSZE** `@/` alias (mapuje na `src/`)
- **NIGDY** relative `../../`
```typescript
// DOBRZE
import { useCases } from '@/hooks/useCases';
// ZLE
import { useCases } from '../../hooks/useCases';
```

### File Structure
```
src/
├── components/         # Shadcn/UI + komponenty domenowe
│   ├── ui/            # Shadcn primitives (NIGDY edytuj bez powodu)
│   ├── cases/, contacts/, events/, interpellations/, expenses/, signing/, poliai/, ...
│   └── public/        # strona publiczna posła
├── contexts/          # AuthContext, PrivacyContext
├── hooks/             # React Query hooks
├── integrations/      # Supabase client + typy
├── lib/               # logika domenowa, schematy zod, newsletter
├── pages/             # strony (lazy-loaded)
├── routes/            # guardy i ekrany auth (MFA, hasło, tryb prywatny)
└── main.tsx           # Entry point
api/                   # Vercel Functions (+ api/_lib/)
supabase/              # migracje, Edge Functions, szablony e-maili
```

### Error Handling
- React Query: błąd z hooka → `toast.error()` z ogólnym komunikatem
- Edge Functions / `api/`: `try/catch`, ogólny komunikat w odpowiedzi, szczegóły tylko w logach serwera
- NIGDY nie ujawniaj szczegółów DB w UI

---

## 4. Anti-Patterns (ZAKAZANE)

- ❌ `select('*')` → ✅ explicit kolumny
- ❌ N+1 queries → ✅ `.in()` / joins / RPC
- ❌ Waterfall awaits → ✅ `Promise.all()`
- ❌ `window.confirm` / `window.alert` → ✅ AlertDialog (Shadcn)
- ❌ `dangerouslySetInnerHTML` → ✅ sanitizacja po stronie serwera (`api/_lib/sanitize-html.ts`) albo render w sandboxie
- ❌ Hardcoded hex w komponentach → ✅ Tailwind semantic tokens
- ❌ `any` type → ✅ explicit interfaces / `unknown`
- ❌ `console.log` w produkcji → ✅ usuń
- ❌ Relative imports `../../` → ✅ `@/` alias
- ❌ Fetching w useEffect → ✅ React Query
- ❌ Manual Shadcn install → ✅ `pnpm dlx shadcn@latest add [component]`
- ❌ PII (e-maile, imiona, dane wyborców) w logach → ✅ identyfikatory
- ❌ Dane konkretnego posła/biura w kodzie, migracjach lub dokumentacji → ✅ `app_settings` / panel

---

## 5. Testing

Repozytorium nie ma automatycznych testów. Weryfikacja zmian:
- `pnpm exec tsc -b`, `pnpm lint`, `pnpm build`
- ręczny smoke test zmienionej ścieżki (`pnpm dev` + lokalny Supabase)
- po wdrożeniu: `node scripts/instances/doctor.mjs <domena> <ref>`

---

## 6. Komendy

```bash
pnpm install        # Instalacja zależności (lockfile: pnpm-lock.yaml)
pnpm dev            # Dev server (localhost:8080)
pnpm build:dev      # Dev build (szybki, bez PWA)
pnpm build          # tsc -b + production build (wymaga VITE_SUPABASE_URL - CSP)
pnpm lint           # ESLint
pnpm type-check     # tsc -b --noEmit
pnpm build:geo <nr> # GeoJSON i seed słowników okręgu
```

---

## 7. Performance & Bundle Optimization

### Code Splitting
- **KAŻDA strona** (pages/) MUSI być lazy-loaded: `const Page = lazy(() => import('./pages/Page'))`
- Ciężkie komponenty (panel PoliAI, podgląd PDF, mapy okręgu) też lazy
- **NIGDY** nie dodawaj statycznego importu strony w App.tsx

### Vendor Chunks (vite.config.ts)
- manualChunks dzieli vendor na: `vendor-react`, `vendor-query`, `vendor-supabase`, `vendor-ui`, `vendor-forms`, `vendor-d3-geo`
- Nowa zależność UI (Radix) → dodaj do `vendor-ui`
- Nowa ciężka biblioteka → rozważ osobny chunk albo dynamic import

### Context Performance
- **ZAWSZE** `useMemo` na value obiekcie w Provider
- **ZAWSZE** `useCallback` na funkcjach przekazywanych przez context

### Assety
- Obrazy: **WebP** zamiast PNG/JPG
- Ikony: lucide-react (tree-shakeable SVG)
- Fonty: `@fontsource*` (self-hosted, bez zewnętrznych CDN - CSP)

---

_Ostatnia aktualizacja: 2026-11-15_
