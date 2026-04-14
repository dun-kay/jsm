-- Draw WF: ensure non-drawer players can always join active guess flow

create or replace function public.dwf_continue(p_game_code text, p_player_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.draw_wf_games%rowtype;
  v_round public.draw_wf_rounds%rowtype;
  v_waiting jsonb;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.dwf_player_context(p_game_code, p_player_token);
  if not found then raise exception 'Session expired.'; end if;

  select * into v_game from public.draw_wf_games where lobby_id = v_ctx.lobby_id for update;
  if not found then raise exception 'Game runtime not initialized.'; end if;

  if v_game.phase = 'rules' then
    if not (coalesce(v_game.waiting_on,'[]'::jsonb) @> jsonb_build_array(v_ctx.player_id::text)) then
      return public.dwf_get_state(p_game_code, p_player_token);
    end if;

    v_waiting := public.dwf_remove_waiting(v_game.waiting_on, v_ctx.player_id);
    update public.draw_wf_games
    set waiting_on = v_waiting,
        last_activity_at = now(),
        last_error = null
    where lobby_id = v_ctx.lobby_id;

    if jsonb_array_length(v_waiting) = 0 then
      perform public.dwf_start_round(v_ctx.lobby_id);
    end if;

    return public.dwf_get_state(p_game_code, p_player_token);
  end if;

  select * into v_round from public.draw_wf_rounds where id = v_game.current_round_id for update;

  if v_game.phase = 'draw_intro' then
    if v_ctx.player_id <> v_round.drawer_player_id then
      return public.dwf_get_state(p_game_code, p_player_token);
    end if;

    update public.draw_wf_games
    set phase = 'draw_live',
        waiting_on = jsonb_build_array(v_round.drawer_player_id::text),
        last_activity_at = now(),
        last_error = null
    where lobby_id = v_ctx.lobby_id;

    update public.draw_wf_rounds
    set draw_deadline_at = now() + interval '10 seconds'
    where id = v_round.id;

    return public.dwf_get_state(p_game_code, p_player_token);
  end if;

  if v_game.phase = 'guess_intro' then
    if v_ctx.player_id <> v_round.drawer_player_id
       and not (coalesce(v_game.waiting_on,'[]'::jsonb) @> jsonb_build_array(v_ctx.player_id::text))
    then
      update public.draw_wf_rounds r
      set guesser_ids = (
        select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
        from (
          select distinct value as x
          from jsonb_array_elements_text(coalesce(r.guesser_ids, '[]'::jsonb))
          union
          select v_ctx.player_id::text
        ) s
      )
      where r.id = v_round.id;

      update public.draw_wf_games g
      set waiting_on = (
        select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
        from (
          select distinct value as x
          from jsonb_array_elements_text(coalesce(g.waiting_on, '[]'::jsonb))
          union
          select v_ctx.player_id::text
        ) s
      ),
      last_activity_at = now(),
      last_error = null
      where g.lobby_id = v_ctx.lobby_id;

      select * into v_game from public.draw_wf_games where lobby_id = v_ctx.lobby_id;
      select * into v_round from public.draw_wf_rounds where id = v_round.id;
    end if;

    if not (coalesce(v_game.waiting_on,'[]'::jsonb) @> jsonb_build_array(v_ctx.player_id::text)) then
      return public.dwf_get_state(p_game_code, p_player_token);
    end if;

    v_waiting := public.dwf_remove_waiting(v_game.waiting_on, v_ctx.player_id);
    update public.draw_wf_games
    set waiting_on = v_waiting,
        last_activity_at = now(),
        last_error = null
    where lobby_id = v_ctx.lobby_id;

    if jsonb_array_length(v_waiting) = 0 then
      update public.draw_wf_games
      set phase = 'guess_live',
          waiting_on = coalesce(v_round.guesser_ids, '[]'::jsonb),
          last_activity_at = now(),
          last_error = null
      where lobby_id = v_ctx.lobby_id;

      update public.draw_wf_rounds
      set guess_deadline_at = now() + interval '10 seconds'
      where id = v_round.id;
    end if;

    return public.dwf_get_state(p_game_code, p_player_token);
  end if;

  if v_game.phase = 'round_result' then
    if not (coalesce(v_game.waiting_on,'[]'::jsonb) @> jsonb_build_array(v_ctx.player_id::text)) then
      return public.dwf_get_state(p_game_code, p_player_token);
    end if;

    update public.draw_wf_games
    set turn_index = v_game.turn_index + 1,
        last_activity_at = now(),
        last_error = null
    where lobby_id = v_ctx.lobby_id;

    perform public.dwf_start_round(v_ctx.lobby_id);
    return public.dwf_get_state(p_game_code, p_player_token);
  end if;

  return public.dwf_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.dwf_submit_guess(p_game_code text, p_player_token text, p_guess text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.draw_wf_games%rowtype;
  v_round public.draw_wf_rounds%rowtype;
  v_guess text;
  v_blocking boolean;
  v_waiting jsonb;
  v_prev_waiting_count integer;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.dwf_player_context(p_game_code, p_player_token);
  if not found then raise exception 'Session expired.'; end if;

  select * into v_game from public.draw_wf_games where lobby_id = v_ctx.lobby_id for update;
  if not found or v_game.phase <> 'guess_live' then
    raise exception 'Guessing is not active.';
  end if;

  select * into v_round from public.draw_wf_rounds where id = v_game.current_round_id for update;

  if v_ctx.player_id = v_round.drawer_player_id then
    raise exception 'Drawer cannot submit a guess.';
  end if;

  if not (coalesce(v_round.guesser_ids, '[]'::jsonb) @> jsonb_build_array(v_ctx.player_id::text)) then
    update public.draw_wf_rounds r
    set guesser_ids = (
      select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
      from (
        select distinct value as x
        from jsonb_array_elements_text(coalesce(r.guesser_ids, '[]'::jsonb))
        union
        select v_ctx.player_id::text
      ) s
    )
    where r.id = v_round.id;

    update public.draw_wf_games g
    set waiting_on = (
      select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
      from (
        select distinct value as x
        from jsonb_array_elements_text(coalesce(g.waiting_on, '[]'::jsonb))
        union
        select v_ctx.player_id::text
      ) s
    ),
    last_activity_at = now(),
    last_error = null
    where g.lobby_id = v_ctx.lobby_id;

    select * into v_game from public.draw_wf_games where lobby_id = v_ctx.lobby_id;
    select * into v_round from public.draw_wf_rounds where id = v_round.id;
  end if;

  v_guess := upper(trim(coalesce(p_guess,'')));
  v_blocking := (coalesce(v_round.guesser_ids, '[]'::jsonb) @> jsonb_build_array(v_ctx.player_id::text));
  v_prev_waiting_count := jsonb_array_length(coalesce(v_game.waiting_on, '[]'::jsonb));

  insert into public.draw_wf_guesses (round_id, player_id, guess_value, is_correct, is_blocking)
  values (v_round.id, v_ctx.player_id, v_guess, (v_guess = upper(v_round.word)), v_blocking)
  on conflict (round_id, player_id)
  do update set
    guess_value = excluded.guess_value,
    is_correct = excluded.is_correct,
    is_blocking = excluded.is_blocking,
    guessed_at = now();

  if v_blocking then
    v_waiting := public.dwf_remove_waiting(v_game.waiting_on, v_ctx.player_id);
    update public.draw_wf_games
    set waiting_on = v_waiting,
        last_activity_at = now()
    where lobby_id = v_ctx.lobby_id;

    if (v_prev_waiting_count > 0 and jsonb_array_length(v_waiting) = 0)
       or (v_round.guess_deadline_at is not null and now() >= v_round.guess_deadline_at)
    then
      perform public.dwf_resolve_round(v_ctx.lobby_id);
    end if;
  end if;

  return public.dwf_get_state(p_game_code, p_player_token);
end;
$$;

grant execute on function public.dwf_continue(text, text) to anon, authenticated;
grant execute on function public.dwf_submit_guess(text, text, text) to anon, authenticated;
