-- Popular People: auto-advance from reveal when timer ends.
-- This removes dependency on manual Continue taps for both reveal rounds.

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

  if v_game.phase = 'reveal'
     and v_game.reveal_ends_at is not null
     and now() >= v_game.reveal_ends_at then
    update public.celebrities_games
    set phase = 'guess_pick',
        waiting_on = '[]'::jsonb,
        current_target_id = null,
        current_guess = null,
        asker_confirm = null,
        target_confirm = null,
        current_asker_id = coalesce(pending_next_asker_id, current_asker_id),
        pending_next_asker_id = null,
        last_error = null
    where lobby_id = v_ctx.lobby_id;

    select * into v_game
    from public.celebrities_games
    where lobby_id = v_ctx.lobby_id;
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
    and coalesce(per_player.c, 0) < 1;

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
    'yourSubmitted', (v_my_submit_count >= 1),
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

grant execute on function public.cc_get_state(text, text) to anon, authenticated;
