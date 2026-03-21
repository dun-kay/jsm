-- Switch access payment default currency to USD for new records.
alter table if exists public.access_payments
  alter column currency set default 'usd';
