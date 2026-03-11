-- Harden vote cycle when no majority: avoid cast errors and cleanly reset votes.

create or replace function public.sc_submit_vote(p_game_code text, p_player_token text, p_target_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_state public.secret_category_games%rowtype;
  v_waiting jsonb;
  v_votes jsonb;
  v_total integer;
  v_top_target_id uuid;
  v_top_count integer;
begin
  perform public.cleanup_lobby_presence(p_game_code);

  select * into v_ctx from public.sc_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_state from public.secret_category_games where lobby_id = v_ctx.lobby_id;
  if not found or v_state.phase <> 'vote' then
    raise exception 'Voting is not active.';
  end if;

  if not exists (
    select 1
    from public.lobby_players p
    where p.lobby_id = v_ctx.lobby_id
      and p.id = p_target_player_id
  ) then
    raise exception 'Invalid vote target.';
  end if;

  v_votes := coalesce(v_state.votes, '{}'::jsonb) || jsonb_build_object(v_ctx.player_id::text, p_target_player_id::text);
  v_waiting := public.sc_remove_waiting(v_state.waiting_on, v_ctx.player_id);

  update public.secret_category_games
  set votes = v_votes,
      waiting_on = v_waiting
  where lobby_id = v_ctx.lobby_id;

  if jsonb_array_length(v_waiting) > 0 then
    return public.sc_get_state(p_game_code, p_player_token);
  end if;

  select count(*) into v_total
  from public.lobby_players p
  where p.lobby_id = v_ctx.lobby_id;

  select (value)::uuid, count(*)
  into v_top_target_id, v_top_count
  from jsonb_each_text(v_votes)
  where value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  group by value
  order by count(*) desc
  limit 1;

  if v_top_count is not null and v_top_count > (v_total / 2) then
    if v_top_target_id = v_state.spy_player_id then
      update public.secret_category_games
      set phase = 'spy_guess',
          round_result = 'spy_found',
          waiting_on = jsonb_build_array(v_state.spy_player_id::text)
      where lobby_id = v_ctx.lobby_id;
    else
      update public.secret_category_games
      set phase = 'result',
          round_result = 'spy_not_found',
          waiting_on = public.sc_active_player_ids(v_ctx.lobby_id)
      where lobby_id = v_ctx.lobby_id;
    end if;
  else
    update public.secret_category_games
    set votes = '{}'::jsonb,
        vote_attempt = v_state.vote_attempt + 1,
        waiting_on = public.sc_active_player_ids(v_ctx.lobby_id)
    where lobby_id = v_ctx.lobby_id;
  end if;

  return public.sc_get_state(p_game_code, p_player_token);
end;
$$;

