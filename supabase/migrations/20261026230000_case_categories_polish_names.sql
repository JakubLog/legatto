-- Nazwy systemowych kategorii spraw jak w seedzie 20260425200000_init_cases.sql (z polskimi znakami).
--
-- Produkcja ma 'Polityka spoleczna' i 'Bezpieczenstwo' (stara wersja seeda) - te nazwy widzi
-- UI i PoliAI (case_categories_list, category_name). Zmiana po id + starej nazwie, wiec na bazie
-- z poprawnymi nazwami albo z kategoria przemianowana przez uzytkownika nic sie nie dzieje.

update public.case_categories
   set name = 'Polityka społeczna', slug = 'polityka-społeczna'
 where is_system and name = 'Polityka spoleczna';

update public.case_categories
   set name = 'Bezpieczeństwo', slug = 'bezpieczeństwo'
 where is_system and name = 'Bezpieczenstwo';
