-- ============================================================================
-- Rola Administrator (1/2): nowa wartosc enum app_role
-- ============================================================================
-- Administrator ma te same uprawnienia co Posel - rozni sie tylko nazwa.
-- Osobny plik, bo nowej wartosci enum nie mozna uzyc w tej samej transakcji,
-- w ktorej zostala dodana. Funkcje uprawnien: 20261023100001_administrator_role.sql.

alter type public.app_role add value if not exists 'administrator' after 'posel';
