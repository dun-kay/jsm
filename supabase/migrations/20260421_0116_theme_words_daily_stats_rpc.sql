-- Theme Words daily stats RPC for admin stats page.

create or replace function public.get_theme_words_daily_stats(p_from date default date '2026-03-10')
returns table (
  stat_date date,
  sessions integer,
  avg_seconds_per_session numeric(10,2)
)
language sql
security definer
stable
set search_path = public
as $$
  with days as (
    select generate_series(
      p_from,
      timezone('America/Los_Angeles', now())::date,
      interval '1 day'
    )::date as stat_date
  ),
  daily_agg as (
    select
      c.puzzle_date as stat_date,
      count(*)::int as sessions,
      round(avg(c.elapsed_seconds)::numeric, 2) as avg_seconds_per_session
    from public.theme_words_daily_completions c
    where c.puzzle_date >= p_from
    group by c.puzzle_date
  )
  select
    d.stat_date,
    coalesce(da.sessions, 0) as sessions,
    coalesce(da.avg_seconds_per_session, 0::numeric) as avg_seconds_per_session
  from days d
  left join daily_agg da using (stat_date)
  order by d.stat_date desc;
$$;

revoke all on function public.get_theme_words_daily_stats(date) from public;
grant execute on function public.get_theme_words_daily_stats(date) to anon, authenticated;

