# OurMoney - Project Technology Stack

> Tech stack, patterny, konwencje, anty-wzorce.

---

## 1. Tech Stack & Versions

| Warstwa | Technologia |
|---------|-------------|
| **Runtime** | Vite 5.x + React 18.x (CSR SPA, NIE Next.js) |
| **Language** | TypeScript 5.x (strict mode) |
| **Routing** | react-router-dom 6.x |
| **Server State** | React Query (@tanstack/react-query 5.x) |
| **Client State** | React Context (auth, workspace, onboarding, notifications) |
| **Backend** | Supabase (Auth, PostgreSQL, RLS, Edge Functions, Realtime, Storage) |
| **Styling** | Tailwind CSS 3.x + Shadcn/UI (Radix primitives) |
| **Forms** | react-hook-form + Zod |
| **Charts** | Recharts |
| **Icons** | lucide-react |
| **Toasts** | sonner |
| **PWA** | vite-plugin-pwa (TYLKO production) |
| **Analytics** | PostHog (autocapture OFF, privacy-first) |
| **Errors** | Sentry (@sentry/react) |
| **Testing** | Vitest (unit) + Playwright (e2e) |
| **Package Manager** | pnpm (wersja przypięta w `package.json` → `packageManager`; NIE npm, NIE yarn) |

---

## 2. Key Architectural Patterns

### Data Flow
```
Pages → Hooks → Supabase Client → PostgreSQL / Edge Functions
                     ↓
              React Query Cache
                     ↓
                 Contexts
```

### Hook Pattern
- **Hooki** (`src/hooks/`): React Query, Supabase calls, mutations, cache management
- **Utils** (`*.utils.ts`): Pure functions, kalkulacje, transformacje, formatowanie
- Hooki NIE w komponentach - zawsze w `src/hooks/`

### React Query Konwencje
- Query keys: tablica, scoped do workspace/user: `['budget', workspaceId, month, year]`
- **staleTime: WYMAGANE** (5min dla stable data, 1min dla dynamic)
- Invalidation: konkretne keys (NIGDY broad `queryClient.invalidateQueries()`)
- Select: explicit kolumny (NIGDY `select('*')`)

### Responsive Pattern
- Mobile-first: bazowe = mobile, `md:` = desktop
- ResponsiveContainer, ResponsiveModal, ResponsiveStack, ResponsiveGrid (`src/components/ui/responsive/`)
- useBreakpoint() hook dla warunkowej logiki
- Touch targets min 44x44px
- Skeleton loaders (NIGDY spinnery)

---

## 3. Coding Standards

### Naming
| Element | Konwencja | Przykład |
|---------|-----------|---------|
| Komponenty | PascalCase.tsx | `BudgetOverview.tsx` |
| Hooki | useCamelCase.tsx | `useBudget.tsx` |
| Utils | camelCase.utils.ts | `partnerBalance.utils.ts` |
| Testy | *.test.ts(x) | `useBudget.test.tsx` |
| Strony | PascalCase.tsx w src/pages/ | `Budget.tsx` |
| UI primitives | lowercase.tsx w src/components/ui/ | `button.tsx` |
| DB tables | snake_case | `workspace_members` |
| Edge Functions | kebab-case | `send-partner-invitation` |

### Imports
- **ZAWSZE** `@/` alias (mapuje na `src/`)
- **NIGDY** relative `../../`
```typescript
// DOBRZE
import { useBudget } from '@/hooks/useBudget';
// ZLE
import { useBudget } from '../../hooks/useBudget';
```

### File Structure
```
src/
├── components/         # Shadcn/UI + domain components
│   ├── ui/            # Shadcn primitives (NIGDY edytuj bez powodu)
│   ├── ui/responsive/ # Responsive wrappers
│   ├── Dashboard/     # Domain components
│   ├── Budget/
│   └── [domain]/
├── contexts/          # React Context providers
├── hooks/             # Custom hooks + utils
├── integrations/      # Supabase client + types
├── lib/               # Utils (analytics, posthog, sentry, utils)
├── pages/             # Route pages
└── main.tsx           # Entry point
```

