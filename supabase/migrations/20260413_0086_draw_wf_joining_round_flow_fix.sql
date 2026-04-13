-- Draw WF: fix join-mid-round flow + avoid premature round resolve

create or replace function public.dwf_get_state(p_game_code text, p_player_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.draw_wf_games%rowtype;
  v_round public.draw_wf_rounds%rowtype;
  v_players jsonb;
  v_guess record;
  v_reveal_word text;
  v_room_player_count integer := 0;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.dwf_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_game from public.draw_wf_games where lobby_id = v_ctx.lobby_id;
  if not found then
    return public.dwf_init_game(p_game_code, p_player_token, null);
  end if;

  if v_game.last_activity_at < now() - interval '14 days' then
    raise exception 'This Draw WF room expired. Start a new game.';
  end if;

  if v_game.phase = 'guess_live' and v_game.current_round_id is not null then
    select * into v_round from public.draw_wf_rounds where id = v_game.current_round_id;
    if found and v_round.guess_deadline_at is not null and now() >= v_round.guess_deadline_at and v_round.closed_at is null then
      perform public.dwf_resolve_round(v_ctx.lobby_id);
      select * into v_game from public.draw_wf_games where lobby_id = v_ctx.lobby_id;
    end if;
  end if;

  if v_game.current_round_id is not null then
    select * into v_round from public.draw_wf_rounds where id = v_game.current_round_id;
  end if;

  select count(*) into v_room_player_count
  from public.lobby_players p
  where p.lobby_id = v_ctx.lobby_id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id,
      'name', p.display_name,
      'isHost', p.is_host,
      'turnOrder', row_number() over (order by p.created_at) - 1,
      'status', 'active',
      'isDrawer', (v_round.id is not null and p.id = v_round.drawer_player_id)
    ) order by p.created_at), '[]'::jsonb)
  into v_players
  from public.lobby_players p
  where p.lobby_id = v_ctx.lobby_id;

  if v_round.id is not null then
    select g.guess_value, g.is_correct into v_guess
    from public.draw_wf_guesses g
    where g.round_id = v_round.id and g.player_id = v_ctx.player_id;
  end if;

  if v_round.id is not null
     and v_game.phase in ('draw_intro','draw_live')
     and v_ctx.player_id = v_round.drawer_player_id then
    v_reveal_word := v_round.word;
  elsif v_round.id is not null and v_game.phase = 'round_result' then
    v_reveal_word := v_round.word;
  else
    v_reveal_word := null;
  end if;

  return jsonb_build_object(
    'phase', v_game.phase,
    'roundNumber', v_game.round_number,
    'roundId', coalesce(v_game.current_round_id::text, ''),
    'drawerPlayerId', case when v_round.id is null then null else v_round.drawer_player_id end,
    'drawerName', case when v_round.id is null then null else (select p.display_name from public.lobby_players p where p.id = v_round.drawer_player_id) end,
    'wordLength', case when v_round.id is null then 0 else char_length(coalesce(v_round.word,'')) end,
    'wordMask', case when v_round.id is null then '_' else coalesce(v_round.word_mask, '_') end,
    'drawDeadlineAt', case when v_round.id is null then null else v_round.draw_deadline_at end,
    'guessDeadlineAt', case when v_round.id is null then null else v_round.guess_deadline_at end,
    'revealWord', v_reveal_word,
    'letterBank', case when v_round.id is null then '[]'::jsonb else coalesce(v_round.letter_bank, '[]'::jsonb) end,
    'replayPayload', case when v_round.id is null then null else v_round.replay_payload end,
    'waitingOn', coalesce(v_game.waiting_on, '[]'::jsonb),
    'roomPlayerCount', v_room_player_count,
    'streak', v_game.current_streak,
    'longestStreak', v_game.longest_streak,
    'allCorrect', case when v_round.id is null then null else v_round.all_correct end,
    'yourGuess', coalesce(v_guess.guess_value, null),
    'yourGuessCorrect', v_guess.is_correct,
    'players', v_players,
    'lastError', v_game.last_error,
    'you', jsonb_build_object('id', v_ctx.player_id, 'name', v_ctx.player_name, 'isHost', v_ctx.is_host)
  );
end;
$$;

create or replace function public.dwf_submit_drawing(p_game_code text, p_player_token text, p_replay_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.draw_wf_games%rowtype;
  v_round public.draw_wf_rounds%rowtype;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.dwf_player_context(p_game_code, p_player_token);
  if not found then raise exception 'Session expired.'; end if;

  select * into v_game from public.draw_wf_games where lobby_id = v_ctx.lobby_id for update;
  if not found or v_game.phase <> 'draw_live' then
    raise exception 'Drawing is not active.';
  end if;

  select * into v_round from public.draw_wf_rounds where id = v_game.current_round_id for update;
  if not found or v_round.drawer_player_id <> v_ctx.player_id then
    raise exception 'Only the current drawer can submit.';
  end if;

  update public.draw_wf_rounds
  set replay_payload = p_replay_payload
  where id = v_round.id;

  update public.draw_wf_games
  set phase = 'guess_intro',
      waiting_on = coalesce(v_round.guesser_ids, '[]'::jsonb),
      last_activity_at = now(),
      last_error = null
  where lobby_id = v_ctx.lobby_id;

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
  v_prev_waiting_count integer := 0;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.dwf_player_context(p_game_code, p_player_token);
  if not found then raise exception 'Session expired.'; end if;

  select * into v_game from public.draw_wf_games where lobby_id = v_ctx.lobby_id for update;
  if not found or v_game.phase <> 'guess_live' then
    raise exception 'Guessing is not active.';
  end if;

  select * into v_round from public.draw_wf_rounds where id = v_game.current_round_id for update;

  if v_round.drawer_player_id = v_ctx.player_id then
    raise exception 'Drawer cannot submit a guess.';
  end if;

  v_guess := upper(trim(coalesce(p_guess,'')));
  v_blocking := true;
  v_prev_waiting_count := jsonb_array_length(coalesce(v_game.waiting_on, '[]'::jsonb));

  insert into public.draw_wf_guesses (round_id, player_id, guess_value, is_correct, is_blocking)
  values (v_round.id, v_ctx.player_id, v_guess, (v_guess = upper(v_round.word)), v_blocking)
  on conflict (round_id, player_id)
  do update set
    guess_value = excluded.guess_value,
    is_correct = excluded.is_correct,
    is_blocking = excluded.is_blocking,
    guessed_at = now();

  v_waiting := public.dwf_remove_waiting(v_game.waiting_on, v_ctx.player_id);
  update public.draw_wf_games
  set waiting_on = v_waiting,
      last_activity_at = now()
  where lobby_id = v_ctx.lobby_id;

  if (v_prev_waiting_count > 0 and jsonb_array_length(v_waiting) = 0)
     or (v_round.guess_deadline_at is not null and now() >= v_round.guess_deadline_at) then
    perform public.dwf_resolve_round(v_ctx.lobby_id);
  end if;

  return public.dwf_get_state(p_game_code, p_player_token);
end;
$$;

grant execute on function public.dwf_get_state(text, text) to anon, authenticated;
grant execute on function public.dwf_submit_drawing(text, text, jsonb) to anon, authenticated;
grant execute on function public.dwf_submit_guess(text, text, text) to anon, authenticated;
