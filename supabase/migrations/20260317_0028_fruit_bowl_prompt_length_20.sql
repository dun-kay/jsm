-- Fruit Bowl: cap prompts at 20 characters server-side.

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

  v_prompt_one := left(trim(p_prompt_one), 20);
  v_prompt_two := left(trim(p_prompt_two), 20);

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

grant execute on function public.fb_submit_prompts(text, text, text, text) to anon, authenticated;
