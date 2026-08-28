create or replace view public.public_series_catalog
with (security_invoker = true)
as
select
  id as series_id,
  title,
  slug,
  description,
  cover_image,
  status
from public.series
where status = 'active';

create or replace view public.public_episode_catalog
with (security_invoker = true)
as
select
  e.id as episode_id,
  s.id as series_id,
  s.slug as series_slug,
  se.id as season_id,
  se.season_number,
  se.title as season_title,
  e.episode_number,
  e.title,
  e.slug,
  e.preview_html,
  e.published,
  e.published_at
from public.episodes e
join public.seasons se on se.id = e.season_id
join public.series s on s.id = se.series_id
where e.published = true;

create or replace view public.public_product_options
with (security_invoker = true)
as
select
  pe.episode_id,
  p.id as product_id,
  p.name,
  p.active
from public.product_episodes pe
join public.products p on p.id = pe.product_id
where p.active = true;

create or replace view public.public_account_library
with (security_invoker = true)
as
select distinct
  p.user_id,
  s.title as series_title,
  s.slug as series_slug,
  se.season_number,
  e.episode_number,
  e.title as episode_title
from public.purchases p
join public.product_episodes pe on pe.product_id = p.product_id
join public.episodes e on e.id = pe.episode_id
join public.seasons se on se.id = e.season_id
join public.series s on s.id = se.series_id
where p.status = 'paid'
  and p.user_id = auth.uid()
  and e.published = true;

grant select on public.public_series_catalog to anon, authenticated;
grant select on public.public_episode_catalog to anon, authenticated;
grant select on public.public_product_options to anon, authenticated;
grant select on public.public_account_library to authenticated;
