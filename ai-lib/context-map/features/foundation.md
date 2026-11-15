# Feature: Foundation (Faza 1)

> Auth, role, admin panel, app shell, PWA. Fundament dla wszystkich kolejnych modułów.

## Cel

Aplikacja z zamkniętym dostepem (tylko admin tworzy konta), czterema rolami (Poseł/Administrator/Pracownik/Asystent), responsywnym shellem (bottom nav mobile / sidebar desktop) i instalowalnym PWA.

## Role i uprawnienia

| Rola | Zakres |
|------|--------|
| **Poseł** (`posel`) | Admin - pełny dostęp + zarządzanie użytkownikami |
| **Administrator** (`administrator`) | Identyczne uprawnienia jak Poseł - inna tylko nazwa roli |
| **Pracownik** (`pracownik`) | Read + write na wszystkich modułach (bez user mgmt) |
| **Asystent** (`asystent`) | Read-only |

Egzekwowane na 2 poziomach:
1. **RLS w Postgres** (single source of truth) - funkcje `is_posel()` (rola `posel` LUB `administrator`), `is_writer()` w policies
2. **Frontend guardy** (UX) - `<ProtectedRoute>` + `<RoleGuard allow={['poseł']}>` + `canWrite()` / `isAdmin()` z `lib/permissions.ts`

**Self-update profilu** (`profiles_update_self`, po migracji `tighten_permissions` + `init_data_scope` + `security_profiles_storage`; wymaga aal2):
- Można edytować: `full_name`, `phone`, `avatar_url`, `is_public`
- **Zablokowane:** `email`, `role`, `is_active`, `office_id`, `password_set`, `has_privacy_pin`, `created_at`, `scope_contacts`, `scope_cases`, `scope_events`, `scope_interpellations` (zmienia tylko Poseł albo dedykowany RPC)
- Flagę `password_set` ustawia dedykowany RPC `mark_my_password_set()` (PasswordSetupScreen po pierwszym ustawieniu hasła)
- Hash PIN-u trybu prywatnego leży w `profile_secrets` (RLS bez polityk, brak grantów dla klienta); na `profiles` jest tylko flaga `has_privacy_pin`, którą zmieniają wyłącznie RPC `set_my_privacy_pin(p_pin, p_current_pin)` / `clear_my_privacy_pin(p_current_pin)` (trigger `profiles_guard_has_privacy_pin` + GUC `eposel.privacy_pin_rpc`)
- Kolumny `scope_*` (per-user data scope) zmienia tylko Poseł przez `EditUserProfileDialog`

**Widoczność profili** (`profiles_select_self_or_team`): własny wiersz zawsze (ekran MFA w aal1), pozostałe profile tylko dla aktywnego usera z aal2.

