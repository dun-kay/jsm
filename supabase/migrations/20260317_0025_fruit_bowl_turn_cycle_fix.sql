-- Fruit Bowl turn-cycle fix:
-- - random first clue giver
-- - strict alternating team turns
-- - continuous rotation across rounds (no reset to same team/player)

create or replace function public.fb_finish_turn(p_lobby_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.fruit_bowl_games%rowtype;
  v_next_team integer;
  v_team_size integer;
  v_next_idx integer;
  v_next_cluegiver uuid;
  v_pile_count integer;
  v_new_a_idx integer;
  v_new_b_idx integer;
begin
  select * into v_game
  from public.fruit_bowl_games
  where lobby_id = p_lobby_id;

  if not found or v_game.phase <> 'turn_live' then
    return;
  end if;

  v_pile_count := jsonb_array_length(coalesce(v_game.round_pile, '[]'::jsonb));
  v_new_a_idx := v_game.team_a_turn_index;
  v_new_b_idx := v_game.team_b_turn_index;

  if v_game.active_team = 1 then
    v_team_size := public.fb_team_size(p_lobby_id, 1);
    if v_team_size > 0 then
      v_new_a_idx := case when v_game.team_a_turn_index >= v_team_size then 1 else v_game.team_a_turn_index + 1 end;
    end if;
  else
    v_team_size := public.fb_team_size(p_lobby_id, 2);
    if v_team_size > 0 then
      v_new_b_idx := case when v_game.team_b_turn_index >= v_team_size then 1 else v_game.team_b_turn_index + 1 end;
    end if;
  end if;

  v_next_team := case when v_game.active_team = 1 then 2 else 1 end;
  v_next_idx := case when v_next_team = 1 then v_new_a_idx else v_new_b_idx end;
  v_next_cluegiver := public.fb_team_player_by_order(p_lobby_id, v_next_team, v_next_idx);

  if v_next_cluegiver is null then
    v_next_cluegiver := public.fb_team_player_by_order(p_lobby_id, v_next_team, 1);
  end if;

  if v_pile_count = 0 then
    if v_game.round_number >= 3 then
      update public.fruit_bowl_games
      set phase = 'result',
          waiting_on = '[]'::jsonb,
          active_team = v_next_team,
          active_cluegiver_id = v_next_cluegiver,
          team_a_turn_index = v_new_a_idx,
          team_b_turn_index = v_new_b_idx,
          turn_ends_at = null,
          summary_ends_at = null,
          current_prompt = null,
          last_turn_points = v_game.turn_points_current,
          last_turn_team = v_game.active_team,
          turn_points_current = 0
      where lobby_id = p_lobby_id;
    else
      update public.fruit_bowl_games
      set phase = 'round_results',
          waiting_on = public.cc_active_player_ids(p_lobby_id),
          active_team = v_next_team,
          active_cluegiver_id = v_next_cluegiver,
          team_a_turn_index = v_new_a_idx,
          team_b_turn_index = v_new_b_idx,
          turn_ends_at = null,
          summary_ends_at = null,
          current_prompt = null,
          last_turn_points = v_game.turn_points_current,
          last_turn_team = v_game.active_team,
          turn_points_current = 0
      where lobby_id = p_lobby_id;
    end if;
    return;
  end if;

  update public.fruit_bowl_games
  set phase = 'turn_summary',
      active_team = v_next_team,
      active_cluegiver_id = v_next_cluegiver,
      team_a_turn_index = v_new_a_idx,
      team_b_turn_index = v_new_b_idx,
      last_turn_points = v_game.turn_points_current,
      last_turn_team = v_game.active_team,
      summary_ends_at = now() + interval '3 seconds',
      turn_ends_at = null,
      turn_points_current = 0,
      current_prompt = coalesce(v_game.round_pile ->> 0, null),
      last_error = null
  where lobby_id = p_lobby_id;
end;
$$;

create or replace function public.fb_submit_prompts(
  p_game_code text,
  p_player_token text,
  p_prompt_one text,
  p_prompt_two text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.fruit_bowl_games%rowtype;
  v_prompt_one text;
  v_prompt_two text;
  v_player_count integer;
  v_submitted_count integer;
  v_master jsonb;
  v_first_cluegiver uuid;
  v_first_team_no integer;
  v_first_team_order integer;
begin
  perform public.cleanup_lobby_presence(p_game_code);

  select * into v_ctx from public.fb_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_game
  from public.fruit_bowl_games
  where lobby_id = v_ctx.lobby_id;

  if not found or v_game.phase <> 'input' then
    raise exception 'Prompt entry is not active.';
  end if;

  v_prompt_one := left(trim(p_prompt_one), 50);
  v_prompt_two := left(trim(p_prompt_two), 50);

  if v_prompt_one = '' or v_prompt_two = '' then
    raise exception 'Enter 2 prompts.';
  end if;

  if lower(v_prompt_one) = lower(v_prompt_two) then
    raise exception 'Use 2 different prompts.';
  end if;

  insert into public.fruit_bowl_entries (lobby_id, player_id, slot, prompt)
  values (v_ctx.lobby_id, v_ctx.player_id, 1, v_prompt_one)
  on conflict (lobby_id, player_id, slot)
  do update set prompt = excluded.prompt, updated_at = now();

  insert into public.fruit_bowl_entries (lobby_id, player_id, slot, prompt)
  values (v_ctx.lobby_id, v_ctx.player_id, 2, v_prompt_two)
  on conflict (lobby_id, player_id, slot)
  do update set prompt = excluded.prompt, updated_at = now();

  select count(*) into v_player_count
  from public.lobby_players p
  where p.lobby_id = v_ctx.lobby_id;

  with per_player as (
    select e.player_id, count(*) as c
    from public.fruit_bowl_entries e
    where e.lobby_id = v_ctx.lobby_id
    group by e.player_id
  )
  select count(*) into v_submitted_count
  from per_player
  where c >= 2;

  if v_submitted_count = v_player_count then
    with shuffled as (
      select p.id as player_id, row_number() over (order by random()) as rn
      from public.lobby_players p
      where p.lobby_id = v_ctx.lobby_id
    ),
    assigned as (
      select
        player_id,
        case when (rn % 2) = 1 then 1 else 2 end as team_no,
        row_number() over (
          partition by case when (rn % 2) = 1 then 1 else 2 end
          order by rn
        ) as team_order
      from shuffled
    )
    update public.fruit_bowl_player_state ps
    set team_no = a.team_no,
        team_order = a.team_order
    from assigned a
    where ps.lobby_id = v_ctx.lobby_id
      and ps.player_id = a.player_id;

    select coalesce(jsonb_agg(to_jsonb(e.prompt) order by e.created_at), '[]'::jsonb)
    into v_master
    from public.fruit_bowl_entries e
    where e.lobby_id = v_ctx.lobby_id;

    select p.id
    into v_first_cluegiver
    from public.lobby_players p
    where p.lobby_id = v_ctx.lobby_id
    order by random()
    limit 1;

    select ps.team_no, ps.team_order
    into v_first_team_no, v_first_team_order
    from public.fruit_bowl_player_state ps
    where ps.lobby_id = v_ctx.lobby_id
      and ps.player_id = v_first_cluegiver;

    update public.fruit_bowl_games
    set phase = 'teams',
        waiting_on = public.cc_active_player_ids(v_ctx.lobby_id),
        round_number = 1,
        active_team = coalesce(v_first_team_no, 1),
        active_cluegiver_id = v_first_cluegiver,
        team_a_score = 0,
        team_b_score = 0,
        team_a_turn_index = case when coalesce(v_first_team_no, 1) = 1 then coalesce(v_first_team_order, 1) else 1 end,
        team_b_turn_index = case when coalesce(v_first_team_no, 1) = 2 then coalesce(v_first_team_order, 1) else 1 end,
        master_prompts = coalesce(v_master, '[]'::jsonb),
        round_pile = '[]'::jsonb,
        current_prompt = null,
        turn_ends_at = null,
        summary_ends_at = null,
        turn_points_current = 0,
        last_turn_points = 0,
        last_turn_team = null,
        last_error = null
    where lobby_id = v_ctx.lobby_id;
  end if;

  return public.fb_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.fb_mark_prompt(
  p_game_code text,
  p_player_token text,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.fruit_bowl_games%rowtype;
  v_pile jsonb;
  v_rest jsonb;
  v_first jsonb;
  v_action text;
begin
  perform public.cleanup_lobby_presence(p_game_code);

  select * into v_ctx from public.fb_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_game
  from public.fruit_bowl_games
  where lobby_id = v_ctx.lobby_id;

  if not found or v_game.phase <> 'turn_live' then
    raise exception 'Turn is not active.';
  end if;

  if v_game.active_cluegiver_id <> v_ctx.player_id then
    raise exception 'Only the active clue giver can control prompts.';
  end if;

  if v_game.turn_ends_at is not null and now() >= v_game.turn_ends_at then
    perform public.fb_finish_turn(v_ctx.lobby_id);
    return public.fb_get_state(p_game_code, p_player_token);
  end if;

  v_action := lower(trim(p_action));
  if v_action not in ('correct', 'skip') then
    raise exception 'Invalid action.';
  end if;

  v_pile := coalesce(v_game.round_pile, '[]'::jsonb);
  if jsonb_array_length(v_pile) = 0 then
    perform public.fb_finish_turn(v_ctx.lobby_id);
    return public.fb_get_state(p_game_code, p_player_token);
  end if;

  v_first := v_pile -> 0;

  if v_action = 'correct' then
    select coalesce(jsonb_agg(value order by ord), '[]'::jsonb)
    into v_pile
    from jsonb_array_elements(v_pile) with ordinality as e(value, ord)
    where ord > 1;

    update public.fruit_bowl_games
    set round_pile = v_pile,
        current_prompt = coalesce(v_pile ->> 0, null),
        turn_points_current = turn_points_current + 1,
        team_a_score = team_a_score + case when active_team = 1 then 1 else 0 end,
        team_b_score = team_b_score + case when active_team = 2 then 1 else 0 end,
        last_error = null
    where lobby_id = v_ctx.lobby_id;
  else
    if jsonb_array_length(v_pile) > 1 then
      select coalesce(jsonb_agg(value order by ord), '[]'::jsonb)
      into v_rest
      from jsonb_array_elements(v_pile) with ordinality as e(value, ord)
      where ord > 1;

      v_pile := v_rest || jsonb_build_array(v_first);
    end if;

    update public.fruit_bowl_games
    set round_pile = v_pile,
        current_prompt = coalesce(v_pile ->> 0, null),
        last_error = null
    where lobby_id = v_ctx.lobby_id;
  end if;

  select * into v_game
  from public.fruit_bowl_games
  where lobby_id = v_ctx.lobby_id;

  if jsonb_array_length(coalesce(v_game.round_pile, '[]'::jsonb)) = 0 then
    perform public.fb_finish_turn(v_ctx.lobby_id);
  end if;

  return public.fb_get_state(p_game_code, p_player_token);
end;
$$;

grant execute on function public.fb_finish_turn(uuid) to anon, authenticated;
grant execute on function public.fb_submit_prompts(text, text, text, text) to anon, authenticated;
grant execute on function public.fb_mark_prompt(text, text, text) to anon, authenticated;
