-- Draw WF timing + one-player guard + post-action name capture

create or replace function public.dwf_set_display_name(
  p_game_code text,
  p_player_token text,
  p_display_name text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_name text;
begin
  select * into v_ctx from public.dwf_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  v_name := left(regexp_replace(trim(coalesce(p_display_name, '')), '\s+', '', 'g'), 10);
  if v_name is null or char_length(v_name) = 0 then
    raise exception 'Name is required.';
  end if;

  if exists (
    select 1
    from public.lobby_players p
    where p.lobby_id = v_ctx.lobby_id
      and p.id <> v_ctx.player_id
      and lower(p.display_name) = lower(v_name)
  ) then
    raise exception 'That name is already used in this game.';
  end if;

  update public.lobby_players
  set display_name = v_name
  where id = v_ctx.player_id;

  return true;
end;
$$;

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

grant execute on function public.dwf_set_display_name(text, text, text) to anon, authenticated;
grant execute on function public.dwf_continue(text, text) to anon, authenticated;
