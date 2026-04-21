-- One Away + Order Me daily completion stats.

create table if not exists public.one_away_daily_completions (
  id bigserial primary key,
  puzzle_date date not null,
  local_player_id text not null,
  guess_count integer not null,
  created_at timestamptz not null default now(),
  constraint one_away_daily_completions_player_chk
    check (char_length(local_player_id) between 8 and 128),
  constraint one_away_daily_completions_guess_chk
    check (guess_count > 0 and guess_count <= 20),
  constraint one_away_daily_completions_unique_player_day
    unique (puzzle_date, local_player_id)
);

create index if not exists one_away_daily_completions_puzzle_date_idx
  on public.one_away_daily_completions(puzzle_date);

create table if not exists public.order_me_daily_completions (
  id bigserial primary key,
  puzzle_date date not null,
  local_player_id text not null,
  guess_count integer not null,
  created_at timestamptz not null default now(),
  constraint order_me_daily_completions_player_chk
    check (char_length(local_player_id) between 8 and 128),
  constraint order_me_daily_completions_guess_chk
    check (guess_count > 0 and guess_count <= 20),
  constraint order_me_daily_completions_unique_player_day
    unique (puzzle_date, local_player_id)
);

create index if not exists order_me_daily_completions_puzzle_date_idx
  on public.order_me_daily_completions(puzzle_date);

alter table public.one_away_daily_completions enable row level security;
alter table public.order_me_daily_completions enable row level security;

revoke all on table public.one_away_daily_completions from anon, authenticated;
revoke all on table public.order_me_daily_completions from anon, authenticated;

create or replace function public.oa_record_completion(
  p_puzzle_date date,
  p_local_player_id text,
  p_guess_count integer
)
returns boolean
language plpgsql
security definer
volatile
set search_path = public
as $$
begin
  if p_puzzle_date is null then
    raise exception 'Missing puzzle date.';
  end if;

  if p_local_player_id is null or char_length(trim(p_local_player_id)) < 8 then
    raise exception 'Invalid player id.';
  end if;

  if p_guess_count is null or p_guess_count <= 0 then
    raise exception 'Guess count must be positive.';
  end if;

  insert into public.one_away_daily_completions (puzzle_date, local_player_id, guess_count)
  values (p_puzzle_date, trim(p_local_player_id), p_guess_count)
  on conflict (puzzle_date, local_player_id) do update
  set guess_count = least(public.one_away_daily_completions.guess_count, excluded.guess_count);

  return true;
end;
$$;

create or replace function public.oa_get_average_guesses(p_puzzle_date date)
returns numeric(10,2)
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(round(avg(c.guess_count)::numeric, 2), 0::numeric)
  from public.one_away_daily_completions c
  where c.puzzle_date = p_puzzle_date;
$$;

create or replace function public.get_one_away_daily_stats(p_from date default date '2026-03-10')
returns table(
  stat_date date,
  sessions integer,
  avg_guesses_per_session numeric(10,2)
)
language sql
security definer
stable
set search_path = public
as $$
  with bounds as (
    select
      greatest(coalesce(p_from, date '2026-03-10'), date '2026-03-10') as from_date,
      (timezone('America/Los_Angeles', now()))::date as to_date
  ),
  days as (
    select generate_series(
      (select from_date from bounds),
      (select to_date from bounds),
      interval '1 day'
    )::date as stat_date
  ),
  daily as (
    select
      c.puzzle_date as stat_date,
      count(*)::integer as sessions,
      round(avg(c.guess_count)::numeric, 2) as avg_guesses_per_session
    from public.one_away_daily_completions c
    where c.puzzle_date >= (select from_date from bounds)
      and c.puzzle_date <= (select to_date from bounds)
    group by c.puzzle_date
  )
  select
    d.stat_date,
    coalesce(da.sessions, 0) as sessions,
    coalesce(da.avg_guesses_per_session, 0::numeric) as avg_guesses_per_session
  from days d
  left join daily da on da.stat_date = d.stat_date
  order by d.stat_date desc;
$$;

create or replace function public.om_record_completion(
  p_puzzle_date date,
  p_local_player_id text,
  p_guess_count integer
)
returns boolean
language plpgsql
security definer
volatile
set search_path = public
as $$
begin
  if p_puzzle_date is null then
    raise exception 'Missing puzzle date.';
  end if;

  if p_local_player_id is null or char_length(trim(p_local_player_id)) < 8 then
    raise exception 'Invalid player id.';
  end if;

  if p_guess_count is null or p_guess_count <= 0 then
    raise exception 'Guess count must be positive.';
  end if;

  insert into public.order_me_daily_completions (puzzle_date, local_player_id, guess_count)
  values (p_puzzle_date, trim(p_local_player_id), p_guess_count)
  on conflict (puzzle_date, local_player_id) do update
  set guess_count = least(public.order_me_daily_completions.guess_count, excluded.guess_count);

  return true;
end;
$$;

create or replace function public.om_get_average_guesses(p_puzzle_date date)
returns numeric(10,2)
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(round(avg(c.guess_count)::numeric, 2), 0::numeric)
  from public.order_me_daily_completions c
  where c.puzzle_date = p_puzzle_date;
$$;

create or replace function public.get_order_me_daily_stats(p_from date default date '2026-03-10')
returns table(
  stat_date date,
  sessions integer,
  avg_guesses_per_session numeric(10,2)
)
language sql
security definer
stable
set search_path = public
as $$
  with bounds as (
    select
      greatest(coalesce(p_from, date '2026-03-10'), date '2026-03-10') as from_date,
      (timezone('America/Los_Angeles', now()))::date as to_date
  ),
  days as (
    select generate_series(
      (select from_date from bounds),
      (select to_date from bounds),
      interval '1 day'
    )::date as stat_date
  ),
  daily as (
    select
      c.puzzle_date as stat_date,
      count(*)::integer as sessions,
      round(avg(c.guess_count)::numeric, 2) as avg_guesses_per_session
    from public.order_me_daily_completions c
    where c.puzzle_date >= (select from_date from bounds)
      and c.puzzle_date <= (select to_date from bounds)
    group by c.puzzle_date
  )
  select
    d.stat_date,
    coalesce(da.sessions, 0) as sessions,
    coalesce(da.avg_guesses_per_session, 0::numeric) as avg_guesses_per_session
  from days d
  left join daily da on da.stat_date = d.stat_date
  order by d.stat_date desc;
$$;

revoke all on function public.oa_record_completion(date, text, integer) from public;
revoke all on function public.oa_get_average_guesses(date) from public;
revoke all on function public.get_one_away_daily_stats(date) from public;
revoke all on function public.om_record_completion(date, text, integer) from public;
revoke all on function public.om_get_average_guesses(date) from public;
revoke all on function public.get_order_me_daily_stats(date) from public;

grant execute on function public.oa_record_completion(date, text, integer) to anon, authenticated;
grant execute on function public.oa_get_average_guesses(date) to anon, authenticated;
grant execute on function public.get_one_away_daily_stats(date) to anon, authenticated;
grant execute on function public.om_record_completion(date, text, integer) to anon, authenticated;
grant execute on function public.om_get_average_guesses(date) to anon, authenticated;
grant execute on function public.get_order_me_daily_stats(date) to anon, authenticated;

