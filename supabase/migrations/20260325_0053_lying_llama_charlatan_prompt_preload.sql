-- Fix: pre-populate charlatan_prompt during target_response when guess is correct on a Charlatan top card.

create or replace function public.ll_pick_animal(p_game_code text, p_player_token text, p_animal text)
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

  v_top := public.ll_top_card(v_ctx.lobby_id, v_game.active_target_id);
  if v_top is null then
    perform public.ll_advance_turn(v_ctx.lobby_id);
    return public.ll_get_state(p_game_code, p_player_token);
  end if;

  v_top_animal := coalesce(v_top ->> 'animal', null);
  v_is_charlatan := coalesce((v_top ->> 'isCharlatan')::boolean, false);
  v_guess_is_correct := lower(trim(coalesce(p_animal, ''))) = lower(trim(coalesce(v_top_animal, '')));

  update public.lying_llama_games
  set phase = 'target_response',
      selected_animal = p_animal,
      waiting_on = jsonb_build_array(v_game.active_target_id::text),
      charlatan_prompt = case when v_is_charlatan and v_guess_is_correct then public.ll_random_charlatan_prompt() else null end,
      battle_prompt = null,
      battle_votes = '{}'::jsonb,
      penalty_animal = null,
      last_error = null
  where lobby_id = v_ctx.lobby_id;

  return public.ll_get_state(p_game_code, p_player_token);
end;
$$;