**Per-user data scope** (kolumny `scope_*` na `profiles`, enum `data_scope` = `own | all`, default `all`):
- Posel moze pojedynczemu Pracownikowi/Asystentowi ograniczyc widocznosc danych per modul (`scope_contacts`, `scope_cases`, `scope_events`, `scope_interpellations`).
- Wartosc `own` = widzi tylko rekordy gdzie jest `created_by = auth.uid()` (kontakty, interpelacje) lub dodatkowo `assigned_to = auth.uid()` (sprawy, kalendarz).
- Wartosc `all` = widzi wszystko (zachowanie domyslne).
- **Posel zawsze widzi wszystko** — bypass `is_posel()` w SELECT policy danego modulu (kolumny scope_* na profilu Posla sa nieuzywane dla niego).
- Egzekwowane na poziomie RLS przez SELECT policies dla `cases` / `contacts` / `events` / `interpellations` z helperami `current_contacts_scope()` / `current_cases_scope()` / `current_events_scope()` / `current_interpellations_scope()` (SECURITY DEFINER + `set row_security = off`, wzor `is_posel`).
- INSERT/UPDATE/DELETE dla tych tabel **NIE** sa dotkniete — pracownik z `scope_cases='own'` moze nadal stworzyc nowy rekord (ze sobą jako `created_by`) i go potem nie zobaczy jezeli admin zmieni autora. Akceptowalne — scope dotyczy widocznosci, nie autoryzacji do akcji.
- UI: sekcja "Zakres dostępu do danych" (wspólny komponent `DataScopeFields`, 4 toggle'e own/all, tylko dla Pracownika/Asystenta) w `CreateUserDialog` (zakres ustawiany od razu przy zaproszeniu, default `all`) i `EditUserProfileDialog`. Badge "Zakres ograniczony" (amber) na karcie konta gdy ktorys scope = `own`.

## Key Files

### Auth
- `src/integrations/supabase/client.ts` - singleton klienta Supabase
- `src/integrations/supabase/types.ts` - typy (Profile, AuditLog, AppRole)
- `src/contexts/AuthContext.tsx` - session + profile + role, signIn/signOut(scope)/refreshProfile. Wylogowanie (i zmiana usera w tej samej karcie) czyści cache react-query (`queryClient.clear()`), "Ostatnie" wyszukiwarki (`clearRecent()`) i szkice newslettera (`clearNewsletterDrafts()`). Zdarzenie `MFA_CHALLENGE_VERIFIED` tego samego usera odświeża MFA w tle bez `loading`. Profil odświeżany w tle po powrocie do karty (`visibilitychange`) i co 5 min (błąd sieci nie zeruje profilu) - dezaktywacja konta przekierowuje na `/login?reason=inactive`, gdzie Login robi `signOut('local')`
- `src/lib/permissions.ts` - helpery `isAdmin`, `canWrite`, `canRead`, `roleLabel(role, forms)` (etykieta `posel` = "Poseł"/"Posłanka" wg `site_identity.mp_gender`, pozostałe role stałe)
- `src/hooks/useMpForms.ts` - `useMpForms()` (formy tytułu posła instancji z `useSiteContent()`, do załadowania 'm') i `useRoleLabel()` → `(role) => string`. Teksty UI z "Poseł/Posła/Posłem..." biorą formy stąd (`mp.nominative`, `mp.genitive`, `mp.accusative`, `mp.instrumental`), nie wpisane na sztywno. Formę ustawia admin w Strona główna → karta z danymi posła → "Forma tytułu" (`IdentityCard`)
- `src/routes/ProtectedRoute.tsx` - wymaga zalogowania + aktywnego profilu
- `src/routes/RoleGuard.tsx` - wymaga konkretnej roli
- `src/pages/Login.tsx` - formularz email+password (react-hook-form + zod); opis "Panel pracowników biura · {identity.district_label}" (bez okręgu samo "Panel pracowników biura"), placeholder e-maila z domeny instancji (`biuro.`/`www.` obcięte; lokalnie `ty@example.pl`). Po zalogowaniu `?redirect=` tylko dla ścieżki w tym samym originie (`src/lib/safeRedirect.ts`), potem `state.from` (z search/hash), domyślnie `/biuro`. `/oauth/consent` opakowany `PrivacyGate` (`src/routes/PrivacyGate.tsx`) - tryb prywatny zasłania zgodę OAuth. Linki `mailto:` z danych użytkownika przez `mailtoHref` (`src/lib/mailto.ts`): prosty adres albo sam tekst.
- `src/components/auth/AuthLayout.tsx` - wspólny układ ekranów auth; `BrandMark` (czysty widok) z podpisem = `identity.mp_name` z `useSiteContent()` (bez nazwiska - `mp_title`; podczas wczytywania podpis niewidoczny, ale zajmuje miejsce). Prop `brandSubtitle` = stały podpis bez zapytania - używa go `ConfigError` (renderowany poza `QueryClientProvider`)

### Layout
- `src/components/layout/AppShell.tsx` - wrapper Sidebar + TopBar + main + BottomNav
- `src/components/layout/Sidebar.tsx` - desktop (≥768px); domyślnie wąska szyna z ikonami (56 px), po najechaniu (opóźnienie 120 ms) lub fokusie z klawiatury płynnie rozwija się do 240 px jako nakładka nad treścią; przycisk "Przypnij panel" trzyma go rozwiniętego i zajmującego miejsce (`localStorage` `app.sidebar.pinned`); admin ma sekcje "Administracja". Podpis pod "Biuro Poselskie" = `identity.mp_name` (bez nazwiska `mp_title`, do wczytania treści pusty). Na dole panelu `ProductCredit`.
- `src/components/layout/BottomNav.tsx` - mobile (<768px): Pulpit, Sprawy, Kontakty, Kalendarz i "Więcej"; ostatnia zakładka otwiera pełną nawigację i jest aktywna poza czterema głównymi trasami
- `src/components/layout/TopBar.tsx` - na mobile godło albo powrót do dostępnego rodzica (do pulpitu z sekcji desktop-only); na desktopie breadcrumb; po prawej PoliAI, wyszukiwarka, tryb prywatny (desktop; na telefonie pozycja „Włącz tryb prywatny” w menu konta), dzwonek powiadomień (`NotificationBell`, [powiadomienia.md](powiadomienia.md) → „Dzwonek”) i menu konta. Na telefonie przyciski mają stałe 44 px (`max-md:h-[44px] max-md:w-[44px]`, także `PoliAITrigger`), żeby przy tekście 150% zmieściło się godło; ikony w rem
- `src/components/poliai/PoliAIDock.tsx` - mobile: pełny ekran; desktop: dokładnie 50% wiersza pod TopBarem. TopBar pozostaje na pełnej szerokości kolumny aplikacji.
- `src/hooks/useModuleNarrow.ts` - JS-owy odpowiednik progów kontenera modułu dla decyzji renderowania (np. tabela/lista). `<main>` w `AppShell` jest kontenerem Tailwind; układ treści używa `@sm:` / `@md:` / `@lg:` / `@xl:` i `@max-*`, a progi viewportu zostają dla cech urządzenia, gęstości dotykowej i dialogów. `<main>` ma `relative` (jedyny przewijany obszar): elementy `absolute` bez pozycjonowanego przodka (np. `sr-only` pola radio) należą do niego - bez tego wystawały poza okno i fokus/kliknięcie przewijało `<html>` (cały szkielet uciekał w górę). Przewijanie do sekcji: `#app-main`.`scrollTo`, nie `scrollIntoView` (ten przewija też przodków z `overflow: hidden`).
- `src/components/layout/Page.tsx` - `Page` (padding/szerokość strony) i `PageHeader`: ikona wyrównana do linii tytułu (`items-start`, wysokość linii h1 = kafelek ikony), akcje w rzędzie od `@sm` nie zawijają się (`@sm:shrink-0`) - zawija się opis.
- Prymitywy UI (`src/components/ui/*`): `DialogContent`/`AlertDialogContent` - telefon: arkusz od dołu z safe-area; desktop: domyślnie `max-h-[90vh] overflow-y-auto` i `grid-cols-1` (długi `truncate` nie rozpycha okna); własne `max-h-*`/`overflow-hidden` nadpisują. `DialogFooter` ma `!-mb-6` (działa też w `<form className="space-y-*">`), wyzerowanie marginesu tylko przez `!mb-0`. `Input`: telefon `h-11 text-base`, desktop `h-9 md:text-sm` - nadpisując wysokość/rozmiar podaj też wariant (`h-14 max-md:h-14`, `text-2xl md:text-2xl`). Tailwind `future.hoverOnlyWhenSupported` - `hover:` działa tylko przy myszy (brak "przyklejonego" tła po tapnięciu). Toasty (`ui/sonner.tsx`) na telefonie pod safe-area.
- Pola wyboru z wyszukiwaniem (`src/components/ui/search-select.tsx`): `SearchSelect` zastępuje Radix `Select` przy każdej liście z danych (sprawy, kontakty, osoby, biura, powiaty/gminy, kategorie, modele, listy GetResponse, pozycje rozliczenia) - klik otwiera listę i od razu można pisać (filtr bez wielkości liter i polskich znaków po etykiecie/opisie/grupie), lista ma szerokość pola (`max-w = --radix-popover-trigger-width`, długie etykiety w 2 liniach), ↓↑ i Tab/Shift+Tab przechodzą po opcjach, Enter lub klik wybiera, Esc zamyka tylko listę. `noneLabel` = opcja czyszcząca (null), `onSearchChange` = wyszukiwanie po stronie serwera (kontakty, sprawy), `selectedOption` = etykieta wartości spoza wyników. `DialogContent` przy otwartej liście ignoruje klik poza oknem (zamyka się tylko lista). Radix `Select` zostaje tylko dla krótkich stałych enumów (status, priorytet, typ, sposób płatności, okres, sortowanie).

### Admin
- `src/pages/admin/Users.tsx` - lista + dialog "Dodaj użytkownika" (z wyborem biura) + zmiana roli/biura + activate/deactivate + **edytuj profil** (Posel zmienia full_name/phone/avatar/is_public dla pracownika) + **szczegóły konta** (last_sign_in/MFA/sesje) + **wyślij ponownie zaproszenie / link resetu hasła** (dynamiczna pozycja po `password_set`) + **wyloguj ze wszystkich urządzeń** (unieważnienie sesji przez RPC `admin_revoke_user_sessions` + reset MFA)
- Administrator nie widzi akcji na koncie Posła (rola, (de)aktywacja, reset 2FA, wylogowanie, link, usunięcie) ani roli Poseł w dodawaniu/zmianie roli - zamiast nich podpowiedź `poselOnlyHint` ("Tylko Poseł zarządza kontem Posła"); reguła `canManagePoselAccounts` w `src/hooks/useUsers.ts` odpowiada EDGE-6 (`isCallerPoselRole`, trigger `profiles_guard_role_active`).
- `src/components/admin/AccountDetailsDialog.tsx` - dialog z metadanymi konta auth (`useUserAdminDetails` → RPC). Pola: email_confirmed_at, last_sign_in_at, sessions_count, mfa_factors, password_set, auth_created_at.
- `src/components/admin/RevokeSessionsDialog.tsx` - destrukcyjne potwierdzenie (confirm `WYLOGUJ`). Wywoluje `useRevokeUserSessions` → Edge Function `admin-revoke-user-sessions`.
- `src/pages/admin/Offices.tsx` - CRUD biur poselskich (lista, dodaj, edytuj, oznacz jako główne, deaktywuj)
- `src/pages/admin/AuditLog.tsx` - dziennik zmian (filtry zakres dat / akcja / encja / email, paginacja 50/strona, eksport PDF)
- `src/hooks/useUsers.ts` - useUsers (RPC `get_all_users_admin`, Poseł + aal2) / useCreateUser / useUpdateUser / useDeleteUser / **useSendAuthLink** (dyn invite/recovery, cooldown 5 min/user po BE) / **useRevokeUserSessions** (unieważnienie sesji + reset MFA) / **useUserAdminDetails(userId)** (RPC) / **useUpdateMyProfile** (self-edit) / **useUploadAvatar** (Storage)
- `src/hooks/useOffices.ts` - useOffices / useCreateOffice / useUpdateOffice / **usePublicOffices** (anon) / **usePublicOfficeStaff(officeId)** (anon, RPC)
- `src/hooks/useAuditLog.ts` - paginowany audit log + `fetchAuditLogForReport(filters)` dla eksportu

### Profil użytkownika (`/biuro/profil`)
- `src/pages/Profil.tsx` - sekcje w kolejności: Zdjęcie profilowe (AvatarUploadButton), Dane podstawowe (full_name/phone/is_public, save batch), Zmiana hasła (Zod validate; wymaga obecnego hasła - `updateUser({ password, current_password })`, egzekwuje GoTrue przy `security_update_password_require_current_password`, ustawianym przez `provision.mjs` - i świeżego kodu 2FA przed `updateUser`; gdy GoTrue zwróci `reauthentication_needed` - sesja starsza niż 24 h przy włączonym `security_update_password_require_reauthentication` - `auth.reauthenticate()` wysyła kod na e-mail, pole "Kod z e-maila" i `updateUser({ password, nonce })`), **2FA (Mfa2FaCard)**, Tryb prywatny (status PIN-u + `PrivacySetupDialog`; na telefonie i komputerze), Ustawienia dostępności, Powiadomienia (`#powiadomienia`, kotwica z e-maili)
- `src/components/admin/EditUserProfileDialog.tsx` - admin-side edit dialog (te same pola + AvatarUploadButton, ale używa `useUpdateUser` zamiast `useUpdateMyProfile`)
- `src/components/common/AvatarUploadButton.tsx` - file picker (JPG/PNG/WebP, 2 MB max), wgrywa do Storage `avatars`, callback `onUploaded(url)` zapisuje URL do profilu, cache buster `?v={updated_at}`
- `src/routes/PasswordSetupScreen.tsx` - wymuszenie ustawienia hasła po pierwszym logowaniu (gdy `password_set=false`) i po wejściu linkiem odzyskania hasła (`AuthContext.passwordRecovery`: zdarzenie `PASSWORD_RECOVERY`, flaga w sessionStorage `app.passwordRecovery` = id usera, zdejmowana po `mark_my_password_set` albo wylogowaniu). Świeża sesja z linku (<24 h) zmienia hasło bez kodu.

### 2FA (TOTP, wymuszone dla wszystkich)
- `src/routes/MfaEnrollmentScreen.tsx` - QR + manual secret + verify pierwszego kodu. Renderowany przez `ProtectedRoute` gdy brak verified TOTP factor. friendlyName = "Biuro Poselskie - {identity.mp_name}" ustalane w chwili enrollmentu (cache React Query, a gdy pusty - bezpośrednio RPC `get_public_site_content`); bez nazwiska "Biuro Poselskie - {window.location.host}". Nazwa to tylko etykieta - cleanup unverified w `useEnrollTotp` filtruje po statusie. 
- `src/routes/MfaChallengeScreen.tsx` - input 6 cyfr + verify, renderowany gdy `aal=aal1` a user ma verified factor. Zgubiony klucz: link mailto do `VITE_SUPPORT_EMAIL` (build-time, opcjonalny), bez niego tekst "Poproś Posła lub Administratora biura o reset 2FA (Użytkownicy → Resetuj 2FA)".
- `src/components/mfa/Mfa2FaCard.tsx` - sekcja "Bezpieczeństwo (2FA)" w Profil.tsx: status + opcja "Usuń i skonfiguruj ponownie" potwierdzana kodem z obecnej aplikacji (`useChallengeAndVerifyTotp`).
- `src/components/admin/ResetMfaDialog.tsx` - admin reset 2FA cudzego usera (confirm `RESETUJ`). Wywoluje `useResetUserMfa` → Edge Function `admin-reset-user-mfa`.
- `src/hooks/useMfa.ts` - hooki: `useMfaFactors`, `useEnrollTotp` (z cleanupem unverified factor-ow przed enroll - inaczej Supabase odrzuca enroll z konfliktem friendlyName), `useChallengeAndVerifyTotp`, `useUnenrollTotp`, `useResetUserMfa`. Zdarzenia `mfa.enroll` / `mfa.verify_failed` / `mfa.unenroll` logowane przez RPC `log_client_event` (`log_audit` nie jest wykonywalne przez authenticated).
- `src/contexts/AuthContext.tsx` - `mfa: { factors, verifiedTotp, currentLevel, nextLevel, loading }` + `refreshMfa()`. Loading=false default (po signOut nie blokuje ProtectedRoute).
- `AuthContext.onAuthStateChange`: przy `MFA_CHALLENGE_VERIFIED` woła `supabase.realtime.setAuth(<token aal2>)` (supabase-js przekazuje token do Realtime tylko przy `SIGNED_IN`/`TOKEN_REFRESHED`; bez tego kanały `postgres_changes` z polityką `is_aal2()` po świeżym logowaniu z TOTP nie dostają zdarzeń do odświeżenia tokenu).
- `src/routes/ProtectedRoute.tsx` - kaskada: session → profile → is_active → password_set → **verifiedTotp → aal2** → Outlet.
- `supabase/functions/admin-reset-user-mfa/index.ts` - Posel resetuje cudze factor-y (lista + delete), blokada self-reset, audit `mfa.admin_reset`.
- `supabase/migrations/20260504300000_rls_aal2_hardening.sql` - helper `is_aal2()` + wszystkie polityki na wrazliwych tabelach wymagaja aal2 (chroni przed bypassem przez wykradziony aal1 token). Od `20261018210000` aal2 wymagają też RPC admina (`get_all_users_admin`, `get_user_admin_details`), `get_assignable_users`, `get_office_colleagues` i polityki `avatars_*_posel`; Edge Functions admina sprawdzają aal2 jawnie (`_shared/auth.ts`).
- Audit log eventy: `mfa.enroll`, `mfa.verify_failed`, `mfa.unenroll`, `mfa.admin_reset`, `user.invite_resent`, `user.password_reset_sent`, `user.sessions_revoked`, `user.profile_create/update/delete` i `office.create/update/delete` (triggery), `privacy_pin.set/clear/verify_failed/locked`.
- Recovery: zgubiony Pracownik/Asystent → Posel resetuje. Zgubiony Posel → drugi Posel albo deweloper przez Supabase Dashboard (brak built-in recovery codes).

### Tryb prywatny (anti-shoulder-surfing)
- `src/lib/privacyLock.ts` - stan blokady w localStorage per user (`app:privacy:locked:<userId>`), zdarzenie `app:privacy-lock-change` + `storage` (synchronizacja kart). Nowa karta / restart PWA nie zdejmują zasłony. Blokada zapisana pod starym kluczem `eposel:privacy:locked:<userId>` jest przenoszona przy odczycie, więc aktualizacja nie odblokowuje ekranu.
- Szkic newslettera i układ sekcji (`src/components/campaigns/newsletter/draft.ts`, `app:newsletter-draft:v1:<userId>`, `app:newsletter-layout:v1:<userId>`): wartość spod starego prefiksu `eposel:` jest przenoszona przy pierwszym odczycie, więc aktualizacja nie gubi niewysłanego szkicu.
- `src/contexts/PrivacyContext.tsx` - provider: `isLocked` czytany synchronicznie z localStorage (`useSyncExternalStore` - bez klatki z widoczną treścią) + `isPinSet` (z `profile.has_privacy_pin`). Akcje `lock()` / `unlock()`. Flagę zdejmuje jawnie `unlock()` (poprawny PIN, usunięcie PIN-u, wylogowanie); brak PIN-u = brak zasłony.
- `src/components/privacy/PrivacySetupDialog.tsx` - setup (edukacyjna notka "inny niz haslo do logowania" + form 4-8 cyfr, Zod regex `^\d{4,8}$`, po zapisie `lock()`), zmiana PIN-u (wymaga obecnego) i wyłączenie trybu (wymaga obecnego PIN-u).
- `src/components/privacy/PrivacyOverlay.tsx` - fixed inset-0 z `backdrop-blur-2xl`, central Card z avatarem + nazwa + input PIN (numeric, maxLength 8). Licznik prób i blokada wyłącznie po stronie DB (przeładowanie strony ich nie zeruje); `PrivacyPinLockedError` → toast + `signOut()`. Escape: link "Wyloguj sie".
- `src/hooks/usePrivacyPin.ts` - `useSetPrivacyPin` / `useVerifyPrivacyPin` / `useClearPrivacyPin` (RPC wrappery; przed set/clear weryfikacja obecnego PIN-u przez `verify_my_privacy_pin`).
- Backend: 5 błędnych prób → blokada 15 min (`profile_secrets.pin_locked_until`, błąd `privacy_pin_locked`), audit `privacy_pin.*`. Opis RPC: [infrastructure/database.md](../infrastructure/database.md).
- TopBar: pozycja `Eye` "Włącz tryb prywatny" (desktop: przycisk; telefon: pozycja w menu konta). Pierwsze klik (PIN nieustawiony) → otwiera SetupDialog. Kolejne klik → instant `lock()`.
- AppShell: `<PrivacyProvider>` opakowuje cala strukture portalu; przy `isLocked` `ShellContent` zwraca `null` (Sidebar/TopBar/strona w ogóle się nie renderują), `<PrivacyOverlay />` jako rodzenstwo.
- **Scope:** zasłona ekranu, NIE szyfrowanie. Dane mogą zostać w cache React Query w pamięci. Chroni przed wzrokiem postronnych, nie atakujacym z DevTools.

### Ustawienia dostępności (per urządzenie)
- Sekcja `src/components/accessibility/AccessibilitySettingsSection.tsx` w `/biuro/profil`: rozmiar tekstu (100 / 112,5 / 125 / 150%, natywne radio = strzałki z klawiatury), wysoki kontrast, ograniczenie animacji (domyślnie wg `prefers-reduced-motion`; `reduceMotion: null` = system), podkreślanie linków, kolory dla daltonistów, wyraźny wskaźnik fokusu, odstępy ułatwiające czytanie (WCAG 1.4.12); "Przywróć domyślne". Zmiany działają od razu.
- `src/lib/accessibility.ts` - zapis JSON w localStorage `app:a11y` (ustawienia domyślne = brak klucza), nałożenie na `<html>`: atrybut `data-a11y-text="112|125|150"` + klasy `a11y-contrast`, `a11y-reduce-motion`, `a11y-underline-links`, `a11y-colorblind`, `a11y-focus`, `a11y-spacing`; synchronizacja kart (`storage`) i zmian systemowego "ogranicz ruch". `initAccessibility()` w `main.tsx`, hook `src/hooks/useAccessibilitySettings.ts` (`useSyncExternalStore`). Bez zapisu w bazie.
- Kolory dla daltonistów (zaburzenia czerwono-zielone): palety Tailwind `emerald` i `green` są w `tailwind.config.ts` zmiennymi `--palette-<nazwa>-<odcień>` (kanały RGB, więc działają modyfikatory `/10` itd.); plugin `addBase` ustawia je na `:root` z domyślnych kolorów, a pod `html.a11y-colorblind` na paletę `blue`. Zieleń = „w porządku” (załatwione, w limicie, sukces) staje się niebieska i nie myli się z czerwonym/pomarańczowym/bursztynowym. Nowy kolor „sukcesu”: używaj `emerald-*`, nie hex ani `teal`/`lime`.
- Bez mignięcia: `public/a11y-init.js` - zwykły synchroniczny skrypt w `<head>` `index.html` (CSP `script-src 'self'` blokuje inline) nakłada te same klasy przed pierwszym malowaniem; logika zdublowana z `accessibility.ts` (zmiana klucza/klas = oba pliki). Działa też na stronie publicznej i `/login`.
- Style: blok "Ustawienia dostępności" na końcu `src/index.css` (rozmiar = `font-size` na `html` w %, kontrast = nadpisane zmienne `--foreground`/`--muted-foreground`/`--border`/`--input`/...; strona publiczna ma własne wartości kontrastu per szablon w `src/lib/publicTheme.ts`; tryb `.dark` nieużywany). Skalowanie obejmuje arbitralne `text-[13px]`: `postcss.config.js` zamienia px w `font-size`/`line-height` na rem (13px → 0.8125rem; przy 100% wygląd bez zmian). Zapytania kontenerowe `@sm:`... są w rem, więc przy dużym tekście moduły przechodzą na węższy układ; breakpointy viewportu (`md:` 768px) bez zmian. Nowy kod: rozmiary tekstu w rem lub `text-[Npx]` (oba się skalują), nie inline `style={{ fontSize }}` w px.

### Public homepage (PublicLayout)
- Cała treść strony publicznej pochodzi z `useSiteContent()` (`identity` + `homepage`, RPC `get_public_site_content`, `src/lib/siteContent.ts`); w kodzie nie ma danych posła. Do odpowiedzi RPC szkielet (`src/components/public/PublicPageSkeleton.tsx`, bez mignięcia domyślnych tekstów); błąd RPC → `DEFAULT_SITE_CONTENT`, biura/kalendarz/formularz działają dalej.
- `src/components/layout/PublicLayout.tsx` - belka promo (tylko `promo.enabled` + `href`), BrandMark z `mp_name`, nawigacja = włączone sekcje (`nav_label` + `HOMEPAGE_SECTION_ANCHORS`) + `external_links`, stopka (tagline, "Na stronie" z włączonych sekcji, "Kontakt": biura gdy sekcja włączona + `website_url` jako hostname, `© {rok} {footer.copyright}`). Ustawia `document.title` = `seo.title` i meta description; przy wyjściu przywraca wartości z index.html.
- `src/pages/HomePage.tsx` - hero (kicker, "Biuro Poselskie {mp_name_genitive}", lead, przyciski do #zglos/#biura ukryte przy wyłączonej sekcji; zdjęcie `identity.photo_url`, bez zdjęcia hero jednokolumnowy), potem sekcje w kolejności `homepage.sections` (tylko `enabled`), tła naprzemiennie krem/biel wg pozycji.
- `src/components/public/PublicOfficesMap.tsx` (props `title`, `caption`), `PublicCalendarSection.tsx` (props `title`, `description`, `className`), `PublicSubmissionForm.tsx` (prop `identity` - zgody "Biuro Poselskie {dopełniacz}" / "Posła|Posłanki {dopełniacz}").
- Zdjęcie posła: bucket `site-assets` (upload z panelu). Nadtytuł hero pusty → `identity.district_label`; mapa okręgu tylko przy `offices.show_map` (geojson jest dziś wyłącznie dla okręgu 35).
- `src/components/public/PublicOfficeCard.tsx` - rozwijana karta biura (klik → expand → lista pracowników z avatarami przez `usePublicOfficeStaff`)

### Wygląd strony publicznej (szablony + kolor przewodni)
- `homepage.appearance = { template, brand_color }` w `app_settings.homepage` (bez migracji; brak pola = `klasyczny` + kolor domyślny szablonu). `template` ∈ `PUBLIC_TEMPLATE_IDS` (`src/lib/siteContent.ts`): `klasyczny` (dotychczasowy krem/grafit, Poppins), `nowoczesny` (chłodna biel, Inter, duże zaokrąglenia), `elegancki` (Source Serif 4 w nagłówkach, hero wyśrodkowane z okrągłym portretem), `wyrazisty` (hero na kolorze przewodnim, wersaliki, ostre narożniki), `ciemny` (grafitowe tło, `color-scheme: dark`, Turnstile w trybie dark). `brand_color` = `#rrggbb` albo `''`.
- `src/lib/publicTheme.ts` - jedno źródło szablonów (`PUBLIC_TEMPLATES`: paleta, nadpisania wysokiego kontrastu, fonty, `--radius`, zaokrąglenie kart, układ hero `split|centered|band`, kolor domyślny). `resolveBrand()` przesuwa jasność koloru przewodniego (odcień i nasycenie bez zmian) do kontrastu ≥ 4.5:1 z tłem i kartą szablonu (7:1 przy `a11y-contrast`), dobiera biały/atramentowy tekst na kolorze i kolor hover. `publicThemeVars()` zwraca stały zestaw zmiennych CSS.
- `PublicLayout` (`usePublicTheme`) nakłada na `<html>` klasę `.theme-public`, `data-public-template` i zmienne jako styl inline (wygrywa z `.dark` i `html.a11y-contrast`; reaguje na przełączenie wysokiego kontrastu), cleanup zdejmuje wszystko. Do odpowiedzi RPC ostatni wygląd z localStorage `app:public-appearance` (bez mignięcia szablonu domyślnego u powracających gości).
- CSS (`src/index.css`): fonty z `--public-font-body`/`--public-font-heading` (h1-h3), charakter nagłówków `elegancki`/`wyrazisty` po `data-public-template`, `.public-brand-surface` (hero `band`) odwraca role zmiennych, więc te same klasy (`bg-card`, `text-brand`, `publicBtn`) dają odwrócone kolory. Karty publiczne: `rounded-[var(--public-radius-card)]`; znaczniki Sejmu w kalendarzu `bg-foreground` (widoczne także w szablonie ciemnym).
- Panel: `AppearanceCard` w edytorze strony głównej - 5 kart szablonów z miniaturą (paleta + układ hero + bieżący kolor po korekcie), gotowe kolory + „Domyślny szablonu”, `<input type="color">` i pole `#RRGGBB`; komunikat, jaki odcień trafi na stronę i czy został skorygowany.

### Edycja strony głównej (admin, `/biuro/admin/strona-główna`)
- Trasa w bloku RoleGuard `['posel','administrator']` obok `admin/biura` (bez `DesktopOnlyRoute` - działa też na telefonie); pozycja "Strona główna" (`LayoutTemplate`) w `ADMIN_NAV_ITEMS`.
- `src/pages/admin/StronaGlowna.tsx` - `useSiteContent()` → skeleton / `ErrorNotice` / `HomepageEditor`; w nagłówku link "Otwórz stronę główną" (`/`, nowa karta).
- `src/components/admin/homepage/HomepageEditor.tsx` - jeden formularz RHF + `zodResolver(z.object({ identity: siteIdentitySchema, homepage: homepageSchema }))` (schematy z `src/lib/siteContent.ts`), `FormProvider` dla kart. Zapis `useUpdateSiteContent()` wysyła pełny `SiteContent` (oba klucze `app_settings`), po sukcesie `form.reset(values)`; świeże dane z serwera resetują formularz tylko bez lokalnych zmian. Przyklejony pasek zapisu (nad BottomNav na telefonie): status, "Cofnij zmiany", "Zapisz" aktywne przy `isDirty`. Brak ostrzeżenia przy opuszczaniu strony (w projekcie nie ma wzorca `useBlocker`/`beforeunload`).
- Karty: `IdentityCard` (dane posła + `SitePhotoField`: podgląd na ciemnym tle, upload `useUploadSiteAsset()` do bucketu `site-assets`, "Usuń" czyści URL - plik zostaje w bucketcie), `HeroCard`, `SectionsCard` (kolejność strzałkami + widoczność `homepage.sections` przez `setValue`, pod każdą sekcją jej pola; przełącznik mapy `offices.show_map`; kroki zgłoszenia `SubmitStepsField` - `useFieldArray`, max 6), `NavigationCard` (linki zewnętrzne max 4 + belka promocyjna), `FooterSeoCard` (SEO tylko po JS - `index.html`/`og:*` zostają statyczne).
- `src/components/admin/homepage/fields.tsx` - `TextField` (Label `htmlFor`, `aria-invalid`/`aria-describedby`, błąd zod albo podpowiedź), `CheckboxField` (natywny checkbox jak w innych formularzach - w `src/components/ui` nie ma Switch), `FieldGroup`, `RowControls` (w górę / w dół / usuń); `fieldId.ts` - id pola ze ścieżki formularza.

### Raporty PDF
- `src/lib/printDocument.ts` - `openPrintHtml({ title, subtitle, bodyHtml, identity })` otwiera nowe okno z A4 layoutem (font systemowy, footer z data wygenerowania, auto `window.print()`). Nagłówek: "Biuro Poselskie {mp_name_genitive} · {district_label}" (brakujące części pomijane), stopka: `window.location.host`. Funkcja nie jest hookiem - wywołujący (`Sprawy`, `Teren`, `admin/AuditLog`) przekazują `useSiteContent().data?.identity` (`undefined` = neutralny nagłówek). Plus eksportowany `escapeHtml` dla buildowania bezpiecznego HTML.
- `src/lib/reports.ts` - buildery: `buildAuditReport`, `buildCasesReport`, `buildVisibilityReport`. Każdy zwraca `{title, subtitle, bodyHtml}` z statystykami (kafelki) + tabela danych.
- Przyciski "Eksportuj PDF": `/biuro/admin/audit`, `/biuro/sprawy`, `/biuro/teren`

### Newsletter - dane posła
- `src/lib/newsletter/render.ts` - `renderNewsletter(t, { mode, webUrl, identity })`; `identity: NewsletterIdentity` (`mp_name`, `mp_title`, `mp_gender` z `useSiteContent().data.identity`) jest wymagane. Nagłówek: `mp_name` (alt avatara, inicjały w kółku bez zdjęcia) + `mp_title · header.region_label` (pusty region pomijany; pusty tytuł → `mpForms(gender).nominative` + " na Sejm RP"). RODO: "Administratorem ... jest {mp_name}, {mp_title z małej litery}." - bez nazwiska nazwa biura ze stopki (`footer.office_name`, także w nagłówku). Wywołania: `NewsletterEditorDialog` (mail, wersja web) i `PreviewPane` (prop `identity`); dialog czeka na `useSiteContent` (`defaultsReady`), przy błędzie RPC - `DEFAULT_SITE_IDENTITY`.
- Region: pole szablonu `header.region_label` (zod default `''`, edycja w karcie Nagłówek), wypełniane ze stałych `app_settings.newsletter_defaults.region_label` (karta "Stałe newslettera"). Ta sama wartość to etykieta sekcji `region_news` w mailu i plain text; pusta = "Z regionu". Stare szkice (localStorage) i duplikowane wydania (`newsletter_issues.template`) bez pola dostają region ze stałych przez `mergeTemplate`. Etykieta sekcji w edytorze (`SECTION_META`) jest stała: "Z regionu". Region nie pochodzi z `district_label` (tam "Okręg wyborczy nr ..." - za długie do nagłówka).
- Defaulty w kodzie neutralne (`EMPTY_NEWSLETTER_DEFAULTS`, `DEFAULT_TEMPLATE.footer`, zod `.default('')`). Puste `office_name`/`contact_email`/`privacy_url` blokuje walidacja formularza przed wysyłką (karta Stopka). Nazwa biura bez stałej → "Biuro Poselskie {mp_name_genitive}"; e-mail bez stałej → `from_email` z GetResponse.
- Świeża instancja ma puste pola stopki, `region_label` i `getresponse_from_name` w seedzie; wartości wpisuje Poseł w panelu (karta "Stałe newslettera", Integracje → GetResponse).

### Routing
- `src/App.tsx` - BrowserRouter + Suspense + lazy-loaded strony, RoleGuard dla `/admin/*`

### Backend
- `supabase/migrations/20260425000000_init_profiles_audit.sql` - schema + RLS + helpers
- `supabase/migrations/20260426000000_init_offices.sql` - tabela offices + profiles.office_id + RLS
- `supabase/migrations/20260426400000_profiles_password_set.sql` - flaga `password_set` + update istniejących na true
- `supabase/migrations/20260427000000_offices_public_read.sql` - RLS policy dla anon na offices
- `supabase/migrations/20260427100000_profiles_public_fields.sql` - kolumny phone/avatar_url/is_public + funkcja `get_public_office_staff()`
- `supabase/migrations/20260427200000_avatars_bucket.sql` - Storage bucket `avatars` + 7 RLS policies
- `supabase/migrations/20260504000000_tighten_permissions.sql` - strict profiles_update_self + RPC `mark_my_password_set` + search_path na 8 funkcjach + drop avatars_public_read
- `supabase/migrations/20260504010000_revoke_anon_explicit.sql` - explicit REVOKE EXECUTE FROM anon na helperach RLS i triggerach
- `supabase/migrations/20260504300000_rls_aal2_hardening.sql` - wymog aal2 (TOTP) na wrazliwych tabelach (PENDING APPLY)
- `supabase/functions/admin-reset-user-mfa/index.ts` - Edge Function: Posel resetuje cudze factor-y MFA
- `supabase/migrations/20260504200000_init_privacy_pin.sql` - (historyczne) kolumna `profiles.privacy_pin_hash` + RPC `set_my_privacy_pin/verify_my_privacy_pin/clear_my_privacy_pin` (bcrypt cost 10) + recreate `profiles_update_self` z `privacy_pin_hash` w blacklist; zastąpione przez `20261018210000`
- `supabase/migrations/20260504210000_privacy_pin_digits_only.sql` - tighten `set_my_privacy_pin` walidacja do regex `^[0-9]{4,8}$` (PIN numeryczny zamiast dowolny string)
- `supabase/migrations/20260504220000_privacy_pin_extensions_schema.sql` - fix `extensions.crypt` / `extensions.gen_salt` (pgcrypto w schemie `extensions`, nie `public` — funkcje z `set search_path=public` nie widzialy pgcrypto)
- `supabase/migrations/20261018210000_security_profiles_storage.sql` - `profile_secrets` + `profiles.has_privacy_pin` (drop `privacy_pin_hash`), RPC PIN-u z obecnym PIN-em i blokadą, `profiles_select_self_or_team`, triggery audytu (profiles/offices/case_attachments/ics_sources), aal2 w RPC admina i `avatars_*_posel`, `set_created_by`
- `supabase/migrations/20261018200000_security_audit_settings_oauth.sql` - `log_audit` bez authenticated, `log_client_event`, `service_log_audit`, sekrety `app_settings`, `admin_revoke_user_sessions`
- `supabase/functions/_shared/auth.ts` - `isCallerAal2` (wymóg aal2 w Edge Functions) + `serviceAudit` (→ `service_log_audit`) + `UUID_RE`
- `supabase/functions/admin-create-user/index.ts` - Edge Function (sprawdza is_posel, walidacja office_id, invite + insert profile, audit)
- `supabase/functions/_shared/cors.ts`
- `supabase/templates/invite.html` - branded HTML template emaila zapraszającego (używa `{{ .ConfirmationURL }}`, `{{ .Data.full_name }}`)

### Konfiguracja
- `vite.config.ts` - vite-plugin-pwa, manualChunks, alias `@/`, port 8080 (dev tylko na localhost - `api/` działa tam z kluczem service_role; sieć lokalna przez `VITE_DEV_HOST=0.0.0.0`). Manifest: `id: '/'` (stała tożsamość aplikacji), `start_url: '/biuro'`.
- PWA startuje w panelu, nie na stronie publicznej (`src/lib/pwa.ts` → `isStandalonePwa()`): `main.tsx` przy starcie przepisuje `/` na `/biuro` (starsze instalacje iOS mają zapamiętany `start_url: '/'`), catch-all prowadzi na `/biuro`, wylogowanie w TopBar na `/login`. `/?podglad` (link „Otwórz stronę główną” w Admin > Strona główna) otwiera stronę publiczną także w PWA.
- `supabase/config.toml` - tylko lokalny `supabase start`: `enable_signup = false`, `site_url`/`additional_redirect_urls` z `env(INSTANCE_SITE_URL)`/`env(INSTANCE_LOGIN_URL)` (lokalnie w `.env.local`; bez nich CLI zostawia dosłowny tekst `env(...)`), neutralny temat zaproszenia. Auth instancji produkcyjnej ustawia `scripts/instances/provision.mjs`, nie `config push`.

### Wdrożenie, CSP, instancje (ADR 026)
- CSP strony = dwie polityki egzekwowane naraz: nagłówek z `vercel.json` (wspólny dla instancji: `script-src`, `object-src`, `base-uri`, `form-action`, `frame-ancestors 'none'`, `worker-src`, `manifest-src`) + `<meta http-equiv="Content-Security-Policy">` wstawiany na początek `<head>` przy buildzie przez wtyczkę `instanceCsp` w `vite.config.ts` (pełna polityka z hostem projektu Supabase z `VITE_SUPABASE_URL`: `connect-src` https+wss, `frame-src`, `img-src`; bez `frame-ancestors`, którego meta nie obsługuje). Build bez poprawnego `VITE_SUPABASE_URL` (https; http tylko localhost) kończy się błędem. W dev brak meta (preambuła React Refresh jest inline). `/n/*` i `api/newsletter-view` mają osobny CSP `sandbox`.
- `vercel.json`: `"regions": ["dub1"]` (baza w eu-west-1), HSTS `max-age=63072000` bez `includeSubDomains`/`preload` (domena klienta może być domeną główną).
- `scripts/instances/provision.mjs <ref> <domena> [--dry-run]` - Management API (`SUPABASE_ACCESS_TOKEN`): Auth (`disable_signup`, `site_url`, `uri_allow_list` = `https://<domena>/login`, hasło 12 + 4 klasy, TOTP, rotacja refresh tokenów, reautoryzacja i obecne hasło przy zmianie hasła, temat i treść zaproszenia z `supabase/templates/invite.html`), Pro (HIBP, `sessions_timebox` 30 dni, `sessions_inactivity_timeout` 7 dni; 402 = ostrzeżenie), SSL do Postgresa, sekrety Edge (`ALLOWED_ORIGINS`, `AUTH_REDIRECT_URL`, `TURNSTILE_SECRET` z env, `PUBLIC_SUBMISSION_IP_SALT` generowana tylko gdy brak). CAPTCHA na Auth nieustawiana (front nie wysyła `captchaToken`). Oczekiwane wartości w `scripts/instances/policy.mjs`.
- `scripts/instances/doctor.mjs <domena> <ref>` - tylko GET: nagłówki i CSP (nagłówek + meta z refem tej instancji, bez obcych refów), bundel (ref i klucz anon tej instancji, brak `service_role`), issuer OAuth, cron bez sekretu → 401, region funkcji, `/auth/v1/settings`, powierzchnia anon (tabele/widoki i funkcje `public` z migracji: SELECT tylko 4 słowniki, RPC tylko `get_public_*`), z tokenem: konfiguracja Auth, sekrety (nazwy), `verify_jwt` funkcji, kopie/PITR, SSL, ograniczenia sieci, historia migracji vs repo. Kod wyjścia 1 przy FAIL.
- `scripts/instances/backup.sh dump|restore` - `pg_dump -Fc` szyfrowany `age` (klucz publiczny), hasło tylko w `PGPASSWORD`/`~/.pgpass`; `restore` do nowego pustego projektu: rozszerzenia → dane auth/storage → schemat public + historia migracji → polityki `storage.objects` → zadania pg_cron. Pliki Storage poza kopią.
- CI: `.github/workflows/ci.yml` (tsc, lint, build z atrapą `VITE_SUPABASE_URL`, `pnpm audit --prod --audit-level high`), Dependabot (`.github/dependabot.yml`: npm i github-actions, co tydzień).

### Email - szablon zaproszenia

`supabase/templates/invite.html` - table-based HTML (kompatybilny z Outlook), inline styles, max 600px, dark navy header (#0f172a) "Biuro Poselskie / Zaproszenie do systemu biura" (bez danych posła), CTA button z ConfirmationURL, fallback link, sekcja "Co znajdziesz w systemie", disclaimer + footer z `{{ .SiteURL }}`.

**Aplikowanie:** `scripts/instances/provision.mjs` (temat "Zaproszenie do systemu biura poselskiego" + treść pliku). Lokalnie `supabase start` czyta `[auth.email.template.invite]` z `config.toml`.

**Zmienne template Go:**
- `{{ .ConfirmationURL }}` - link do akceptacji + ustawienia hasła
- `{{ .SiteURL }}` - `site_url` instancji (stopka)
- `{{ .Data.full_name }}` - z `inviteUserByEmail({ data: { full_name } })` w Edge Function

## Routing

| Ścieżka | Strona | Guard |
|---------|--------|-------|
| `/login` | Login | publiczna |
| `/` | Dashboard | ProtectedRoute |
| `/sprawy` | Placeholder (F3) | ProtectedRoute |
| `/kontakty` | Placeholder (F2) | ProtectedRoute |
| `/kalendarz` | Placeholder (F4) | ProtectedRoute |
| `/teren` | Placeholder (F5) | ProtectedRoute |
| `/interpelacje` | Placeholder (F6) | ProtectedRoute |
| `/profil` | Placeholder | ProtectedRoute |
| `/admin/użytkownicy` | Admin Users | RoleGuard `['poseł']` |
| `/admin/biura` | Admin Offices | RoleGuard `['poseł']` |
| `/admin/strona-główna` | Edycja strony głównej | RoleGuard `['posel','administrator']` |
| `/admin/audit` | Audit Log Viewer | RoleGuard `['poseł']` |
| `*` | redirect → `/` | - |

## Flow tworzenia użytkownika

1. (Opcjonalnie) Poseł zakłada biura przez `/admin/biura` (Pracownik/Asystent musi być do ktoregos przypisany)
2. Poseł otwiera `/admin/użytkownicy` → dialog "Dodaj użytkownika"
3. Wybiera role; jeśli rola != Poseł → Select biura wymagany. Jeśli brak biur → komunikat z linkiem do `/admin/biura`.
4. Frontend wywołuje Edge Function `admin-create-user` z body `{ email, full_name, role, office_id?, scope_*? }`
5. Edge Function:
   - Wywołuje `is_posel()` przez RPC z tokenem wywołującego (weryfikacja roli)
   - Walidacja: rola != poseł wymaga office_id; sprawdź `offices.is_active`
   - Z service_role: `auth.admin.inviteUserByEmail()` (Supabase wysyła magic link)
   - `insert into profiles (...)` z rola + office_id
   - `service_log_audit` (przez `serviceAudit`): `user.create`, aktor = wywołujący Poseł
6. Użytkownik dostaje email z linkiem → ustawia hasło → loguje się

## Biura poselskie

- Poseł zarządza biurami (`/admin/biura`): nazwa, miasto, adres, telefon, email, flaga `is_main`, `is_active`.
- Tylko jedno biuro może być oznaczone jako główne (partial unique index `where is_main = true`).
- Pracownik/Asystent **musi** mieć przypisane aktywne biuro (walidacja w Edge Function admin-create-user). Poseł - opcjonalne.
- Zmiana biura istniejącego usera: dropdown "Zmien biuro" w `/admin/użytkownicy`.
- W przyszłości (Faza 3+): biuro segmentuje sprawy/kontakty per zespol.

## Historia Zmian

| Data | Zmiana |
|------|--------|
| 2026-04-25 | Inicjalizacja - pełna Faza 1 |
| 2026-04-26 | Biura poselskie + przypisanie usera (offices, profiles.office_id, CRUD UI, walidacja w Edge Function); fix deadlock AuthContext (Supabase v2 NavigatorLock - async odłożony przez setTimeout w onAuthStateChange) |
| 2026-04-26 | Branded HTML template zaproszeń (`supabase/templates/invite.html` + `[auth.email.template.invite]` w config.toml) - table-based, inline styles, branding biura |
| 2026-04-27 | PasswordSetupScreen + flaga `profiles.password_set` (default false, update=true dla istniejących). ProtectedRoute renderuje screen gdy false. Diagnostyczny toast w Login gdy session bez profilu (brak migracji / brak rekordu) |
| 2026-04-27 | Public homepage (HomePage + PublicLayout) z sekcją biur i pracowników. Migracje: `offices_select_anon` (RLS dla anon) + `profiles_public_fields` (phone/avatar_url/is_public + RPC `get_public_office_staff`). Komponent `PublicOfficeCard` z lazy expand pracowników. |
| 2026-04-27 | Strona `/biuro/profil` (Profil.tsx) — self-edit + zmiana hasła. Dialog `EditUserProfileDialog` w admin panel — Posel edytuje pracowników. Hook `useUpdateMyProfile` (RLS `profiles_update_self`). |
| 2026-04-27 | Avatary: Storage bucket `avatars` (2 MB, JPG/PNG/WebP, public read, RLS per-folder). Hook `useUploadAvatar` + komponent `AvatarUploadButton` (file picker, cache buster `?v={updated_at}`). Avatar widoczny w PublicOfficeCard, TopBar (kolko, prawy gorny), Profil, EditUserProfileDialog. |
| 2026-04-27 | Fix `AuthContext.fetchProfile` SELECT — dodane brakujace kolumny `phone`, `avatar_url`, `is_public` (przez ich brak `refreshProfile()` zwracal undefined w tych polach, dlatego avatar po wgraniu nie pokazywal sie w UI). |
| 2026-04-27 | TopBar — `<AvatarImage>` ze zdjeciem profilowym (`profile.avatar_url`) + cache buster, fallback inicjaly w `bg-primary`. |
| 2026-05-04 | Tryb prywatny (anti-shoulder-surfing): kolumna `profiles.privacy_pin_hash` (bcrypt) + 3 RPC (set/verify/clear). Frontend: `PrivacyContext` (sessionStorage), `PrivacySetupDialog` (first-time setup z notka edukacyjna + form), `PrivacyOverlay` (fixed inset-0, backdrop-blur, avatar+input+rate limit 5 prob), button "Włącz tryb prywatny" obok avatara w TopBar (light red bg). AppShell opakowany providerem. RLS: `profiles_update_self` blokuje direct update na `privacy_pin_hash`. Migracja `20260504200000_init_privacy_pin.sql` + tighten do PIN numerycznego 4-8 cyfr `20260504210000_privacy_pin_digits_only.sql`. |
| 2026-05-04 | Admin user actions (Posel): `Wyślij ponownie zaproszenie` / `Wyślij link resetu hasła` (dynamiczna pozycja po `password_set`, Edge Function `admin-send-auth-link` z 5-min cooldown po BE), `Wyloguj ze wszystkich urządzeń` (Edge Function `admin-revoke-user-sessions` — `signOut(global)` + reset MFA jednym kliknieciem, dialog confirm `WYLOGUJ`), `Szczegóły konta` (RPC `get_user_admin_details`, dialog z last_sign_in / email_confirmed / sessions_count / mfa_factors). Migracja `20260504400000_admin_user_details.sql`. |
| 2026-10-18 | Audyt bezpieczeństwa: hash PIN-u przeniesiony do `profile_secrets` (`profiles.privacy_pin_hash` usunięte → `has_privacy_pin`), RPC `set_my_privacy_pin(p_pin, p_current_pin)` / `clear_my_privacy_pin(p_current_pin)` wymagają obecnego PIN-u, 5 błędów → blokada 15 min (wyłącznie po stronie DB). Blokada trybu prywatnego trwała per user w localStorage (`src/lib/privacyLock.ts`), treść portalu nie renderuje się przy blokadzie. `profiles` SELECT = własny wiersz lub aktywny + aal2; aal2 w RPC admina, `avatars_*_posel` i Edge Functions admina. `log_audit` niedostępne dla authenticated (MFA przez `log_client_event`, Edge Functions przez `service_log_audit`), triggery audytu profiles/offices. `admin-revoke-user-sessions` przez RPC `admin_revoke_user_sessions`, `admin-send-auth-link` faktycznie wysyła mail. Wylogowanie czyści cache react-query + "Ostatnie" wyszukiwarki. Migracje `20261018200000_security_audit_settings_oauth.sql`, `20261018210000_security_profiles_storage.sql`. |
| 2026-10-25 | Nawigacja mobilna: cztery główne zakładki + "Więcej" z pełną szufladą, aktywny stan dla pozostałych sekcji i powrót do rodzica na podstronach. Literę "e" na niebieskim tle zastąpiło godło w TopBarze, Sidebarze i ekranach logowania. |
| 2026-10-26 | PoliAI na desktopie dzieli wyłącznie obszar pod TopBarem na dokładne 50/50 (moduł + panel); TopBar pozostaje pełnej szerokości. Moduły korzystają z container queries (`@tailwindcss/container-queries`, `@container`, warianty `@max-*`) oraz `useModuleNarrow`, dzięki czemu dashboard, listy, kalendarz, interpelacje, budżet, puls i administracja dopasowują układ do połowy ekranu bez udawania telefonu. |
| 2026-11-02 | Zakres danych (own/all) per moduł ustawiany już przy dodawaniu użytkownika: `CreateUserDialog` pokazuje panel `DataScopeFields` (wydzielony z `EditUserProfileDialog`) dla Pracownika/Asystenta, `admin-create-user` przyjmuje i waliduje `scope_*` i zapisuje je w profilu oraz w audycie. |
| 2026-11-04 | Edycja publicznej strony głównej w panelu admina: `/biuro/admin/strona-główna` (Poseł/Administrator, także na telefonie) - jeden formularz RHF/zod na `SiteContent` (dane posła ze zdjęciem w `site-assets`, hero, kolejność/widoczność/treść sekcji z krokami, linki w menu, belka promocyjna, stopka, SEO), zapis do `app_settings` (`site_identity`, `homepage`). |
| 2026-11-07 | Portal bez danych posła w kodzie: podpis w Sidebarze i na ekranach auth (`BrandMark`) = `identity.mp_name`, opis logowania z `district_label`, placeholder e-maila z domeny instancji, nagłówek/stopka raportów PDF z `identity` + `window.location.host` (parametr `identity` w `openPrintHtml`), friendlyName TOTP "eBiuro - {mp_name}" (fallback host), neutralne placeholdery (Kraków) w formularzach biura/wydarzenia/wydatku, opis bazy kontaktów bez numeru okręgu. |
| 2026-11-07 | Bezpieczeństwo frontu: PoliAIMarkdown nie renderuje obrazków (tylko `alt`) i przepuszcza linki tylko http(s)/mailto/tel oraz ścieżki aplikacji (bez `//`, `\`), `rel="noopener noreferrer nofollow"`. Wspólna polityka haseł `src/lib/password.ts` (min. 12 znaków, mała/wielka litera, cyfra, znak specjalny jak w GoTrue) w PasswordSetupScreen i Profilu. Błędy triggerów profili (42501 własna rola/aktywność, 23514 ostatni Poseł) i body `{ error }` Edge Functions (`functionErrorMessage`) trafiają do toastów. Lista tokenów MCP pokazuje termin ważności (domyślnie 90 dni) i stan "Wygasł". Zależności: zod 4 (`zodFormResolver` w `src/lib/zodForm.ts` dla formularzy z `z.coerce`/`.default`), react-router-dom 7, @hookform/resolvers 5, overrides pnpm w `pnpm-workspace.yaml` (postcss, nanoid, source-map-js, postcss-selector-parser, ws, fast-uri). |
| 2026-11-07 | Bezpieczeństwo (R41/R56/R2-03): link odzyskania hasła wymusza PasswordSetupScreen (`passwordRecovery` w AuthContext), zmiana hasła w Profilu z ponownym uwierzytelnieniem kodem z e-maila (`reauthenticate()` + `nonce`), CSP `img-src` portalu tylko `'self' data: blob:` + storage Supabase instancji (zewnętrzne linki do obrazków w edytorze newslettera nie mają podglądu w portalu). |
| 2026-11-07 | Produkt Legatto: nazwa tylko w stopce `ProductCredit` ("This is Legatto. Built by no-fuss.") na dole Sidebara/szuflady mobilnej, pod kartą `AuthLayout` i w stopce `PublicLayout`. Usunięte marki ePosel/e-Biuro z UI, API, MCP i PWA (nazwa opisowa: "Biuro Poselskie", mobilny TopBar/PWA short_name: "Biuro"). Neutralne identyfikatory: klucze storage `app.*`/`app:*`, MCP `serverInfo.name` = `office-mcp` (marker w `McpTestPanel`), `X-Client-Info` `office-mcp/1.0`, User-Agent ICS `Office-Calendar-Sync/1.0`, paczka `office-portal`. GUC/advisory locki w SQL i `project_id` Supabase bez zmian. |
| 2026-11-09 | Ustawienia dostępności w `/biuro/profil` (rozmiar tekstu, wysoki kontrast, ograniczenie animacji, podkreślanie linków, wyraźny fokus, odstępy do czytania) - per urządzenie (`app:a11y`), przed malowaniem przez `public/a11y-init.js`, style na końcu `index.css`; `postcss.config.js` zamienia px w font-size na rem, żeby skalowały się też `text-[Npx]`. Profil: nowa kolejność sekcji (konto i bezpieczeństwo, potem preferencje), "Tryb prywatny" także na komputerze, bez zdublowanego e-maila/roli w opisie "Dane podstawowe". |
| 2026-11-09 | Przegląd UI/UX shellu i prymitywów: `DialogFooter` z `!-mb-6` (koniec pustego pasa pod przyciskami w formularzach `space-y-*`), `DialogContent` domyślnie przewijany na desktopie (`max-h-[90vh]`) i `grid-cols-1`, `AlertDialog` jako arkusz od dołu na telefonie (bez podwójnego odstępu `Cancel`), Tailwind `hoverOnlyWhenSupported`, `PageHeader` (ikona przy tytule, akcje bez zawijania obok PoliAI), wyszukiwarka i toasty pod safe-area z krótszym placeholderem na telefonie, duże pola kodu 2FA/PIN także na desktopie, `FilterChip` z pierścieniem fokusu, etykiety TopBar/BottomNav odporne na powiększony tekst, `text-balance` w tekstach ekranów logowania. |
| 2026-11-10 | Bezpieczeństwo PoliAI (API-OTHER-3/6, FRONTEND-3): linki z odpowiedzi modelu poza panel (`ExternalLink.tsx`, reguły w `linkSafety.ts`) pokazują host (mailto: adresata) obok tekstu; bez potwierdzenia otwiera się tylko własny origin i `https` na `gov.pl` (z subdomenami, m.in. `sejm.gov.pl`) bez query, fragmentu i danych logowania w adresie, każdy inny link (oraz `mailto:` z parametrami) najpierw pokazuje pełny adres w `AlertDialog`. Karta zatwierdzenia (`PoliAIApproval`) pokazuje pełne wartości - powyżej 300 znaków w przewijanym bloku z licznikiem znaków (bez ucinania). System prompt: zakaz linków zewnętrznych z danymi z rozmowy w adresie. Migracja `20261110130000_poliai_scope_change_purge.sql`: zmiana roli, dowolnego `scope_*` albo dezaktywacja usuwa wszystkie rozmowy PoliAI (historia, streszczenia, pamięć) i załączniki użytkownika (audyt `poliai.history_purged`), pliki z bucketu sprząta cron `poliai-purge`. |
| 2026-11-11 | TopBar: dzwonek powiadomień w portalu (`NotificationBell`) między trybem prywatnym a menu konta; na telefonie „Włącz tryb prywatny” przeniesione do menu konta, przyciski TopBara i `PoliAITrigger` ze stałym obszarem 44 px. `AuthContext`: `realtime.setAuth` po `MFA_CHALLENGE_VERIFIED`. |
| 2026-11-12 | Wspólne pole wyboru z wyszukiwaniem `SearchSelect` (`ui/search-select.tsx`) we wszystkich polach wyboru rekordu: wydarzenie (powiat, gmina, powiązana sprawa i kontakt z wyszukiwaniem po stronie serwera, osoba), dokumenty (powiązana sprawa, dokument do podpisu), sprawy (kategoria, lokalizacja, osoba zgłaszająca - bez progu 2 znaków, przepisanie sprawy), kontakty (powiat/gmina w formularzu, zmianie masowej i imporcie), formularz publiczny, admin (biura, osoby modułów, model AI, GetResponse), newsletter, wydatki (kategoria, filtr, pozycja rozliczenia), Puls biura, Interpelacje (odbiorca). |
