create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  marketing_consent boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.series (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  description text not null default '',
  cover_image text,
  status text not null default 'active' check (status in ('active', 'archived'))
);

create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.series(id) on delete cascade,
  season_number integer not null check (season_number > 0),
  title text not null,
  unique (series_id, season_number)
);

create table public.episodes (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  episode_number integer not null check (episode_number > 0),
  title text not null,
  slug text not null,
  preview_html text not null default '',
  paid_html text not null default '',
  published boolean not null default false,
  published_at timestamptz,
  unique (season_id, episode_number),
  unique (season_id, slug)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  stripe_price_id text not null unique,
  active boolean not null default true
);

create table public.product_episodes (
  product_id uuid not null references public.products(id) on delete cascade,
  episode_id uuid not null references public.episodes(id) on delete cascade,
  primary key (product_id, episode_id)
);

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  stripe_session_id text not null unique,
  status text not null check (status in ('pending', 'paid', 'failed', 'refunded')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.series enable row level security;
alter table public.seasons enable row level security;
alter table public.episodes enable row level security;
alter table public.products enable row level security;
alter table public.product_episodes enable row level security;
alter table public.purchases enable row level security;

revoke all on public.profiles from anon, authenticated;
revoke all on public.series from anon, authenticated;
revoke all on public.seasons from anon, authenticated;
revoke all on public.episodes from anon, authenticated;
revoke all on public.products from anon, authenticated;
revoke all on public.product_episodes from anon, authenticated;
revoke all on public.purchases from anon, authenticated;

create policy "Users can read their own profile"
  on public.profiles for select
  to authenticated
  using (id = auth.uid());

create policy "Users can update their own marketing consent"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "Users can read their own purchases"
  on public.purchases for select
  to authenticated
  using (user_id = auth.uid());

create view public.public_series_catalog as
select
  id as series_id,
  title,
  slug,
  description,
  cover_image,
  status
from public.series
where status = 'active';

create view public.public_episode_catalog as
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

create view public.public_product_options as
select
  pe.episode_id,
  p.id as product_id,
  p.name,
  p.active
from public.product_episodes pe
join public.products p on p.id = pe.product_id
where p.active = true;

create view public.public_account_library as
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

create or replace function public.user_has_episode_access(requested_episode_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.purchases p
    join public.product_episodes pe on pe.product_id = p.product_id
    join public.episodes e on e.id = pe.episode_id
    where p.user_id = auth.uid()
      and p.status = 'paid'
      and pe.episode_id = requested_episode_id
      and e.published = true
  );
$$;

create or replace function public.get_episode_paid_content(requested_episode_id uuid)
returns table (paid_html text)
language sql
stable
security definer
set search_path = public
as $$
  select e.paid_html
  from public.episodes e
  where e.id = requested_episode_id
    and e.published = true
    and public.user_has_episode_access(requested_episode_id);
$$;

create or replace function public.set_marketing_consent(consent boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set marketing_consent = consent
  where id = auth.uid();
end;
$$;

grant execute on function public.user_has_episode_access(uuid) to authenticated;
grant execute on function public.get_episode_paid_content(uuid) to authenticated;
grant execute on function public.set_marketing_consent(boolean) to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (id) do update
  set email = excluded.email;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

insert into public.series (id, title, slug, description, cover_image, status)
values (
  '11111111-1111-4111-8111-111111111111',
  'Blackwater Bay',
  'blackwater-bay',
  'A coastal mystery where old water keeps bringing up new trouble.',
  'Frame 296.png',
  'active'
)
on conflict (slug) do update
set title = excluded.title,
    description = excluded.description,
    cover_image = excluded.cover_image,
    status = excluded.status;

insert into public.seasons (id, series_id, season_number, title)
values (
  '22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111',
  1,
  'Season One'
)
on conflict (series_id, season_number) do update
set title = excluded.title;

insert into public.episodes (id, season_id, episode_number, title, slug, published, published_at)
values
  ('33333333-3333-4333-8333-333333333331', '22222222-2222-4222-8222-222222222222', 1, 'The Drowned Boy', 'the-drowned-boy', true, now()),
  ('33333333-3333-4333-8333-333333333332', '22222222-2222-4222-8222-222222222222', 2, 'The Lighthouse', 'the-lighthouse', true, now()),
  ('33333333-3333-4333-8333-333333333333', '22222222-2222-4222-8222-222222222222', 3, 'The Blackwater Four', 'the-blackwater-four', true, now()),
  ('33333333-3333-4333-8333-333333333334', '22222222-2222-4222-8222-222222222222', 4, 'The Woman in Room 13', 'the-woman-in-room-13', true, now()),
  ('33333333-3333-4333-8333-333333333335', '22222222-2222-4222-8222-222222222222', 5, 'Don''t Go Looking', 'dont-go-looking', true, now()),
  ('33333333-3333-4333-8333-333333333336', '22222222-2222-4222-8222-222222222222', 6, 'Coming Soon', 'coming-soon', false, null)
on conflict (season_id, episode_number) do update
set title = excluded.title,
    slug = excluded.slug,
    published = excluded.published,
    published_at = excluded.published_at;

insert into public.products (id, name, stripe_price_id, active)
values (
  '44444444-4444-4444-8444-444444444441',
  'Blackwater Bay, Season 1, Part 1',
  'price_1U9InnIYRzF4KXaedA1kI0K6',
  true
)
on conflict (stripe_price_id) do update
set name = excluded.name,
    active = excluded.active;

insert into public.product_episodes (product_id, episode_id)
values
  ('44444444-4444-4444-8444-444444444441', '33333333-3333-4333-8333-333333333331'),
  ('44444444-4444-4444-8444-444444444441', '33333333-3333-4333-8333-333333333332'),
  ('44444444-4444-4444-8444-444444444441', '33333333-3333-4333-8333-333333333333'),
  ('44444444-4444-4444-8444-444444444441', '33333333-3333-4333-8333-333333333334'),
  ('44444444-4444-4444-8444-444444444441', '33333333-3333-4333-8333-333333333335')
on conflict do nothing;
