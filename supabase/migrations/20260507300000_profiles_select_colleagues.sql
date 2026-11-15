-- ePosel — rozszerzenie SELECT policy na profiles
--
-- Problem: profiles_select_self (id = auth.uid()) blokuje JOINy na creator/assigned,
-- zwracając null dla wszystkich profili poza zalogowanym użytkownikiem.
-- Efekt: avatar i full_name twórcy/przypisanego nigdy nie ładują się dla innych.
--
-- Rozwiązanie: zastąpienie restrykcyjnej policy szerszą — każdy authenticated może
-- czytać każdy profil. Bezpieczne bo:
--   1. App wewnętrzna (biuro poselskie, ~3-5 osób)
--   2. is_posel() / is_writer() mają SET row_security = off — brak ryzyka rekursji
--   3. Dane w profiles (email, phone, avatar_url) to dane współpracowników, nieistotne PII

drop policy if exists profiles_select_self on public.profiles;

create policy profiles_select_authenticated
on public.profiles for select
to authenticated
using (true);
