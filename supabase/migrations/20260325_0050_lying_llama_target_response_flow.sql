-- Lying Llama flow refinements:
-- - Remove deal_reveal gate from active flow
-- - Add target_response step where asked player confirms correct/wrong

alter table public.lying_llama_games
  drop constraint if exists lying_llama_games_phase_check;

alter table public.lying_llama_games
  add constraint lying_llama_games_phase_check
  check (
    phase in (
      'rules',
      'deal_reveal',
      'turn_prompt',
      'target_response',
      'charlatan_prompt',
      'charlatan_call',
      'charlatan_battle',
      'charlatan_vote',
      'penalty_prompt',
      'penalty_confirm',
      'turn_result',
      'result'
    )
  );

create or replace function public.ll_continue(p_game_code text, p_player_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.lying_llama_games%rowtype;
  v_waiting jsonb;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.ll_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_game from public.lying_llama_games where lobby_id = v_ctx.lobby_id;
  if not found then
    raise exception 'Game runtime not initialized.';
  end if;

  if v_game.phase in ('rules', 'deal_reveal', 'charlatan_battle', 'turn_result') then
    if not exists (
      select 1
      from jsonb_array_elements_text(coalesce(v_game.waiting_on, '[]'::jsonb)) as w(value)
      where w.value = v_ctx.player_id::text
    ) then
      raise exception 'Waiting for another player.';
    end if;

    v_waiting := public.ll_remove_waiting(v_game.waiting_on, v_ctx.player_id);
    update public.lying_llama_games
    set waiting_on = v_waiting
    where lobby_id = v_ctx.lobby_id;

    if jsonb_array_length(v_waiting) = 0 then
      if v_game.phase = 'rules' then
        update public.lying_llama_games
        set phase = 'turn_prompt',
            waiting_on = '[]'::jsonb,
            last_error = null
        where lobby_id = v_ctx.lobby_id;
      elsif v_game.phase = 'deal_reveal' then
        update public.lying_llama_games
        set phase = 'turn_prompt',
            waiting_on = '[]'::jsonb,
            last_error = null
        where lobby_id = v_ctx.lobby_id;
      elsif v_game.phase = 'charlatan_battle' then
        update public.lying_llama_games
        set phase = 'charlatan_vote',
            waiting_on = public.ll_waiting_pair(v_game.active_asker_id, v_game.active_target_id),
            battle_votes = '{}'::jsonb,
            last_error = null
        where lobby_id = v_ctx.lobby_id;
      elsif v_game.phase = 'turn_result' then
        perform public.ll_advance_turn(v_ctx.lobby_id);
      end if;
    end if;
  elsif v_game.phase = 'charlatan_prompt' then
    if v_ctx.player_id <> v_game.active_target_id then
      raise exception 'Only the target can continue.';
    end if;
    update public.lying_llama_games
    set phase = 'charlatan_call',
        waiting_on = jsonb_build_array(v_game.active_asker_id::text),
        last_error = null
    where lobby_id = v_ctx.lobby_id;
  elsif v_game.phase = 'penalty_prompt' then
    if v_ctx.player_id <> v_game.active_asker_id then
      raise exception 'Only the guesser can continue.';
    end if;
    update public.lying_llama_games
    set phase = 'penalty_confirm',
        waiting_on = jsonb_build_array(v_game.active_target_id::text),
        last_error = null
    where lobby_id = v_ctx.lobby_id;
  else
    raise exception 'Continue is not available right now.';
  end if;

  return public.ll_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.ll_pick_animal(p_game_code text, p_player_token text, p_animal text)
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
  if not found or v_game.phase <> 'turn_prompt' then
    raise exception 'Turn prompt is not active.';
  end if;
  if v_game.active_asker_id <> v_ctx.player_id then
    raise exception 'It is not your turn.';
  end if;

  if p_animal not in ('Crazy Llama', 'Poison Dart Frog', 'Mountain Gorilla') then
    raise exception 'Invalid animal guess.';
  end if;

  update public.lying_llama_games
  set phase = 'target_response',
      selected_animal = p_animal,
      waiting_on = jsonb_build_array(v_game.active_target_id::text),
      battle_prompt = null,
      battle_votes = '{}'::jsonb,
      penalty_animal = null,
      last_error = null
  where lobby_id = v_ctx.lobby_id;

  return public.ll_get_state(p_game_code, p_player_token);
end;
$$;

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

  if p_correct_guess then
    if v_is_charlatan then
      update public.lying_llama_games
      set phase = 'charlatan_call',
          waiting_on = jsonb_build_array(v_game.active_asker_id::text),
          charlatan_prompt = public.ll_random_charlatan_prompt(),
          last_outcome_type = 'charlatan_spotted',
          last_outcome_text = 'Charlatan card is in play. Call it or let it go.',
          last_error = null
      where lobby_id = v_ctx.lobby_id;
    else
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
    end if;
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

grant execute on function public.ll_submit_target_response(text, text, boolean) to anon, authenticated;
