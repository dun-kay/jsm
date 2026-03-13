-- Celebrities hotfix:
-- 1) Change reveal timers to 15 seconds.
-- 2) Expose waiting state + per-player submitted state in cc_get_state.

create or replace function public.cc_get_state(p_game_code text, p_player_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.celebrities_games%rowtype;
  v_players jsonb;
  v_celeb_list jsonb;
  v_team_leaders jsonb;
  v_my_leader uuid;
  v_waiting_input jsonb;
  v_waiting_state jsonb;
  v_my_submit_count integer;
begin
  perform public.cleanup_lobby_presence(p_game_code);

  select * into v_ctx from public.cc_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_game
  from public.celebrities_games
  where lobby_id = v_ctx.lobby_id;

  if not found then
    return public.cc_init_game(p_game_code, p_player_token);
  end if;

  select ps.leader_id
  into v_my_leader
  from public.celebrities_player_state ps
  where ps.lobby_id = v_ctx.lobby_id
    and ps.player_id = v_ctx.player_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'name', p.display_name,
        'leaderId', ps.leader_id,
        'celebrityName', case when v_game.phase = 'result' then ps.celebrity_name else null end
      )
      order by p.created_at
    ),
    '[]'::jsonb
  )
  into v_players
  from public.lobby_players p
  join public.celebrities_player_state ps
    on ps.lobby_id = p.lobby_id
   and ps.player_id = p.id
  where p.lobby_id = v_ctx.lobby_id;

  select coalesce(jsonb_agg(e.celeb_name order by e.created_at), '[]'::jsonb)
  into v_celeb_list
  from public.celebrities_entries e
  where e.lobby_id = v_ctx.lobby_id;

  select coalesce(jsonb_agg(distinct ps.leader_id), '[]'::jsonb)
  into v_team_leaders
  from public.celebrities_player_state ps
  where ps.lobby_id = v_ctx.lobby_id;

  select coalesce(jsonb_agg(to_jsonb(p.id) order by p.created_at), '[]'::jsonb)
  into v_waiting_input
  from public.lobby_players p
  left join (
    select e.player_id, count(*) as c
    from public.celebrities_entries e
    where e.lobby_id = v_ctx.lobby_id
      and e.is_bot = false
    group by e.player_id
  ) per_player on per_player.player_id = p.id
  where p.lobby_id = v_ctx.lobby_id
    and coalesce(per_player.c, 0) < 2;

  select count(*) into v_my_submit_count
  from public.celebrities_entries e
  where e.lobby_id = v_ctx.lobby_id
    and e.is_bot = false
    and e.player_id = v_ctx.player_id;

  v_waiting_state := case
    when v_game.phase = 'input' then v_waiting_input
    else coalesce(v_game.waiting_on, '[]'::jsonb)
  end;

  return jsonb_build_object(
    'phase', v_game.phase,
    'revealRound', v_game.reveal_round,
    'revealEndsAt', v_game.reveal_ends_at,
    'waitingOn', v_waiting_state,
    'yourSubmitted', (v_my_submit_count >= 2),
    'currentAskerId', v_game.current_asker_id,
    'currentTargetId', v_game.current_target_id,
    'currentGuess', v_game.current_guess,
    'askerConfirm', v_game.asker_confirm,
    'targetConfirm', v_game.target_confirm,
    'lastError', v_game.last_error,
    'showCelebrityList', (v_game.phase in ('reveal', 'result')),
    'celebrityList', v_celeb_list,
    'players', v_players,
    'teamLeaders', v_team_leaders,
    'you', jsonb_build_object(
      'id', v_ctx.player_id,
      'name', v_ctx.player_name,
      'isHost', v_ctx.is_host,
      'leaderId', v_my_leader
    )
  );
end;
$$;

