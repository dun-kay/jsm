-- Secret Words daily stats table function (LA time).
-- sessions = completed players per puzzle day.
-- avg_guesses_per_session = average guess_count for that puzzle day.

create or replace function public.get_secret_words_daily_stats(p_from date default date '2026-03-10')
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
    from public.secret_words_daily_completions c
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

revoke all on function public.get_secret_words_daily_stats(date) from public;
grant execute on function public.get_secret_words_daily_stats(date) to anon, authenticated;
