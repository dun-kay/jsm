-- Popular People: only uncollected opponents can be targeted.
-- Uncollected means player is still their own leader (leader_id = player_id).

create or replace function public.cc_pick_target(
  p_game_code text,
  p_player_token text,
  p_target_player_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.celebrities_games%rowtype;
  v_my_leader uuid;
  v_target_leader uuid;
begin
  perform public.cleanup_lobby_presence(p_game_code);

  select * into v_ctx from public.cc_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_game
  from public.celebrities_games
  where lobby_id = v_ctx.lobby_id;

  if not found or v_game.phase <> 'guess_pick' then
    raise exception 'Target pick is not active.';
  end if;

  if v_game.current_asker_id <> v_ctx.player_id then
    raise exception 'It is not your turn.';
  end if;

  if p_target_player_id = v_ctx.player_id then
    raise exception 'Pick another player.';
  end if;

  select leader_id into v_my_leader
  from public.celebrities_player_state
  where lobby_id = v_ctx.lobby_id
    and player_id = v_ctx.player_id;

  select leader_id into v_target_leader
  from public.celebrities_player_state
  where lobby_id = v_ctx.lobby_id
    and player_id = p_target_player_id;

  if v_target_leader is null then
    raise exception 'Invalid target.';
  end if;

  if v_my_leader = v_target_leader then
    raise exception 'Target must be outside your team.';
  end if;

  if v_target_leader <> p_target_player_id then
    raise exception 'Target has already been collected. Pick a player not yet collected.';
  end if;

  update public.celebrities_games
  set phase = 'guess_input',
      current_target_id = p_target_player_id,
      current_guess = null,
      asker_confirm = null,
      target_confirm = null,
      last_error = null
  where lobby_id = v_ctx.lobby_id;

  return public.cc_get_state(p_game_code, p_player_token);
end;
$$;

grant execute on function public.cc_pick_target(text, text, uuid) to anon, authenticated;
