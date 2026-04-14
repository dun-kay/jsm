-- Never Ever: allow hung-vote continue based on waiting_on (reader),
-- not only called_out membership.

create or replace function public.ne_continue(p_game_code text, p_player_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.never_ever_games%rowtype;
  v_waiting jsonb;
  v_next_turn integer;
  v_max_cards integer;
  v_is_hung_vote boolean;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.ne_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_game
  from public.never_ever_games
  where lobby_id = v_ctx.lobby_id
  for update;

  if not found then
    raise exception 'Game runtime not initialized.';
  end if;

  v_max_cards := least(18, coalesce(jsonb_array_length(coalesce(v_game.deck, '[]'::jsonb)), 0));

  if v_game.phase in ('rules', 'card_reveal') then
    if not (coalesce(v_game.waiting_on, '[]'::jsonb) @> jsonb_build_array(v_ctx.player_id::text)) then
      return public.ne_get_state(p_game_code, p_player_token);
    end if;

    v_waiting := public.ne_remove_waiting(v_game.waiting_on, v_ctx.player_id);
    update public.never_ever_games
    set waiting_on = v_waiting
    where lobby_id = v_ctx.lobby_id;

    if jsonb_array_length(v_waiting) = 0 then
      if v_game.phase = 'rules' then
        perform public.ne_prepare_turn(v_ctx.lobby_id);
      elsif v_game.phase = 'card_reveal' then
        update public.never_ever_games
        set phase = 'vote',
            waiting_on = public.ne_active_player_ids(v_ctx.lobby_id),
            votes = '{}'::jsonb,
            called_out = '[]'::jsonb,
            called_out_option = null,
            last_error = null
        where lobby_id = v_ctx.lobby_id;
      end if;
    end if;
  elsif v_game.phase = 'callout' then
    v_is_hung_vote := lower(coalesce(v_game.called_out_option, '')) like 'hung vote%';

    if v_is_hung_vote then
      if not (coalesce(v_game.waiting_on, '[]'::jsonb) @> jsonb_build_array(v_ctx.player_id::text)) then
        return public.ne_get_state(p_game_code, p_player_token);
      end if;
    else
      if not (coalesce(v_game.called_out, '[]'::jsonb) @> jsonb_build_array(v_ctx.player_id::text)) then
        return public.ne_get_state(p_game_code, p_player_token);
      end if;
    end if;

    v_next_turn := v_game.turn_index + 1;
    if v_next_turn >= v_max_cards then
      update public.never_ever_games
      set turn_index = v_next_turn,
          phase = 'result',
          waiting_on = '[]'::jsonb
      where lobby_id = v_ctx.lobby_id;
      return public.ne_get_state(p_game_code, p_player_token);
    end if;

    update public.never_ever_games
    set turn_index = v_next_turn,
        votes = '{}'::jsonb,
        called_out = '[]'::jsonb,
        called_out_option = null,
        current_reader_id = null,
        current_card = null,
        last_error = null
    where lobby_id = v_ctx.lobby_id;
    perform public.ne_prepare_turn(v_ctx.lobby_id);
  end if;

  return public.ne_get_state(p_game_code, p_player_token);
end;
$$;

