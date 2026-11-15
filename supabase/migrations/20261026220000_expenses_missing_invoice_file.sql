-- ePosel - Budzet biura: oznaczenie wydatkow bez pliku faktury / paragonu
--
-- office_expenses.missing_invoice_file = brak skanu w buckecie 'receipts' (receipt_path is null).
-- Kolumna generowana (stored): zawsze zgodna z receipt_path, bez triggerow i bez zapisu z klienta.
-- Czytaja ja aplikacja (select na office_expenses jak dotad) i narzedzia MCP/PoliAI
-- (budget_list - kolumna + filtr, budget_get). Indeks czesciowy pod liste brakow.

alter table public.office_expenses
  add column if not exists missing_invoice_file boolean
  generated always as (receipt_path is null) stored;

comment on column public.office_expenses.missing_invoice_file is
  'true = wydatek nie ma dodanego pliku faktury/paragonu (receipt_path is null). Kolumna generowana.';

create index if not exists office_expenses_missing_invoice_file_idx
  on public.office_expenses (expense_date desc)
  where missing_invoice_file;
