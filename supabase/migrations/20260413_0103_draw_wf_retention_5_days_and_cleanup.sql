-- Draw WF: reduce retention to 5 days and actively purge expired draw data

create or replace function public.dwf_cleanup_expired_data()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted_games integer := 0;
begin
  with expired as (
    select g.lobby_id
    from public.draw_wf_games g
    where g.last_activity_at < now() - interval '5 days'
  )
  delete from public.draw_wf_guesses gg
  using public.draw_wf_rounds rr, expired e
  where gg.round_id = rr.id
    and rr.lobby_id = e.lobby_id;

  with expired as (
    select g.lobby_id
    from public.draw_wf_games g
    where g.last_activity_at < now() - interval '5 days'
  )
  delete from public.draw_wf_rounds rr
  using expired e
  where rr.lobby_id = e.lobby_id;

  with expired as (
    select g.lobby_id
    from public.draw_wf_games g
    where g.last_activity_at < now() - interval '5 days'
  )
  delete from public.draw_wf_games g
  using expired e
  where g.lobby_id = e.lobby_id;

  get diagnostics v_deleted_games = row_count;
  return v_deleted_games;
end;
$$;

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
  v_guess_value text := null;
  v_guess_correct boolean := null;
  v_reveal_word text;
  v_room_player_count integer := 0;
begin
  perform public.dwf_cleanup_expired_data();
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.dwf_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_game from public.draw_wf_games where lobby_id = v_ctx.lobby_id for update;
  if not found then
    return public.dwf_init_game(p_game_code, p_player_token, public.dwf_default_word_pool());
  end if;

  if v_game.last_activity_at < now() - interval '5 days' then
    raise exception 'This Draw WF room expired. Start a new game.';
  end if;

  if v_game.current_round_id is not null then
    select * into v_round from public.draw_wf_rounds where id = v_game.current_round_id for update;
  end if;

  if v_game.phase = 'guess_live'
     and v_round.id is not null
     and v_round.replay_payload is not null
     and v_ctx.player_id <> v_round.drawer_player_id
     and not exists (
       select 1
       from public.draw_wf_guesses g
       where g.round_id = v_round.id and g.player_id = v_ctx.player_id
     )
  then
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
    end if;

    if not (coalesce(v_game.waiting_on, '[]'::jsonb) @> jsonb_build_array(v_ctx.player_id::text)) then
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
    end if;

    select * into v_game from public.draw_wf_games where lobby_id = v_ctx.lobby_id;
    select * into v_round from public.draw_wf_rounds where id = v_round.id;
  end if;

  select count(*) into v_room_player_count
  from public.lobby_players p
  where p.lobby_id = v_ctx.lobby_id;

  with ordered_players as (
    select
      p.id,
      p.display_name,
      p.is_host,
      row_number() over (order by p.created_at) - 1 as turn_order
    from public.lobby_players p
    where p.lobby_id = v_ctx.lobby_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', op.id,
      'name', op.display_name,
      'isHost', op.is_host,
      'turnOrder', op.turn_order,
      'status', 'active',
      'isDrawer', (v_round.id is not null and op.id = v_round.drawer_player_id)
    ) order by op.turn_order), '[]'::jsonb)
  into v_players
  from ordered_players op;

  if v_round.id is not null then
    select g.guess_value, g.is_correct
    into v_guess_value, v_guess_correct
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
    'guesserIds', case when v_round.id is null then '[]'::jsonb else coalesce(v_round.guesser_ids, '[]'::jsonb) end,
    'activeGuesserIds', case when v_game.phase = 'guess_live' then coalesce(v_game.waiting_on, '[]'::jsonb) else '[]'::jsonb end,
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
    'yourGuess', v_guess_value,
    'yourGuessCorrect', v_guess_correct,
    'players', v_players,
    'lastError', v_game.last_error,
    'you', jsonb_build_object('id', v_ctx.player_id, 'name', v_ctx.player_name, 'isHost', v_ctx.is_host)
  );
end;
$$;

grant execute on function public.dwf_cleanup_expired_data() to anon, authenticated;
grant execute on function public.dwf_get_state(text, text) to anon, authenticated;
