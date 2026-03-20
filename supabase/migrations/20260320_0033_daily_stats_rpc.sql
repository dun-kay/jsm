-- Public daily session stats (aggregate only).
-- Grouping is by America/Los_Angeles calendar day.

create or replace function public.get_daily_session_stats(p_from date default date '2026-03-10')
returns table(
  stat_date date,
  sessions integer,
  avg_users_per_session numeric(10,2)
)
language sql
security definer
stable
set search_path = public
as $$
  with bounds as (
    select greatest(coalesce(p_from, date '2026-03-10'), date '2026-03-10') as from_date,
           (timezone('America/Los_Angeles', now()))::date as to_date
  ),
  days as (
    select generate_series(
      (select from_date from bounds),
      (select to_date from bounds),
      interval '1 day'
    )::date as stat_date
  ),
  session_counts as (
    select
      (timezone('America/Los_Angeles', gl.created_at))::date as stat_date,
      gl.id as lobby_id,
      count(lp.id)::integer as users_in_session
    from public.game_lobbies gl
    left join public.lobby_players lp
      on lp.lobby_id = gl.id
    where gl.status = 'started'
      and (timezone('America/Los_Angeles', gl.created_at))::date >= (select from_date from bounds)
      and (timezone('America/Los_Angeles', gl.created_at))::date <= (select to_date from bounds)
    group by 1, gl.id
  ),
  daily as (
    select
      sc.stat_date,
      count(*)::integer as sessions,
      round(avg(sc.users_in_session)::numeric, 2) as avg_users_per_session
    from session_counts sc
    group by sc.stat_date
  )
  select
    d.stat_date,
    coalesce(da.sessions, 0) as sessions,
    coalesce(da.avg_users_per_session, 0::numeric) as avg_users_per_session
  from days d
  left join daily da on da.stat_date = d.stat_date
  order by d.stat_date desc;
$$;

revoke all on function public.get_daily_session_stats(date) from public;
grant execute on function public.get_daily_session_stats(date) to anon, authenticated;
