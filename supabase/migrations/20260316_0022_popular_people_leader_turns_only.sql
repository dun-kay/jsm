-- Popular People: only team leaders can be the active asker.
-- On incorrect guess, turn passes to the target player's current team leader.

create or replace function public.cc_confirm_guess(
  p_game_code text,
  p_player_token text,
  p_is_correct boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.celebrities_games%rowtype;
  v_asker_leader uuid;
  v_target_leader uuid;
  v_next_asker uuid;
  v_leader_count integer;
begin
  perform public.cleanup_lobby_presence(p_game_code);

  select * into v_ctx from public.cc_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_game
  from public.celebrities_games
  where lobby_id = v_ctx.lobby_id;

  if not found or v_game.phase <> 'guess_confirm' then
    raise exception 'Guess confirmation is not active.';
  end if;

  if v_ctx.player_id <> v_game.current_asker_id and v_ctx.player_id <> v_game.current_target_id then
    raise exception 'Only the asking player and target can confirm.';
  end if;

  if v_ctx.player_id = v_game.current_asker_id then
    update public.celebrities_games
    set asker_confirm = p_is_correct
    where lobby_id = v_ctx.lobby_id;
  else
    update public.celebrities_games
    set target_confirm = p_is_correct
    where lobby_id = v_ctx.lobby_id;
  end if;

  select * into v_game
  from public.celebrities_games
  where lobby_id = v_ctx.lobby_id;

  if v_game.asker_confirm is null or v_game.target_confirm is null then
    return public.cc_get_state(p_game_code, p_player_token);
  end if;

  if v_game.asker_confirm <> v_game.target_confirm then
    update public.celebrities_games
    set asker_confirm = null,
        target_confirm = null,
        last_error = 'Answers did not match. Confirm again.'
    where lobby_id = v_ctx.lobby_id;

    return public.cc_get_state(p_game_code, p_player_token);
  end if;

  if v_game.asker_confirm = true then
    select leader_id into v_asker_leader
    from public.celebrities_player_state
    where lobby_id = v_ctx.lobby_id
      and player_id = v_game.current_asker_id;

    select leader_id into v_target_leader
    from public.celebrities_player_state
    where lobby_id = v_ctx.lobby_id
      and player_id = v_game.current_target_id;

    update public.celebrities_player_state
    set leader_id = v_asker_leader
    where lobby_id = v_ctx.lobby_id
      and leader_id = v_target_leader;

    v_next_asker := v_asker_leader;
  else
    -- Pass turn to the target's team leader, never to a collected member.
    select leader_id into v_next_asker
    from public.celebrities_player_state
    where lobby_id = v_ctx.lobby_id
      and player_id = v_game.current_target_id;
  end if;

  select count(distinct leader_id) into v_leader_count
  from public.celebrities_player_state
  where lobby_id = v_ctx.lobby_id;

  if v_leader_count <= 1 then
    update public.celebrities_games
    set phase = 'result',
        current_asker_id = v_next_asker,
        current_target_id = null,
        current_guess = null,
        asker_confirm = null,
        target_confirm = null,
        pending_next_asker_id = null,
        last_error = null
    where lobby_id = v_ctx.lobby_id;

    return public.cc_get_state(p_game_code, p_player_token);
  end if;

  if v_game.first_turn_done = false then
    update public.celebrities_games
    set phase = 'reveal',
        reveal_round = 2,
        reveal_ends_at = now() + interval '30 seconds',
        waiting_on = public.cc_active_player_ids(v_ctx.lobby_id),
        first_turn_done = true,
        pending_next_asker_id = v_next_asker,
        current_target_id = null,
        current_guess = null,
        asker_confirm = null,
        target_confirm = null,
        last_error = null
    where lobby_id = v_ctx.lobby_id;
  else
    update public.celebrities_games
    set phase = 'guess_pick',
        current_asker_id = v_next_asker,
        current_target_id = null,
        current_guess = null,
        asker_confirm = null,
        target_confirm = null,
        pending_next_asker_id = null,
        last_error = null
    where lobby_id = v_ctx.lobby_id;
  end if;

  return public.cc_get_state(p_game_code, p_player_token);
end;
$$;

grant execute on function public.cc_confirm_guess(text, text, boolean) to anon, authenticated;
