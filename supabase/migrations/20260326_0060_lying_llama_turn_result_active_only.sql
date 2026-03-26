-- Lying Llama: turn_result should advance only from the active asker

create or replace function public.ll_submit_target_response(
  p_game_code text,
  p_player_token text,
  p_correct_guess boolean,
  p_charlatan_called boolean default null
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

  if not v_guess_is_correct then
    if p_correct_guess then
      raise exception 'Invalid target response for this guess.';
    end if;

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

    return public.ll_get_state(p_game_code, p_player_token);
  end if;

  if not v_is_charlatan then
    if not p_correct_guess then
      raise exception 'Invalid target response for this guess.';
    end if;

    v_card := public.ll_transfer_top_card(v_ctx.lobby_id, v_game.active_target_id, v_game.active_asker_id);
    update public.lying_llama_games
    set phase = 'turn_result',
        waiting_on = jsonb_build_array(v_game.active_asker_id::text),
        last_outcome_type = 'correct_guess',
        last_outcome_text = 'Correct guess. Card won.',
        last_winner_id = v_game.active_asker_id,
        last_loser_id = v_game.active_target_id,
        last_card_won = coalesce(v_card ->> 'animal', v_top_animal),
        last_error = null
    where lobby_id = v_ctx.lobby_id;

    return public.ll_get_state(p_game_code, p_player_token);
  end if;

  if p_charlatan_called is null then
    raise exception 'Charlatan decision is required for this card.';
  end if;

  if p_charlatan_called then
    update public.lying_llama_games
    set phase = 'charlatan_battle',
        waiting_on = public.ll_waiting_pair(v_game.active_asker_id, v_game.active_target_id),
        charlatan_prompt = coalesce(v_game.charlatan_prompt, public.ll_random_charlatan_prompt()),
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
        charlatan_prompt = coalesce(v_game.charlatan_prompt, public.ll_random_charlatan_prompt()),
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

create or replace function public.ll_confirm_penalty(p_game_code text, p_player_token text, p_accepted boolean)
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
  if not found or v_game.phase <> 'penalty_confirm' then
    raise exception 'Penalty confirmation is not active.';
  end if;
  if v_ctx.player_id <> v_game.active_target_id then
    raise exception 'Only the target can confirm the penalty.';
  end if;

  if p_accepted then
    update public.lying_llama_games
    set phase = 'turn_result',
        waiting_on = jsonb_build_array(v_game.active_asker_id::text),
        last_outcome_type = 'wrong_guess_penalty_done',
        last_outcome_text = 'Wrong guess penalty accepted.',
        last_winner_id = null,
        last_loser_id = v_game.active_asker_id,
        last_card_won = null,
        last_error = null
    where lobby_id = v_ctx.lobby_id;
  else
    update public.lying_llama_games
    set phase = 'penalty_prompt',
        waiting_on = jsonb_build_array(v_game.active_asker_id::text),
        last_error = 'Do it again.'
    where lobby_id = v_ctx.lobby_id;
  end if;

  return public.ll_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.ll_vote_battle_winner(p_game_code text, p_player_token text, p_winner_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.lying_llama_games%rowtype;
  v_votes jsonb;
  v_asker_vote text;
  v_target_vote text;
  v_card jsonb;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.ll_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_game from public.lying_llama_games where lobby_id = v_ctx.lobby_id;
  if not found or v_game.phase <> 'charlatan_vote' then
    raise exception 'Charlatan vote is not active.';
  end if;
  if v_ctx.player_id not in (v_game.active_asker_id, v_game.active_target_id) then
    raise exception 'Only battle players can vote.';
  end if;
  if p_winner_player_id not in (v_game.active_asker_id, v_game.active_target_id) then
    raise exception 'Invalid winner selection.';
  end if;

  v_votes := jsonb_set(coalesce(v_game.battle_votes, '{}'::jsonb), array[v_ctx.player_id::text], to_jsonb(p_winner_player_id::text), true);

  update public.lying_llama_games
  set battle_votes = v_votes,
      waiting_on = public.ll_remove_waiting(v_game.waiting_on, v_ctx.player_id),
      last_error = null
  where lobby_id = v_ctx.lobby_id;

  select * into v_game from public.lying_llama_games where lobby_id = v_ctx.lobby_id;

  v_asker_vote := coalesce(v_game.battle_votes ->> v_game.active_asker_id::text, '');
  v_target_vote := coalesce(v_game.battle_votes ->> v_game.active_target_id::text, '');

  if v_asker_vote = '' or v_target_vote = '' then
    return public.ll_get_state(p_game_code, p_player_token);
  end if;

  if v_asker_vote <> v_target_vote then
    update public.lying_llama_games
    set battle_votes = '{}'::jsonb,
        waiting_on = public.ll_waiting_pair(v_game.active_asker_id, v_game.active_target_id),
        last_error = 'Votes did not match. Vote again.'
    where lobby_id = v_ctx.lobby_id;
    return public.ll_get_state(p_game_code, p_player_token);
  end if;

  v_card := public.ll_transfer_top_card(v_ctx.lobby_id, v_game.active_target_id, v_asker_vote::uuid);

  update public.lying_llama_games
  set phase = 'turn_result',
      waiting_on = jsonb_build_array(v_game.active_asker_id::text),
      last_outcome_type = 'charlatan_caught',
      last_outcome_text = 'Charlatan battle resolved.',
      last_winner_id = v_asker_vote::uuid,
      last_loser_id = case when v_asker_vote::uuid = v_game.active_asker_id then v_game.active_target_id else v_game.active_asker_id end,
      last_card_won = coalesce(v_card ->> 'animal', null),
      battle_votes = '{}'::jsonb,
      last_error = null
  where lobby_id = v_ctx.lobby_id;

  return public.ll_get_state(p_game_code, p_player_token);
end;
$$;

grant execute on function public.ll_submit_target_response(text, text, boolean, boolean) to anon, authenticated;
grant execute on function public.ll_confirm_penalty(text, text, boolean) to anon, authenticated;
grant execute on function public.ll_vote_battle_winner(text, text, uuid) to anon, authenticated;

