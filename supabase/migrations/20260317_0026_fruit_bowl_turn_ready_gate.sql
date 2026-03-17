-- Fruit Bowl pacing update:
-- add "turn_ready" gate so active clue giver starts the timer manually.

alter table public.fruit_bowl_games
  drop constraint if exists fruit_bowl_games_phase_check;

alter table public.fruit_bowl_games
  add constraint fruit_bowl_games_phase_check
  check (phase in ('rules', 'input', 'teams', 'round_intro', 'turn_ready', 'turn_live', 'turn_summary', 'round_results', 'result'));

create or replace function public.fb_advance_after_summary(p_lobby_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.fruit_bowl_games%rowtype;
  v_pile_count integer;
begin
  select * into v_game
  from public.fruit_bowl_games
  where lobby_id = p_lobby_id;

  if not found or v_game.phase <> 'turn_summary' then
    return;
  end if;

  v_pile_count := jsonb_array_length(coalesce(v_game.round_pile, '[]'::jsonb));

  if v_pile_count = 0 then
    if v_game.round_number >= 3 then
      update public.fruit_bowl_games
      set phase = 'result',
          waiting_on = '[]'::jsonb,
          summary_ends_at = null,
          turn_ends_at = null,
          current_prompt = null
      where lobby_id = p_lobby_id;
    else
      update public.fruit_bowl_games
      set phase = 'round_results',
          waiting_on = public.cc_active_player_ids(p_lobby_id),
          summary_ends_at = null,
          turn_ends_at = null,
          current_prompt = null
      where lobby_id = p_lobby_id;
    end if;
    return;
  end if;

  update public.fruit_bowl_games
  set phase = 'turn_ready',
      turn_ends_at = null,
      summary_ends_at = null,
      turn_points_current = 0,
      current_prompt = coalesce(round_pile ->> 0, null),
      last_error = null
  where lobby_id = p_lobby_id;
end;
$$;

create or replace function public.fb_continue(p_game_code text, p_player_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.fruit_bowl_games%rowtype;
  v_waiting jsonb;
begin
  perform public.cleanup_lobby_presence(p_game_code);

  select * into v_ctx from public.fb_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_game
  from public.fruit_bowl_games
  where lobby_id = v_ctx.lobby_id;

  if not found then
    raise exception 'Game runtime not initialized.';
  end if;

  if v_game.phase in ('rules', 'teams', 'round_intro', 'round_results') then
    v_waiting := public.fb_remove_waiting(v_game.waiting_on, v_ctx.player_id);
    update public.fruit_bowl_games
    set waiting_on = v_waiting
    where lobby_id = v_ctx.lobby_id;

    if jsonb_array_length(v_waiting) = 0 then
      if v_game.phase = 'rules' then
        update public.fruit_bowl_games
        set phase = 'input',
            waiting_on = '[]'::jsonb,
            last_error = null
        where lobby_id = v_ctx.lobby_id;
      elsif v_game.phase = 'teams' then
        perform public.fb_prepare_round(v_ctx.lobby_id, 1);
      elsif v_game.phase = 'round_intro' then
        update public.fruit_bowl_games
        set phase = 'turn_ready',
            waiting_on = '[]'::jsonb,
            turn_ends_at = null,
            summary_ends_at = null,
            turn_points_current = 0,
            current_prompt = coalesce(round_pile ->> 0, null),
            last_error = null
        where lobby_id = v_ctx.lobby_id;
      elsif v_game.phase = 'round_results' then
        if v_game.round_number >= 3 then
          update public.fruit_bowl_games
          set phase = 'result',
              waiting_on = '[]'::jsonb,
              last_error = null
          where lobby_id = v_ctx.lobby_id;
        else
          perform public.fb_prepare_round(v_ctx.lobby_id, v_game.round_number + 1);
        end if;
      end if;
    end if;
  elsif v_game.phase = 'turn_ready' then
    if v_game.active_cluegiver_id is distinct from v_ctx.player_id then
      raise exception 'Waiting for the active clue giver to start the turn.';
    end if;

    update public.fruit_bowl_games
    set phase = 'turn_live',
        turn_ends_at = now() + interval '45 seconds',
        summary_ends_at = null,
        turn_points_current = 0,
        current_prompt = coalesce(round_pile ->> 0, null),
        last_error = null
    where lobby_id = v_ctx.lobby_id;
  end if;

  return public.fb_get_state(p_game_code, p_player_token);
end;
$$;

grant execute on function public.fb_advance_after_summary(uuid) to anon, authenticated;
grant execute on function public.fb_continue(text, text) to anon, authenticated;
