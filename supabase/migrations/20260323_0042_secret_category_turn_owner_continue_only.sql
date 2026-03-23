create or replace function public.sc_continue(p_game_code text, p_player_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_state public.secret_category_games%rowtype;
  v_waiting jsonb;
  v_player_count integer;
begin
  perform public.cleanup_lobby_presence(p_game_code);

  select * into v_ctx from public.sc_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_state from public.secret_category_games where lobby_id = v_ctx.lobby_id;
  if not found then
    raise exception 'Game runtime not initialized.';
  end if;

  v_waiting := public.sc_remove_waiting(v_state.waiting_on, v_ctx.player_id);

  update public.secret_category_games
  set waiting_on = v_waiting
  where lobby_id = v_ctx.lobby_id;

  if jsonb_array_length(v_waiting) > 0 then
    return public.sc_get_state(p_game_code, p_player_token);
  end if;

  if v_state.phase = 'rules' then
    update public.secret_category_games
    set phase = 'role_reveal',
        waiting_on = public.sc_active_player_ids(v_ctx.lobby_id)
    where lobby_id = v_ctx.lobby_id;
  elsif v_state.phase = 'role_reveal' then
    update public.secret_category_games
    set phase = 'turn_clues',
        turn_index = 0,
        waiting_on = jsonb_build_array(v_state.turn_order->>0)
    where lobby_id = v_ctx.lobby_id;
  elsif v_state.phase = 'turn_clues' then
    select jsonb_array_length(v_state.turn_order) into v_player_count;
    if v_state.turn_index + 1 >= v_player_count then
      update public.secret_category_games
      set phase = 'discussion',
          waiting_on = public.sc_active_player_ids(v_ctx.lobby_id)
      where lobby_id = v_ctx.lobby_id;
    else
      update public.secret_category_games
      set turn_index = v_state.turn_index + 1,
          waiting_on = jsonb_build_array(v_state.turn_order->>(v_state.turn_index + 1))
      where lobby_id = v_ctx.lobby_id;
    end if;
  elsif v_state.phase = 'discussion' then
    update public.secret_category_games
    set phase = 'vote',
        votes = '{}'::jsonb,
        vote_attempt = 1,
        waiting_on = public.sc_active_player_ids(v_ctx.lobby_id)
    where lobby_id = v_ctx.lobby_id;
  elsif v_state.phase = 'result' then
    -- no-op; next round is explicit
    null;
  end if;

  return public.sc_get_state(p_game_code, p_player_token);
end;
$$;

