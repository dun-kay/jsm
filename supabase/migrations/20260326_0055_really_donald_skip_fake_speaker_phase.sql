-- Really Donald: skip impression/speaker flow for fake quotes

create or replace function public.rd_continue(p_game_code text, p_player_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.really_donald_games%rowtype;
  v_waiting jsonb;
  v_player_count integer;
  v_total_turns integer;
  v_next_turn integer;
  v_next_round integer;
  v_is_real boolean;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.rd_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_game from public.really_donald_games where lobby_id = v_ctx.lobby_id;
  if not found then
    raise exception 'Game runtime not initialized.';
  end if;

  if v_game.phase not in ('rules', 'round_intro', 'quote_reveal', 'truth_result', 'impression', 'turn_result', 'round_result') then
    raise exception 'Continue is not available right now.';
  end if;

  if not exists (
    select 1
    from jsonb_array_elements_text(coalesce(v_game.waiting_on, '[]'::jsonb)) as w(value)
    where w.value = v_ctx.player_id::text
  ) then
    raise exception 'Waiting for another player.';
  end if;

  v_waiting := public.rd_remove_waiting(v_game.waiting_on, v_ctx.player_id);
  update public.really_donald_games
  set waiting_on = v_waiting
  where lobby_id = v_ctx.lobby_id;

  if jsonb_array_length(v_waiting) > 0 then
    return public.rd_get_state(p_game_code, p_player_token);
  end if;

  if v_game.phase = 'rules' then
    update public.really_donald_games
    set phase = 'round_intro',
        waiting_on = public.rd_active_player_ids(v_ctx.lobby_id),
        last_error = null
    where lobby_id = v_ctx.lobby_id;
    return public.rd_get_state(p_game_code, p_player_token);
  end if;

  if v_game.phase = 'round_intro' then
    perform public.rd_prepare_turn(v_ctx.lobby_id);
    return public.rd_get_state(p_game_code, p_player_token);
  end if;

  if v_game.phase = 'quote_reveal' then
    update public.really_donald_games
    set phase = 'truth_vote',
        waiting_on = '[]'::jsonb,
        truth_votes = '{}'::jsonb,
        truth_winners = '[]'::jsonb,
        last_error = null
    where lobby_id = v_ctx.lobby_id;
    return public.rd_get_state(p_game_code, p_player_token);
  end if;

  if v_game.phase = 'truth_result' then
    v_is_real := coalesce((v_game.current_card ->> 'isReal')::boolean, false);

    if v_is_real then
      update public.really_donald_games
      set phase = 'impression',
          waiting_on = jsonb_build_array(v_game.active_player_id::text),
          last_error = null
      where lobby_id = v_ctx.lobby_id;
      return public.rd_get_state(p_game_code, p_player_token);
    end if;

    v_player_count := public.rd_player_count(v_game.player_order);
    v_total_turns := v_player_count * 3;
    v_next_turn := v_game.turn_index + 1;

    if v_next_turn >= v_total_turns then
      update public.really_donald_games
      set phase = 'result',
          turn_index = v_next_turn,
          waiting_on = '[]'::jsonb,
          active_player_id = null,
          last_error = null
      where lobby_id = v_ctx.lobby_id;
      return public.rd_get_state(p_game_code, p_player_token);
    end if;

    v_next_round := floor((v_next_turn)::numeric / v_player_count)::integer + 1;

    if v_next_round > v_game.round_number then
      update public.really_donald_games
      set phase = 'round_result',
          turn_index = v_next_turn,
          round_number = v_next_round,
          waiting_on = public.rd_active_player_ids(v_ctx.lobby_id),
          active_player_id = null,
          last_error = null
      where lobby_id = v_ctx.lobby_id;
      return public.rd_get_state(p_game_code, p_player_token);
    end if;

    update public.really_donald_games
    set turn_index = v_next_turn,
        last_error = null
    where lobby_id = v_ctx.lobby_id;

    perform public.rd_prepare_turn(v_ctx.lobby_id);
    return public.rd_get_state(p_game_code, p_player_token);
  end if;

  if v_game.phase = 'impression' then
    update public.really_donald_games
    set phase = 'speaker_vote',
        waiting_on = '[]'::jsonb,
        speaker_votes = '{}'::jsonb,
        speaker_winners = '[]'::jsonb,
        last_error = null
    where lobby_id = v_ctx.lobby_id;
    return public.rd_get_state(p_game_code, p_player_token);
  end if;

  if v_game.phase = 'turn_result' then
    v_player_count := public.rd_player_count(v_game.player_order);
    v_total_turns := v_player_count * 3;
    v_next_turn := v_game.turn_index + 1;

    if v_next_turn >= v_total_turns then
      update public.really_donald_games
      set phase = 'result',
          turn_index = v_next_turn,
          waiting_on = '[]'::jsonb,
          active_player_id = null,
          last_error = null
      where lobby_id = v_ctx.lobby_id;
      return public.rd_get_state(p_game_code, p_player_token);
    end if;

    v_next_round := floor((v_next_turn)::numeric / v_player_count)::integer + 1;

    if v_next_round > v_game.round_number then
      update public.really_donald_games
      set phase = 'round_result',
          turn_index = v_next_turn,
          round_number = v_next_round,
          waiting_on = public.rd_active_player_ids(v_ctx.lobby_id),
          active_player_id = null,
          last_error = null
      where lobby_id = v_ctx.lobby_id;
      return public.rd_get_state(p_game_code, p_player_token);
    end if;

    update public.really_donald_games
    set turn_index = v_next_turn,
        last_error = null
    where lobby_id = v_ctx.lobby_id;

    perform public.rd_prepare_turn(v_ctx.lobby_id);
    return public.rd_get_state(p_game_code, p_player_token);
  end if;

  if v_game.phase = 'round_result' then
    update public.really_donald_games
    set phase = 'round_intro',
        waiting_on = public.rd_active_player_ids(v_ctx.lobby_id),
        last_error = null
    where lobby_id = v_ctx.lobby_id;
    return public.rd_get_state(p_game_code, p_player_token);
  end if;

  return public.rd_get_state(p_game_code, p_player_token);
end;
$$;

grant execute on function public.rd_continue(text, text) to anon, authenticated;

