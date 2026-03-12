-- Move Secret Categories data into a managed table instead of hardcoded SQL values.

create table if not exists public.secret_category_pool (
  id bigserial primary key,
  main_category text not null unique,
  secret_options jsonb not null,
  enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint secret_category_pool_secret_options_array_chk
    check (jsonb_typeof(secret_options) = 'array' and jsonb_array_length(secret_options) > 0)
);

drop trigger if exists set_secret_category_pool_updated_at on public.secret_category_pool;
create trigger set_secret_category_pool_updated_at
before update on public.secret_category_pool
for each row execute function public.set_updated_at();

create index if not exists secret_category_pool_enabled_idx
  on public.secret_category_pool(enabled, sort_order, main_category);

alter table public.secret_category_pool enable row level security;
revoke all on table public.secret_category_pool from anon, authenticated;

insert into public.secret_category_pool (main_category, secret_options, enabled, sort_order)
values
  (
    'TV Sitcoms',
    '["Seinfeld","Friends","Big Bang Theory","The Simpsons","The Office","Parks and Recreation","Brooklyn Nine-Nine","Modern Family","How I Met Your Mother","Community"]'::jsonb,
    true,
    10
  ),
  (
    'Cars',
    '["Ford","Ferrari","Fiat","Honda","Toyota","Mazda","Nissan","Porsche","Tesla","BMW"]'::jsonb,
    true,
    20
  ),
  (
    'Sports',
    '["Soccer","Basketball","Tennis","Golf","Cricket","Rugby","Baseball","Hockey","Formula 1","MMA"]'::jsonb,
    true,
    30
  ),
  (
    'Food',
    '["Pizza","Burger","Sushi","Tacos","Pasta","Steak","Salad","Curry","Ramen","Dumplings"]'::jsonb,
    true,
    40
  ),
  (
    'Travel',
    '["Tokyo","Paris","London","New York","Sydney","Rome","Bangkok","Barcelona","Dubai","Singapore"]'::jsonb,
    true,
    50
  )
on conflict (main_category) do update
set
  secret_options = excluded.secret_options,
  enabled = excluded.enabled,
  sort_order = excluded.sort_order,
  updated_at = now();

create or replace function public.sc_pick_round_data()
returns table(main_category text, secret_category text, secret_options jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_main text;
  v_secret text;
  v_options jsonb;
begin
  select p.main_category, p.secret_options
  into v_main, v_options
  from public.secret_category_pool p
  where p.enabled = true
  order by random()
  limit 1;

  if v_main is null or v_options is null or jsonb_array_length(v_options) = 0 then
    raise exception 'Secret category pool is empty.';
  end if;

  select elem::text
  into v_secret
  from jsonb_array_elements_text(v_options) elem
  order by random()
  limit 1;

  return query select v_main, v_secret, v_options;
end;
$$;

grant execute on function public.sc_pick_round_data() to anon, authenticated;