### Error Handling
- Server Actions / Edge Functions: `try/catch` + generic message w UI
- React Query: `onError` callback z toast
- Sentry: automatyczne raportowanie błędów
- NIGDY nie ujawniaj szczegółów DB w UI

---

## 4. Anti-Patterns (ZAKAZANE)

- ❌ `select('*')` → ✅ explicit kolumny
- ❌ N+1 queries → ✅ `.in()` / joins
- ❌ Waterfall awaits → ✅ `Promise.all()`
- ❌ `window.confirm` / `window.alert` → ✅ AlertDialog (Shadcn)
- ❌ Hardcoded hex → ✅ Tailwind semantic tokens
- ❌ `any` type → ✅ explicit interfaces / `unknown`
- ❌ `console.log` w produkcji → ✅ usuń
- ❌ Relative imports `../../` → ✅ `@/` alias
- ❌ Osobne Mobile/* komponenty → ✅ Responsive primitives
- ❌ Fetching w useEffect → ✅ React Query
- ❌ Manual Shadcn install → ✅ `pnpm dlx shadcn@latest add [component]`
- ❌ PII w logach/PostHog → ✅ ranges, masking
- ❌ Spinnery → ✅ Skeleton loaders
- ❌ Komponenty >150 linii → ✅ split
- ❌ Hardcoded polskie stringi w JSX → ✅ `t('key')` z `useTranslation`
- ❌ `{ locale: pl }` / `'pl-PL'` hardcoded → ✅ `getDateLocale(i18n.language)` z `@/lib/locale`
- ❌ Hardcoded `"zł"` → ✅ `getCurrencySymbol()` z `@/lib/locale`
- ❌ Zmienna `t` w `.forEach(t =>` / `.map(t =>` → ✅ użyj `tx` (unikaj shadowing `t` z i18n)

---

## 5. PostHog Tracking

### Architektura
- `src/lib/posthog.ts` - init (autocapture OFF)
- `src/lib/analytics.ts` - trackFeature(), trackError(), identifyUser(), setWorkspaceContext()
- `src/hooks/usePostHogPageview.ts` - auto pageview
- `src/hooks/usePostHogIdentify.ts` - auto identify + context

### Pattern w hookach
```typescript
onSuccess: () => {
  trackFeature('event_name', {
    screen: 'screen_name',
    amount_range: getAmountRange(amount),
  });
  queryClient.invalidateQueries({ queryKey: ['budget'] });
}
```

### Zasady
- Event names: snake_case
- Kwoty ZAWSZE jako ranges: `getAmountRange(amount)` → "<50", "50-200", "200-500", "500-1000", "1000+"
- NIGDY exact kwoty, emaile, imiona
- Session recording: `maskAllInputs: true`

---

## 6. Testing

| Typ | Framework | Lokalizacja |
|-----|-----------|-------------|
| Utils (*.utils.ts) | Vitest | *.utils.test.ts |
| Hooks (use*.tsx) | Vitest + mocks | use*.test.tsx |
| Components | Vitest + RTL | *.test.tsx |
| Flows / Pages | Playwright | e2e/*.spec.ts |

### Konwencja
```typescript
describe('ModuleName', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should [oczekiwane zachowanie]', () => {
    // Arrange
    // Act
    // Assert
  });
});
```

### Zasady
- Testuj zachowanie, nie implementacje
- Mockuj external (Supabase, PostHog)
- Utils: pure testy bez mockow
- KAŻDY nowy hook/util powinien mieć test

---

## 7. Komendy

```bash
pnpm install        # Instalacja zależności (lockfile: pnpm-lock.yaml)
pnpm dev            # Dev server (localhost:8080)
pnpm build:dev      # Dev build (szybki, bez PWA)
pnpm build          # Production build
pnpm lint           # ESLint
pnpm test:run       # Vitest single run
pnpm test:e2e       # Playwright e2e
```

---

## 8. Performance & Bundle Optimization

### Code Splitting
- **KAŻDA strona** (pages/) MUSI być lazy-loaded: `const Page = lazy(() => import('./pages/Page'))`
- Ciężkie komponenty renderowane warunkowo (np. Settings w Sheet) - też lazy
- `<Suspense fallback={<SplashScreen loading />}>` opakowuje lazy content
- **NIGDY** nie dodawaj statycznego importu strony w App.tsx

### Vendor Chunks (vite.config.ts)
- manualChunks dzieli vendor na: `vendor-react`, `vendor-query`, `vendor-supabase`, `vendor-ui`, `vendor-recharts`, `vendor-sentry`, `vendor-posthog`, `vendor-forms`
- Nowa zależność UI (Radix) → dodaj do `vendor-ui`
- Nowa ciężka biblioteka → rozważ osobny chunk

### Context Performance
- **ZAWSZE** `useMemo` na value obiekcie w Provider
- **ZAWSZE** `useCallback` na funkcjach przekazywanych przez context
- Bez tego każdy re-render providera re-renderuje WSZYSTKICH konsumentów

### PostHog (deferred)
- PostHog ładuje się przez dynamic import (nie blokuje initial bundle)
- Użyj `getPostHog()` (async) dla fire-and-forget tracking
- Użyj `getPostHogSync()` (sync, nullable) w hot paths (np. Sentry beforeSend)
- **NIGDY** `import posthog from 'posthog-js'` bezpośrednio w komponentach/hookach

### Assety
- Obrazy: **WebP** (quality 80) zamiast PNG/JPG
- Ikony: lucide-react (tree-shakeable SVG), **NIGDY** emoji jako ikony
- Fonty: preload w index.html, cache-first w SW

### Metryki docelowe
- Initial JS bundle: <500 KB (gzip <150 KB)
- Obrazy: WebP, max ~200 KB per image
- TTI mobile 4G: <2s

---

## 9. Internationalization (i18n)

### Stack
- `i18next` + `react-i18next` + `i18next-browser-languagedetector`
- Konfiguracja: `src/i18n/index.ts`
- Helpery locale: `src/lib/locale.ts` (`getDateLocale`, `formatCurrency`, `getCurrencySymbol`)

### Języki
- **Polski** (domyślny, fallback)
- **English**
- Preferencja w DB: `profiles.preferred_language`, `profiles.preferred_currency`

### Namespaces (8)
```
src/i18n/locales/{pl,en}/
  common.json       ← akcje, błędy, etykiety, nawigacja, historia
  auth.json          ← logowanie, rejestracja, hasło
  dashboard.json     ← home, karty, przegląd
  budget.json        ← budżet, kategorie, wydatki, transakcje
  savings.json       ← cele, wpłaty
  settings.json      ← ustawienia, profil, konto
  onboarding.json    ← onboarding (7-13 kroków)
  notifications.json ← powiadomienia, typy
```

### Pattern w komponentach
```typescript
import { useTranslation } from 'react-i18next';

const MyComponent = () => {
  const { t, i18n } = useTranslation('budget'); // namespace
  // Shared strings z innego namespace:
  const { t: tCommon } = useTranslation('common');

  return <h1>{t('title')}</h1>; // → "Budżet" / "Budget"
};
```

### Zasady
- **NIGDY** hardcoded polskie/angielskie stringi w JSX - zawsze `t('key')`
- **NIGDY** `{ locale: pl }` - zawsze `{ locale: getDateLocale(i18n.language) }`
- **NIGDY** hardcoded `"zł"` - zawsze `getCurrencySymbol(currency)`
- **NIGDY** zmienna `t` w iteratorach (`.map(t =>`) - użyj `tx` (shadowing i18n `t`)
- Nowy user-facing string → dodaj klucz do **obu** JSON (pl + en)
- Interpolacja: `t('key', { name, amount })` → `"Cześć, {{name}}!"`
- Daty: `getDateLocale(i18n.language)` z `@/lib/locale`
- Kwoty: `formatCurrency(amount, currency)` lub `getCurrencySymbol(currency)`

---

_Ostatnia aktualizacja: 2026-03-14_
