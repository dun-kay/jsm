-- Fruit Bowl: host-only team re-shuffle on the teams screen.

create or replace function public.fb_shuffle_teams(
  p_game_code text,
  p_player_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.fruit_bowl_games%rowtype;
  v_first_cluegiver uuid;
  v_first_team_no integer;
  v_first_team_order integer;
begin
  perform public.cleanup_lobby_presence(p_game_code);

  select * into v_ctx from public.fb_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  if not coalesce(v_ctx.is_host, false) then
    raise exception 'Only the host can re-shuffle teams.';
  end if;

  select * into v_game
  from public.fruit_bowl_games
  where lobby_id = v_ctx.lobby_id;

  if not found or v_game.phase <> 'teams' then
    raise exception 'Team re-shuffle is only available on the team screen.';
  end if;

  with shuffled as (
    select p.id as player_id, row_number() over (order by random()) as rn
    from public.lobby_players p
    where p.lobby_id = v_ctx.lobby_id
  ),
  assigned as (
    select
      player_id,
      case when (rn % 2) = 1 then 1 else 2 end as team_no,
      row_number() over (
        partition by case when (rn % 2) = 1 then 1 else 2 end
        order by rn
      ) as team_order
    from shuffled
  )
  update public.fruit_bowl_player_state ps
  set team_no = a.team_no,
      team_order = a.team_order
  from assigned a
  where ps.lobby_id = v_ctx.lobby_id
    and ps.player_id = a.player_id;

  select p.id
  into v_first_cluegiver
  from public.lobby_players p
  where p.lobby_id = v_ctx.lobby_id
  order by random()
  limit 1;

  select ps.team_no, ps.team_order
  into v_first_team_no, v_first_team_order
  from public.fruit_bowl_player_state ps
  where ps.lobby_id = v_ctx.lobby_id
    and ps.player_id = v_first_cluegiver;

  update public.fruit_bowl_games
  set waiting_on = public.cc_active_player_ids(v_ctx.lobby_id),
      active_team = coalesce(v_first_team_no, 1),
      active_cluegiver_id = v_first_cluegiver,
      team_a_turn_index = case when coalesce(v_first_team_no, 1) = 1 then coalesce(v_first_team_order, 1) else 1 end,
      team_b_turn_index = case when coalesce(v_first_team_no, 1) = 2 then coalesce(v_first_team_order, 1) else 1 end,
      last_error = null
  where lobby_id = v_ctx.lobby_id;

  return public.fb_get_state(p_game_code, p_player_token);
end;
$$;

grant execute on function public.fb_shuffle_teams(text, text) to anon, authenticated;
