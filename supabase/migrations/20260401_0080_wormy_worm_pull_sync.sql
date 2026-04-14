-- Wormy Worm: sync pull animation across all players.

alter table public.wormy_worm_games
  add column if not exists pull_in_progress boolean not null default false;

create or replace function public.ww_get_state(p_game_code text, p_player_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.wormy_worm_games%rowtype;
  v_players jsonb;
  v_scores jsonb;
  v_draws jsonb;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.ww_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_game
  from public.wormy_worm_games
  where lobby_id = v_ctx.lobby_id;

  if not found then
    return public.ww_init_game(p_game_code, p_player_token, null);
  end if;

  v_scores := coalesce(v_game.scores, '{}'::jsonb);
  v_draws := coalesce(v_game.revealed_draws, '{}'::jsonb);

  with ordered as (
    select ordinality - 1 as idx, value::text as player_id_text
    from jsonb_array_elements_text(v_game.player_order) with ordinality
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'name', p.display_name,
        'isHost', p.is_host,
        'turnOrder', o.idx,
        'wormsTotal', coalesce((v_scores ->> p.id::text)::integer, 0),
        'draws', coalesce(v_draws -> p.id::text, '[]'::jsonb)
      )
      order by o.idx
    ),
    '[]'::jsonb
  )
  into v_players
  from ordered o
  join public.lobby_players p
    on p.lobby_id = v_ctx.lobby_id
   and p.id::text = o.player_id_text;

  return jsonb_build_object(
    'phase', v_game.phase,
    'roundNumber', v_game.round_number,
    'turnIndex', v_game.turn_index,
    'currentDrawerId', v_game.current_drawer_id,
    'currentDrawCount', v_game.current_draw_count,
    'penaltyMode', v_game.penalty_mode,
    'penaltyText', v_game.penalty_text,
    'pullInProgress', coalesce(v_game.pull_in_progress, false),
    'scores', v_scores,
    'waitingOn', coalesce(v_game.waiting_on, '[]'::jsonb),
    'players', v_players,
    'lastError', v_game.last_error,
    'you', jsonb_build_object(
      'id', v_ctx.player_id,
      'name', v_ctx.player_name,
      'isHost', v_ctx.is_host,
      'wormsTotal', coalesce((v_scores ->> v_ctx.player_id::text)::integer, 0)
    )
  );
end;
$$;