create or replace function public.cc_submit_celebrities(
  p_game_code text,
  p_player_token text,
  p_celebrity_one text,
  p_celebrity_two text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.celebrities_games%rowtype;
  v_name_one text;
  v_name_two text;
  v_player_count integer;
  v_submitted_count integer;
  v_bot text;
  v_added integer := 0;
  v_conflict_name text;
  v_bot_pool text[] := array[
    'Harry Potter', 'Peter Parker', 'Daffy Duck', 'Beyonce', 'Taylor Swift',
    'LeBron James', 'Elon Musk', 'Oprah Winfrey', 'Lionel Messi', 'Barbie',
    'Mickey Mouse', 'Batman', 'Shrek', 'SpongeBob', 'Darth Vader',
    'Hermione Granger', 'Spider-Man', 'Ariana Grande', 'Mr Bean', 'Wonder Woman'
  ];
begin
  perform public.cleanup_lobby_presence(p_game_code);

  select * into v_ctx from public.cc_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_game
  from public.celebrities_games
  where lobby_id = v_ctx.lobby_id;

  if not found or v_game.phase <> 'input' then
    raise exception 'Celebrity entry is not active.';
  end if;

  v_name_one := left(trim(p_celebrity_one), 20);
  v_name_two := left(trim(p_celebrity_two), 20);

  if v_name_one = '' or v_name_two = '' then
    raise exception 'Enter two celebrities.';
  end if;

  if public.cc_name_too_close(public.cc_name_norm(v_name_one), public.cc_name_norm(v_name_two)) then
    raise exception 'Use two different celebrities.';
  end if;

  select e.celeb_name
  into v_conflict_name
  from public.celebrities_entries e
  where e.lobby_id = v_ctx.lobby_id
    and e.player_id <> v_ctx.player_id
    and public.cc_name_too_close(public.cc_name_norm(e.celeb_name), public.cc_name_norm(v_name_one))
  limit 1;

  if v_conflict_name is not null then
    raise exception 'Someone already used a similar celebrity: "%". Pick another.', v_conflict_name;
  end if;

  select e.celeb_name
  into v_conflict_name
  from public.celebrities_entries e
  where e.lobby_id = v_ctx.lobby_id
    and e.player_id <> v_ctx.player_id
    and public.cc_name_too_close(public.cc_name_norm(e.celeb_name), public.cc_name_norm(v_name_two))
  limit 1;

  if v_conflict_name is not null then
    raise exception 'Someone already used a similar celebrity: "%". Pick another.', v_conflict_name;
  end if;

  insert into public.celebrities_entries (lobby_id, player_id, slot, celeb_name, is_bot)
  values (v_ctx.lobby_id, v_ctx.player_id, 1, v_name_one, false)
  on conflict (lobby_id, player_id, slot) where is_bot = false
  do update set celeb_name = excluded.celeb_name, updated_at = now();

  insert into public.celebrities_entries (lobby_id, player_id, slot, celeb_name, is_bot)
  values (v_ctx.lobby_id, v_ctx.player_id, 2, v_name_two, false)
  on conflict (lobby_id, player_id, slot) where is_bot = false
  do update set celeb_name = excluded.celeb_name, updated_at = now();

  select count(*) into v_player_count
  from public.lobby_players p
  where p.lobby_id = v_ctx.lobby_id;

  with per_player as (
    select e.player_id, count(*) as c
    from public.celebrities_entries e
    where e.lobby_id = v_ctx.lobby_id
      and e.is_bot = false
    group by e.player_id
  )
  select count(*) into v_submitted_count
  from per_player
  where c >= 2;

  if v_submitted_count = v_player_count then
    update public.celebrities_player_state ps
    set celebrity_name = pick.celeb_name
    from (
      select picked.player_id, picked.celeb_name
      from (
        select
          e.player_id,
          e.celeb_name,
          row_number() over (partition by e.player_id order by random()) as rn
        from public.celebrities_entries e
        where e.lobby_id = v_ctx.lobby_id
          and e.is_bot = false
      ) picked
      where picked.rn = 1
    ) pick
    where ps.lobby_id = v_ctx.lobby_id
      and ps.player_id = pick.player_id;

    delete from public.celebrities_entries e
    where e.lobby_id = v_ctx.lobby_id
      and e.is_bot = true;

    foreach v_bot in array v_bot_pool loop
      exit when v_added >= 2;
      if not exists (
        select 1
        from public.celebrities_entries e
        where e.lobby_id = v_ctx.lobby_id
          and public.cc_name_too_close(public.cc_name_norm(e.celeb_name), public.cc_name_norm(v_bot))
      ) then
        insert into public.celebrities_entries (lobby_id, player_id, slot, celeb_name, is_bot)
        values (v_ctx.lobby_id, null, null, v_bot, true);
        v_added := v_added + 1;
      end if;
    end loop;

    update public.celebrities_games
    set phase = 'reveal',
        reveal_round = 1,
        reveal_ends_at = now() + interval '15 seconds',
        waiting_on = public.cc_active_player_ids(v_ctx.lobby_id),
        last_error = null
    where lobby_id = v_ctx.lobby_id;
  end if;

  return public.cc_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.cc_confirm_guess(
  p_game_code text,
  p_player_token text,
  p_is_correct boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.celebrities_games%rowtype;
  v_asker_leader uuid;
  v_target_leader uuid;
  v_next_asker uuid;
  v_leader_count integer;
begin
  perform public.cleanup_lobby_presence(p_game_code);

  select * into v_ctx from public.cc_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_game
  from public.celebrities_games
  where lobby_id = v_ctx.lobby_id;

  if not found or v_game.phase <> 'guess_confirm' then
    raise exception 'Guess confirmation is not active.';
  end if;

  if v_ctx.player_id <> v_game.current_asker_id and v_ctx.player_id <> v_game.current_target_id then
    raise exception 'Only the asking player and target can confirm.';
  end if;

  if v_ctx.player_id = v_game.current_asker_id then
    update public.celebrities_games
    set asker_confirm = p_is_correct
    where lobby_id = v_ctx.lobby_id;
  else
    update public.celebrities_games
    set target_confirm = p_is_correct
    where lobby_id = v_ctx.lobby_id;
  end if;

  select * into v_game
  from public.celebrities_games
  where lobby_id = v_ctx.lobby_id;

  if v_game.asker_confirm is null or v_game.target_confirm is null then
    return public.cc_get_state(p_game_code, p_player_token);
  end if;

  if v_game.asker_confirm <> v_game.target_confirm then
    update public.celebrities_games
    set asker_confirm = null,
        target_confirm = null,
        last_error = 'Answers did not match. Confirm again.'
    where lobby_id = v_ctx.lobby_id;

    return public.cc_get_state(p_game_code, p_player_token);
  end if;

  if v_game.asker_confirm = true then
    select leader_id into v_asker_leader
    from public.celebrities_player_state
    where lobby_id = v_ctx.lobby_id
      and player_id = v_game.current_asker_id;

    select leader_id into v_target_leader
    from public.celebrities_player_state
    where lobby_id = v_ctx.lobby_id
      and player_id = v_game.current_target_id;

    update public.celebrities_player_state
    set leader_id = v_asker_leader
    where lobby_id = v_ctx.lobby_id
      and leader_id = v_target_leader;

    v_next_asker := v_game.current_asker_id;
  else
    v_next_asker := v_game.current_target_id;
  end if;

  select count(distinct leader_id) into v_leader_count
  from public.celebrities_player_state
  where lobby_id = v_ctx.lobby_id;

  if v_leader_count <= 1 then
    update public.celebrities_games
    set phase = 'result',
        current_asker_id = v_next_asker,
        current_target_id = null,
        current_guess = null,
        asker_confirm = null,
        target_confirm = null,
        pending_next_asker_id = null,
        last_error = null
    where lobby_id = v_ctx.lobby_id;

    return public.cc_get_state(p_game_code, p_player_token);
  end if;

  if v_game.first_turn_done = false then
    update public.celebrities_games
    set phase = 'reveal',
        reveal_round = 2,
        reveal_ends_at = now() + interval '15 seconds',
        waiting_on = public.cc_active_player_ids(v_ctx.lobby_id),
        first_turn_done = true,
        pending_next_asker_id = v_next_asker,
        current_target_id = null,
        current_guess = null,
        asker_confirm = null,
        target_confirm = null,
        last_error = null
    where lobby_id = v_ctx.lobby_id;
  else
    update public.celebrities_games
    set phase = 'guess_pick',
        current_asker_id = v_next_asker,
        current_target_id = null,
        current_guess = null,
        asker_confirm = null,
        target_confirm = null,
        pending_next_asker_id = null,
        last_error = null
    where lobby_id = v_ctx.lobby_id;
  end if;

  return public.cc_get_state(p_game_code, p_player_token);
end;
$$;
