-- Integralnosc plikow faktur/paragonow (bucket 'receipts') po dodaniu podpinania przez MCP
-- (api/_lib/tools/budget.ts: budget_receipt_upload_url + budget_receipt_attach).
--
-- 1. Jeden plik = jeden wydatek. Podmiana pliku usuwa poprzedni z magazynu, wiec wspoldzielony
--    plik zniknalby drugiemu wydatkowi. Indeks unikalny zamyka tez wyscig dwoch rownoleglych
--    podpiec tego samego pliku (23505 zamiast cichego wspoldzielenia).
-- 2. receipts_orphan_objects(): pliki starsze niz 7 dni, na ktore nie wskazuje zaden wydatek
--    (wgrane przez upload_url i nigdy niepodpiete, porzucony formularz w aplikacji). Usuwa je
--    cron /api/cron/poliai-purge przez Storage API (DELETE na storage.objects zostawilby pliki).
--    7 dni: czas na zgode uzytkownika na podmiane (replace) i formularz otwarty dluzej niz dobe.

create unique index if not exists office_expenses_receipt_path_key
  on public.office_expenses (receipt_path)
  where receipt_path is not null;

create or replace function public.receipts_orphan_objects(max_rows integer)
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select o.name
    from storage.objects o
   where o.bucket_id = 'receipts'
     and o.created_at < now() - interval '7 days'
     and not exists (select 1 from public.office_expenses e where e.receipt_path = o.name)
   order by o.created_at
   limit greatest(coalesce(max_rows, 0), 0);
$$;

revoke all on function public.receipts_orphan_objects(integer) from public, anon, authenticated;
grant execute on function public.receipts_orphan_objects(integer) to service_role;
