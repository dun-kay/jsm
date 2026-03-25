-- Lying Llama: enforce target-response truth + charlatan-not-called penalty flow

create or replace function public.ll_submit_target_response(
  p_game_code text,
  p_player_token text,
  p_correct_guess boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.lying_llama_games%rowtype;
  v_top jsonb;
  v_top_animal text;
  v_is_charlatan boolean;
  v_guess_is_correct boolean;
  v_card jsonb;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.ll_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_game from public.lying_llama_games where lobby_id = v_ctx.lobby_id;
  if not found or v_game.phase <> 'target_response' then
    raise exception 'Target response is not active.';
  end if;
  if v_ctx.player_id <> v_game.active_target_id then
    raise exception 'Only the asked player can confirm this step.';
  end if;

  v_top := public.ll_top_card(v_ctx.lobby_id, v_game.active_target_id);
  if v_top is null then
    perform public.ll_advance_turn(v_ctx.lobby_id);
    return public.ll_get_state(p_game_code, p_player_token);
  end if;

  v_top_animal := coalesce(v_top ->> 'animal', null);
  v_is_charlatan := coalesce((v_top ->> 'isCharlatan')::boolean, false);
  v_guess_is_correct := lower(trim(coalesce(v_game.selected_animal, ''))) = lower(trim(coalesce(v_top_animal, '')));

  if not v_is_charlatan and p_correct_guess <> v_guess_is_correct then
    raise exception 'Invalid target response for this guess.';
  end if;

  if v_is_charlatan then
    update public.lying_llama_games
    set phase = 'charlatan_call',
        waiting_on = jsonb_build_array(v_game.active_asker_id::text),
        charlatan_prompt = coalesce(v_game.charlatan_prompt, public.ll_random_charlatan_prompt()),
        last_outcome_type = 'charlatan_spotted',
        last_outcome_text = 'Charlatan card is in play. Decide to call it or give a penalty.',
        last_error = null
    where lobby_id = v_ctx.lobby_id;

    return public.ll_get_state(p_game_code, p_player_token);
  end if;

  if v_guess_is_correct then
    v_card := public.ll_transfer_top_card(v_ctx.lobby_id, v_game.active_target_id, v_game.active_asker_id);
    update public.lying_llama_games
    set phase = 'turn_result',
        waiting_on = public.cc_active_player_ids(v_ctx.lobby_id),
        last_outcome_type = 'correct_guess',
        last_outcome_text = 'Correct guess. Card won.',
        last_winner_id = v_game.active_asker_id,
        last_loser_id = v_game.active_target_id,
        last_card_won = coalesce(v_card ->> 'animal', v_top_animal),
        last_error = null
    where lobby_id = v_ctx.lobby_id;
  else
    update public.lying_llama_games
    set phase = 'penalty_prompt',
        waiting_on = jsonb_build_array(v_game.active_asker_id::text),
        penalty_animal = v_game.selected_animal,
        last_outcome_type = 'wrong_guess',
        last_outcome_text = 'Wrong guess. Do the penalty.',
        last_winner_id = null,
        last_loser_id = v_game.active_asker_id,
        last_card_won = null,
        last_error = null
    where lobby_id = v_ctx.lobby_id;
  end if;

  return public.ll_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.ll_charlatan_decision(p_game_code text, p_player_token text, p_call_charlatan boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.lying_llama_games%rowtype;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.ll_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_game from public.lying_llama_games where lobby_id = v_ctx.lobby_id;
  if not found or v_game.phase <> 'charlatan_call' then
    raise exception 'Charlatan call is not active.';
  end if;
  if v_ctx.player_id <> v_game.active_asker_id then
    raise exception 'Only the asker can choose.';
  end if;

  if p_call_charlatan then
    update public.lying_llama_games
    set phase = 'charlatan_battle',
        waiting_on = public.ll_waiting_pair(v_game.active_asker_id, v_game.active_target_id),
        battle_prompt = public.ll_random_battle_prompt(),
        battle_votes = '{}'::jsonb,
        last_outcome_type = 'charlatan_called',
        last_outcome_text = 'Charlatan called. Battle time.',
        last_error = null
    where lobby_id = v_ctx.lobby_id;
  else
    update public.lying_llama_games
    set phase = 'penalty_prompt',
        waiting_on = jsonb_build_array(v_game.active_asker_id::text),
        penalty_animal = v_game.selected_animal,
        last_outcome_type = 'charlatan_not_called',
        last_outcome_text = 'Charlatan was not called. Guesser gets a penalty.',
        last_winner_id = v_game.active_target_id,
        last_loser_id = v_game.active_asker_id,
        last_card_won = null,
        last_error = null
    where lobby_id = v_ctx.lobby_id;
  end if;

  return public.ll_get_state(p_game_code, p_player_token);
end;
$$;
