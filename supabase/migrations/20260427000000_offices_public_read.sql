-- Public homepage może pokazywać liste biur niezalogowanym (anonymous).
-- Tylko aktywne biura, tylko podstawowe pola (RLS filtruje wiersze; kolumny ograniczane przez SELECT w hookach).

create policy offices_select_anon
on public.offices for select
to anon
using (is_active = true);