create or replace function public.ww_start_pull(p_game_code text, p_player_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.wormy_worm_games%rowtype;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.ww_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_game
  from public.wormy_worm_games
  where lobby_id = v_ctx.lobby_id
  for update;

  if not found then
    raise exception 'Game runtime not initialized.';
  end if;

  if v_game.phase <> 'draw_reveal' then
    return public.ww_get_state(p_game_code, p_player_token);
  end if;

  if v_ctx.player_id <> v_game.current_drawer_id then
    raise exception 'Only current drawer can pull.';
  end if;

  update public.wormy_worm_games
  set pull_in_progress = true,
      last_error = null
  where lobby_id = v_ctx.lobby_id;

  return public.ww_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.ww_continue(p_game_code text, p_player_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.wormy_worm_games%rowtype;
  v_waiting jsonb;
  v_next_turn integer;
  v_score integer;
  v_scores jsonb;
  v_revealed jsonb;
  v_arr jsonb;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.ww_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_game
  from public.wormy_worm_games
  where lobby_id = v_ctx.lobby_id
  for update;

  if not found then
    raise exception 'Game runtime not initialized.';
  end if;

  if v_game.phase = 'rules' then
    if not (coalesce(v_game.waiting_on, '[]'::jsonb) @> jsonb_build_array(v_ctx.player_id::text)) then
      return public.ww_get_state(p_game_code, p_player_token);
    end if;

    v_waiting := public.ww_remove_waiting(v_game.waiting_on, v_ctx.player_id);
    update public.wormy_worm_games
    set waiting_on = v_waiting
    where lobby_id = v_ctx.lobby_id;

    if jsonb_array_length(v_waiting) = 0 then
      update public.wormy_worm_games
      set phase = 'penalty_mode',
          waiting_on = '[]'::jsonb,
          last_error = null
      where lobby_id = v_ctx.lobby_id;
    end if;

    return public.ww_get_state(p_game_code, p_player_token);
  end if;

  if v_game.phase = 'penalty_ready' then
    if v_ctx.is_host is false then
      return public.ww_get_state(p_game_code, p_player_token);
    end if;
    if not (coalesce(v_game.waiting_on, '[]'::jsonb) @> jsonb_build_array(v_ctx.player_id::text)) then
      return public.ww_get_state(p_game_code, p_player_token);
    end if;

    perform public.ww_prepare_turn(v_ctx.lobby_id);
    return public.ww_get_state(p_game_code, p_player_token);
  end if;

  if v_game.phase = 'draw_reveal' then
    if v_ctx.player_id <> v_game.current_drawer_id then
      return public.ww_get_state(p_game_code, p_player_token);
    end if;

    v_scores := coalesce(v_game.scores, '{}'::jsonb);
    v_score := coalesce((v_scores ->> v_ctx.player_id::text)::integer, 0) + coalesce(v_game.current_draw_count, 0);
    v_scores := jsonb_set(v_scores, array[v_ctx.player_id::text], to_jsonb(v_score), true);

    v_revealed := coalesce(v_game.revealed_draws, '{}'::jsonb);
    v_arr := coalesce(v_revealed -> v_ctx.player_id::text, '[]'::jsonb);
    if jsonb_typeof(v_arr) <> 'array' then
      v_arr := '[]'::jsonb;
    end if;
    v_arr := v_arr || to_jsonb(coalesce(v_game.current_draw_count, 0));
    v_revealed := jsonb_set(v_revealed, array[v_ctx.player_id::text], v_arr, true);

    update public.wormy_worm_games
    set phase = 'draw_result',
        scores = v_scores,
        revealed_draws = v_revealed,
        waiting_on = jsonb_build_array(v_ctx.player_id::text),
        pull_in_progress = false,
        last_error = null
    where lobby_id = v_ctx.lobby_id;

    return public.ww_get_state(p_game_code, p_player_token);
  end if;

  if v_game.phase = 'draw_result' then
    if v_ctx.player_id <> v_game.current_drawer_id then
      return public.ww_get_state(p_game_code, p_player_token);
    end if;

    v_next_turn := v_game.turn_index + 1;
    update public.wormy_worm_games
    set turn_index = v_next_turn
    where lobby_id = v_ctx.lobby_id;

    perform public.ww_prepare_turn(v_ctx.lobby_id);
    return public.ww_get_state(p_game_code, p_player_token);
  end if;

  return public.ww_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.ww_prepare_turn(p_lobby_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.wormy_worm_games%rowtype;
  v_player_count integer;
  v_total_turns integer;
  v_drawer_idx integer;
  v_draw_round integer;
  v_drawer_id uuid;
  v_draw_count integer;
begin
  select * into v_game
  from public.wormy_worm_games
  where lobby_id = p_lobby_id
  for update;

  if not found then
    return;
  end if;

  v_player_count := public.rd_player_count(v_game.player_order);
  v_total_turns := v_player_count * 3;

  if v_player_count < 2 or v_game.turn_index >= v_total_turns then
    update public.wormy_worm_games
    set phase = 'result',
        waiting_on = '[]'::jsonb,
        pull_in_progress = false
    where lobby_id = p_lobby_id;
    return;
  end if;

  v_drawer_idx := mod(v_game.turn_index, v_player_count);
  v_draw_round := floor((v_game.turn_index)::numeric / v_player_count)::integer + 1;
  v_drawer_id := public.rd_player_at(v_game.player_order, v_drawer_idx);
  v_draw_count := coalesce((v_game.draw_plan -> v_drawer_id::text ->> (v_draw_round - 1))::integer, public.ww_weighted_draw());

  update public.wormy_worm_games
  set phase = 'draw_reveal',
      round_number = v_draw_round,
      current_drawer_id = v_drawer_id,
      current_draw_count = v_draw_count,
      waiting_on = jsonb_build_array(v_drawer_id::text),
      pull_in_progress = false,
      last_error = null
  where lobby_id = p_lobby_id;
end;
$$;

grant execute on function public.ww_start_pull(text, text) to anon, authenticated;

