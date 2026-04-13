-- Draw WF daily stats table data (LA time).
-- Sessions = draw-wf lobbies created that day.
-- avg_drawings_per_session = average rounds created per session for that day.

create or replace function public.get_draw_wf_daily_stats(p_from date default date '2026-03-10')
returns table(
  stat_date date,
  sessions integer,
  avg_drawings_per_session numeric(10,2)
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
  lobbies as (
    select
      l.id as lobby_id,
      (timezone('America/Los_Angeles', l.created_at))::date as stat_date
    from public.game_lobbies l
    where l.game_slug = 'draw-wf'
      and (timezone('America/Los_Angeles', l.created_at))::date >= (select from_date from bounds)
      and (timezone('America/Los_Angeles', l.created_at))::date <= (select to_date from bounds)
  ),
  rounds_per_game as (
    select
      gg.stat_date,
      gg.lobby_id,
      count(r.id)::integer as drawings_in_session
    from lobbies gg
    left join public.draw_wf_rounds r
      on r.lobby_id = gg.lobby_id
    group by gg.stat_date, gg.lobby_id
  ),
  daily as (
    select
      rpg.stat_date,
      count(*)::integer as sessions,
      round(avg(rpg.drawings_in_session)::numeric, 2) as avg_drawings_per_session
    from rounds_per_game rpg
    group by rpg.stat_date
  )
  select
    d.stat_date,
    coalesce(da.sessions, 0) as sessions,
    coalesce(da.avg_drawings_per_session, 0::numeric) as avg_drawings_per_session
  from days d
  left join daily da on da.stat_date = d.stat_date
  order by d.stat_date desc;
$$;

revoke all on function public.get_draw_wf_daily_stats(date) from public;
grant execute on function public.get_draw_wf_daily_stats(date) to anon, authenticated;
