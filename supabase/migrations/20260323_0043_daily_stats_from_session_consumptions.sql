-- Rebuild daily stats from access_session_consumptions so replay sessions and
-- post-quit lobbies are counted correctly.
-- Grouping remains by America/Los_Angeles calendar day.

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
  events as (
    select
      ascx.game_code,
      ascx.browser_token,
      ascx.consumed_at,
      (timezone('America/Los_Angeles', ascx.consumed_at))::date as stat_date
    from public.access_session_consumptions ascx
    where (timezone('America/Los_Angeles', ascx.consumed_at))::date >= (select from_date from bounds)
      and (timezone('America/Los_Angeles', ascx.consumed_at))::date <= (select to_date from bounds)
  ),
  ordered as (
    select
      e.*,
      case
        when lag(e.consumed_at) over (partition by e.game_code order by e.consumed_at) is null then 1
        when e.consumed_at - lag(e.consumed_at) over (partition by e.game_code order by e.consumed_at) > interval '5 minutes' then 1
        else 0
      end as new_session_flag
    from events e
  ),
  sessionized as (
    select
      o.*,
      sum(o.new_session_flag) over (partition by o.game_code order by o.consumed_at rows between unbounded preceding and current row) as session_seq
    from ordered o
  ),
  per_session as (
    select
      s.stat_date,
      s.game_code,
      s.session_seq,
      count(distinct s.browser_token)::integer as users_in_session
    from sessionized s
    group by s.stat_date, s.game_code, s.session_seq
  ),
  daily as (
    select
      ps.stat_date,
      count(*)::integer as sessions,
      round(avg(ps.users_in_session)::numeric, 2) as avg_users_per_session
    from per_session ps
    group by ps.stat_date
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

