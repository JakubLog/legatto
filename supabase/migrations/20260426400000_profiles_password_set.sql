-- ePosel - Faza 1.2: Flaga password_set dla wymuszenia ustawienia hasła
-- po pierwszym logowaniu z linku zapraszającego.
-- Edge Function admin-create-user tworzy profil z password_set=false (default).
-- Po pierwszym pomyślnym `auth.updateUser({ password })` frontend ustawia flagę na true.

alter table public.profiles
  add column password_set boolean not null default false;

-- Istniejący użytkownicy (już logujący się hasłem) nie powinni dostawać dialogu.
update public.profiles set password_set = true;
