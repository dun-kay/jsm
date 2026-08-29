alter table public.products
add column if not exists display_amount_cents integer,
add column if not exists display_currency text;

update public.products
set display_amount_cents = 499,
    display_currency = 'AUD'
where id = '44444444-4444-4444-8444-444444444441';

create or replace view public.public_product_options
with (security_invoker = true)
as
select
  pe.episode_id,
  p.id as product_id,
  p.name,
  p.active,
  p.display_amount_cents,
  p.display_currency
from public.product_episodes pe
join public.products p on p.id = pe.product_id
where p.active = true;

grant select (id, name, active, display_amount_cents, display_currency)
on public.products to anon, authenticated;

grant select on public.public_product_options to anon, authenticated;
