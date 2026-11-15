-- ePosel - Budżet biura: kategorie wydatków = pozycje sprawozdania z wydatkowania ryczałtu
--
-- Słownik kategorii to od teraz wyłącznie kategorie numeryczne "01."-"22." zgodne z pozycjami
-- sprawozdania (20261107300000_budget_settlement.sql). Dotychczasowe kategorie systemowe z seeda
-- (Czynsz i media, Materiały biurowe, ..., Inne) znikają:
--   1. brakujące kategorie "NN. ..." są dopisywane (zwykłe, nie systemowe - Poseł może je
--      zmieniać jak dotychczasowe kategorie numeryczne), z przypisaną pozycją,
--   2. wydatki z kategorii systemowej przechodzą do kategorii numerycznej z tą samą pozycją
--      sprawozdania (settlement_item); brak odpowiednika przy istniejących wydatkach = błąd
--      migracji (nie gubimy kategorii wydatków po cichu),
--   3. kategorie systemowe są usuwane.
-- Kategoria pozycji 22 ("22. Inne wydatki") ma pozycję 22.5; podpozycje 22.1-22.4 tworzy się
-- w razie potrzeby jako osobne kategorie.

-- 1. Brakujące kategorie numeryczne (przed przeniesieniem wydatków - mogą być celem).
insert into public.expense_categories (name, slug, is_system, settlement_item)
select v.name, v.slug, false, v.item
from (values
  ('01. Wynagrodzenia pracowników (umowy o pracę)', '01-wynagrodzenia-pracownikow', '1', 1),
  ('02. Umowy cywilnoprawne', '02-umowy-cywilnoprawne', '2', 2),
  ('03. Badania lekarskie i szkolenia pracowników', '03-badania-lekarskie-i-szkolenia', '3', 3),
  ('04. Świadczenia urlopowe pracowników', '04-swiadczenia-urlopowe', '4', 4),
  ('05. Usługi doradcze i eksperckie', '05-uslugi-doradcze-i-eksperckie', '5', 5),
  ('06. Usługi telekomunikacyjne', '06-uslugi-telekomunikacyjne', '6', 6),
  ('07. Usługi pocztowe, ogłoszenia i informacje', '07-uslugi-pocztowe-ogloszenia-i-informacje', '7', 7),
  ('08. Organizacja spotkań z wyborcami', '08-organizacja-spotkan-z-wyborcami', '8', 8),
  ('09. Przejazdy posła - w okręgu', '09-przejazdy-posla-w-okregu', '9', 9),
  ('10. Przejazdy posła - poza okręgiem', '10-przejazdy-posla-poza-okregiem', '10', 10),
  ('11. Najem pojazdu, taksówki, przewóz osób', '11-najem-pojazdu-taksowki-przewoz-osob', '11', 11),
  ('12. Podróże służbowe pracowników', '12-podroze-sluzbowe-pracownikow', '12', 12),
  ('13. Podróże asystentów i zleceniobiorców', '13-podroze-asystentow-i-zleceniobiorcow', '13', 13),
  ('14. Obsługa bankowa i księgowa', '14-obsluga-bankowa-i-ksiegowa', '14', 14),
  ('15. Strona www, social media, subskrypcje', '15-strona-www-social-media-subskrypcje', '15', 15),
  ('16. Najem lokalu biura', '16-najem-lokalu-biura', '16', 16),
  ('17. Konserwacja i naprawa sprzętu', '17-konserwacja-i-naprawa-sprzetu', '17', 17),
  ('18. Drobne naprawy i remonty lokalu', '18-drobne-naprawy-i-remonty-lokalu', '18', 18),
  ('19. Środki trwałe i wyposażenie', '19-srodki-trwale-i-wyposazenie', '19', 19),
  ('20. Materiały biurowe, prasa, wydawnictwa', '20-materialy-biurowe-prasa-wydawnictwa', '20', 20),
  ('21. Środki czystości, art. dekoracyjne', '21-srodki-czystosci-art-dekoracyjne', '21', 21),
  ('22. Inne wydatki', '22-inne-wydatki', '22.5', 22)
) as v(name, slug, item, n)
where not exists (
  -- Pozycja ma już kategorię z numerem w nazwie ("2. ...", "02. ...", "02) ...").
  select 1 from public.expense_categories c
  where (substring(c.name from '^\s*(\d{1,2})\s*[.)]'))::int = v.n
)
and not exists (select 1 from public.expense_categories c where c.name = v.name or c.slug = v.slug);

-- 2. Wydatki z kategorii systemowych -> kategoria numeryczna z tą samą pozycją sprawozdania.
do $$
declare
  v_orphans integer;
begin
  update public.office_expenses e
  set category_id = t.target_id
  from (
    select s.id as source_id, (
      select n.id
      from public.expense_categories n
      where not n.is_system
        and n.settlement_item = s.settlement_item
        and n.name ~ '^\s*\d{1,2}\s*[.)]'
      order by n.id
      limit 1
    ) as target_id
    from public.expense_categories s
    where s.is_system
  ) t
  where e.category_id = t.source_id
    and t.target_id is not null;

  select count(*) into v_orphans
  from public.office_expenses e
  join public.expense_categories c on c.id = e.category_id
  where c.is_system;

  if v_orphans > 0 then
    raise exception 'Wydatki (%) w kategoriach systemowych bez odpowiednika numerycznego - przypisz pozycję sprawozdania przed migracją', v_orphans;
  end if;
end $$;

-- 3. Usunięcie kategorii systemowych.
delete from public.expense_categories where is_system;
