-- Fruit Bowl runtime (v1)
-- - 4+ players minimum
-- - 2 teams
-- - 2 prompts per player
-- - 3 rounds (describe / act / one word)
-- - 45s turn timer
-- - active clue giver controls correct/skip

create or replace function public.start_game(p_game_code text, p_host_secret text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lobby public.game_lobbies%rowtype;
  v_player_count integer;
  v_min_players integer;
begin
  perform public.cleanup_lobby_presence(p_game_code);

  select *
  into v_lobby
  from public.game_lobbies
  where game_code = upper(trim(p_game_code))
    and host_secret = p_host_secret
    and status = 'lobby';

  if not found then
    raise exception 'Unable to start game.';
  end if;

  v_min_players := case
    when v_lobby.game_slug in ('fruit-bowl', 'fruit-bowel') then 4
    when v_lobby.game_slug in ('popular-people', 'celebrities') then 2
    when v_lobby.game_slug = 'secret-category' then 3
    else 3
  end;

  select count(*) into v_player_count
  from public.lobby_players
  where lobby_id = v_lobby.id;

  if v_player_count < v_min_players then
    raise exception 'At least % players are required to start.', v_min_players;
  end if;

  update public.game_lobbies
  set status = 'started', updated_at = now()
  where id = v_lobby.id;

  return true;
end;
$$;

grant execute on function public.start_game(text, text) to anon, authenticated;

create table if not exists public.fruit_bowl_games (
  lobby_id uuid primary key references public.game_lobbies(id) on delete cascade,
  phase text not null default 'rules' check (
    phase in ('rules', 'input', 'teams', 'round_intro', 'turn_live', 'turn_summary', 'round_results', 'result')
  ),
  waiting_on jsonb not null default '[]'::jsonb,
  round_number integer not null default 1 check (round_number between 1 and 3),
  active_team integer not null default 1 check (active_team in (1, 2)),
  active_cluegiver_id uuid references public.lobby_players(id) on delete set null,
  team_a_score integer not null default 0,
  team_b_score integer not null default 0,
  team_a_turn_index integer not null default 1,
  team_b_turn_index integer not null default 1,
  master_prompts jsonb not null default '[]'::jsonb,
  round_pile jsonb not null default '[]'::jsonb,
  current_prompt text,
  turn_ends_at timestamptz,
  turn_points_current integer not null default 0,
  last_turn_points integer not null default 0,
  last_turn_team integer check (last_turn_team in (1, 2)),
  summary_ends_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_fruit_bowl_games_updated_at on public.fruit_bowl_games;
create trigger set_fruit_bowl_games_updated_at
before update on public.fruit_bowl_games
for each row execute function public.set_updated_at();

create table if not exists public.fruit_bowl_entries (
  id uuid primary key default gen_random_uuid(),
  lobby_id uuid not null references public.game_lobbies(id) on delete cascade,
  player_id uuid not null references public.lobby_players(id) on delete cascade,
  slot integer not null check (slot between 1 and 2),
  prompt text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_fruit_bowl_entries_updated_at on public.fruit_bowl_entries;
create trigger set_fruit_bowl_entries_updated_at
before update on public.fruit_bowl_entries
for each row execute function public.set_updated_at();

create unique index if not exists fruit_bowl_entries_player_slot_uidx
  on public.fruit_bowl_entries(lobby_id, player_id, slot);

create table if not exists public.fruit_bowl_player_state (
  lobby_id uuid not null references public.game_lobbies(id) on delete cascade,
  player_id uuid not null references public.lobby_players(id) on delete cascade,
  team_no integer check (team_no in (1, 2)),
  team_order integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (lobby_id, player_id)
);

drop trigger if exists set_fruit_bowl_player_state_updated_at on public.fruit_bowl_player_state;
create trigger set_fruit_bowl_player_state_updated_at
before update on public.fruit_bowl_player_state
for each row execute function public.set_updated_at();

alter table public.fruit_bowl_games enable row level security;
alter table public.fruit_bowl_entries enable row level security;
alter table public.fruit_bowl_player_state enable row level security;
revoke all on table public.fruit_bowl_games from anon, authenticated;
revoke all on table public.fruit_bowl_entries from anon, authenticated;
revoke all on table public.fruit_bowl_player_state from anon, authenticated;

create or replace function public.fb_player_context(p_game_code text, p_player_token text)
returns table(
  lobby_id uuid,
  game_slug text,
  lobby_status text,
  player_id uuid,
  player_name text,
  is_host boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select * from public.sc_player_context(p_game_code, p_player_token);
end;
$$;

create or replace function public.fb_team_size(p_lobby_id uuid, p_team_no integer)
returns integer
language sql
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.fruit_bowl_player_state ps
  where ps.lobby_id = p_lobby_id
    and ps.team_no = p_team_no;
$$;

create or replace function public.fb_team_player_by_order(p_lobby_id uuid, p_team_no integer, p_order integer)
returns uuid
language sql
security definer
set search_path = public
as $$
  select ps.player_id
  from public.fruit_bowl_player_state ps
  where ps.lobby_id = p_lobby_id
    and ps.team_no = p_team_no
    and ps.team_order = p_order
  limit 1;
$$;

create or replace function public.fb_prepare_round(p_lobby_id uuid, p_round integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.fruit_bowl_games%rowtype;
  v_shuffled jsonb;
begin
  select * into v_game
  from public.fruit_bowl_games
  where lobby_id = p_lobby_id;

  if not found then
    return;
  end if;

  select coalesce(jsonb_agg(value order by random()), '[]'::jsonb)
  into v_shuffled
  from jsonb_array_elements(coalesce(v_game.master_prompts, '[]'::jsonb));

  update public.fruit_bowl_games
  set round_number = p_round,
      phase = 'round_intro',
      waiting_on = public.cc_active_player_ids(p_lobby_id),
      round_pile = coalesce(v_shuffled, '[]'::jsonb),
      current_prompt = coalesce(v_shuffled ->> 0, null),
      turn_ends_at = null,
      summary_ends_at = null,
      turn_points_current = 0,
      last_turn_points = 0,
      last_turn_team = null,
      last_error = null
  where lobby_id = p_lobby_id;
end;
$$;

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
begin
  select * into v_game
  from public.fruit_bowl_games
  where lobby_id = p_lobby_id;

  if not found or v_game.phase <> 'turn_live' then
    return;
  end if;

  v_pile_count := jsonb_array_length(coalesce(v_game.round_pile, '[]'::jsonb));

  if v_pile_count = 0 then
    if v_game.round_number >= 3 then
      update public.fruit_bowl_games
      set phase = 'result',
          waiting_on = '[]'::jsonb,
          turn_ends_at = null,
          summary_ends_at = null,
          current_prompt = null,
          turn_points_current = 0
      where lobby_id = p_lobby_id;
    else
      update public.fruit_bowl_games
      set phase = 'round_results',
          waiting_on = public.cc_active_player_ids(p_lobby_id),
          turn_ends_at = null,
          summary_ends_at = null,
          current_prompt = null,
          turn_points_current = 0
      where lobby_id = p_lobby_id;
    end if;
    return;
  end if;

  if v_game.active_team = 1 then
    v_team_size := public.fb_team_size(p_lobby_id, 1);
    if v_team_size > 0 then
      update public.fruit_bowl_games
      set team_a_turn_index = case when team_a_turn_index >= v_team_size then 1 else team_a_turn_index + 1 end
      where lobby_id = p_lobby_id;
    end if;
  else
    v_team_size := public.fb_team_size(p_lobby_id, 2);
    if v_team_size > 0 then
      update public.fruit_bowl_games
      set team_b_turn_index = case when team_b_turn_index >= v_team_size then 1 else team_b_turn_index + 1 end
      where lobby_id = p_lobby_id;
    end if;
  end if;

  select * into v_game
  from public.fruit_bowl_games
  where lobby_id = p_lobby_id;

  v_next_team := case when v_game.active_team = 1 then 2 else 1 end;
  v_next_idx := case when v_next_team = 1 then v_game.team_a_turn_index else v_game.team_b_turn_index end;
  v_next_cluegiver := public.fb_team_player_by_order(p_lobby_id, v_next_team, v_next_idx);

  update public.fruit_bowl_games
  set phase = 'turn_summary',
      active_team = v_next_team,
      active_cluegiver_id = v_next_cluegiver,
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

create or replace function public.fb_advance_after_summary(p_lobby_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.fruit_bowl_games%rowtype;
  v_pile_count integer;
begin
  select * into v_game
  from public.fruit_bowl_games
  where lobby_id = p_lobby_id;

  if not found or v_game.phase <> 'turn_summary' then
    return;
  end if;

  v_pile_count := jsonb_array_length(coalesce(v_game.round_pile, '[]'::jsonb));

  if v_pile_count = 0 then
    if v_game.round_number >= 3 then
      update public.fruit_bowl_games
      set phase = 'result',
          waiting_on = '[]'::jsonb,
          summary_ends_at = null,
          turn_ends_at = null,
          current_prompt = null
      where lobby_id = p_lobby_id;
    else
      update public.fruit_bowl_games
      set phase = 'round_results',
          waiting_on = public.cc_active_player_ids(p_lobby_id),
          summary_ends_at = null,
          turn_ends_at = null,
          current_prompt = null
      where lobby_id = p_lobby_id;
    end if;
    return;
  end if;

  update public.fruit_bowl_games
  set phase = 'turn_live',
      turn_ends_at = now() + interval '45 seconds',
      summary_ends_at = null,
      turn_points_current = 0,
      current_prompt = coalesce(round_pile ->> 0, null),
      last_error = null
  where lobby_id = p_lobby_id;
end;
$$;

create or replace function public.fb_get_state(p_game_code text, p_player_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.fruit_bowl_games%rowtype;
  v_players jsonb;
  v_team_a jsonb;
  v_team_b jsonb;
  v_you_team_no integer;
  v_you_team_order integer;
  v_waiting_input jsonb;
  v_submit_count integer;
begin
  perform public.cleanup_lobby_presence(p_game_code);

  select * into v_ctx from public.fb_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_game
  from public.fruit_bowl_games
  where lobby_id = v_ctx.lobby_id;

  if not found then
    raise exception 'Game runtime not initialized.';
  end if;

  if v_game.phase = 'turn_live'
     and v_game.turn_ends_at is not null
     and now() >= v_game.turn_ends_at then
    perform public.fb_finish_turn(v_ctx.lobby_id);
  end if;

  select * into v_game
  from public.fruit_bowl_games
  where lobby_id = v_ctx.lobby_id;

  if v_game.phase = 'turn_summary'
     and v_game.summary_ends_at is not null
     and now() >= v_game.summary_ends_at then
    perform public.fb_advance_after_summary(v_ctx.lobby_id);
  end if;

  select * into v_game
  from public.fruit_bowl_games
  where lobby_id = v_ctx.lobby_id;

  select ps.team_no, ps.team_order
  into v_you_team_no, v_you_team_order
  from public.fruit_bowl_player_state ps
  where ps.lobby_id = v_ctx.lobby_id
    and ps.player_id = v_ctx.player_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'name', p.display_name,
        'isHost', p.is_host,
        'teamNo', ps.team_no,
        'teamOrder', ps.team_order
      )
      order by p.created_at
    ),
    '[]'::jsonb
  )
  into v_players
  from public.lobby_players p
  left join public.fruit_bowl_player_state ps
    on ps.lobby_id = p.lobby_id
   and ps.player_id = p.id
  where p.lobby_id = v_ctx.lobby_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('id', p.id, 'name', p.display_name)
      order by ps.team_order
    ),
    '[]'::jsonb
  )
  into v_team_a
  from public.fruit_bowl_player_state ps
  join public.lobby_players p
    on p.lobby_id = ps.lobby_id
   and p.id = ps.player_id
  where ps.lobby_id = v_ctx.lobby_id
    and ps.team_no = 1;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('id', p.id, 'name', p.display_name)
      order by ps.team_order
    ),
    '[]'::jsonb
  )
  into v_team_b
  from public.fruit_bowl_player_state ps
  join public.lobby_players p
    on p.lobby_id = ps.lobby_id
   and p.id = ps.player_id
  where ps.lobby_id = v_ctx.lobby_id
    and ps.team_no = 2;

  select coalesce(jsonb_agg(to_jsonb(p.id) order by p.created_at), '[]'::jsonb)
  into v_waiting_input
  from public.lobby_players p
  left join (
    select e.player_id, count(*) as c
    from public.fruit_bowl_entries e
    where e.lobby_id = v_ctx.lobby_id
    group by e.player_id
  ) per_player on per_player.player_id = p.id
  where p.lobby_id = v_ctx.lobby_id
    and coalesce(per_player.c, 0) < 2;

  select count(*)
  into v_submit_count
  from public.fruit_bowl_entries e
  where e.lobby_id = v_ctx.lobby_id
    and e.player_id = v_ctx.player_id;

  return jsonb_build_object(
    'phase', v_game.phase,
    'roundNumber', v_game.round_number,
    'waitingOn', case when v_game.phase = 'input' then v_waiting_input else coalesce(v_game.waiting_on, '[]'::jsonb) end,
    'yourSubmitted', (v_submit_count >= 2),
    'teamAScore', v_game.team_a_score,
    'teamBScore', v_game.team_b_score,
    'activeTeam', v_game.active_team,
    'activeCluegiverId', v_game.active_cluegiver_id,
    'turnEndsAt', v_game.turn_ends_at,
    'currentPrompt', case
      when v_game.phase = 'turn_live' and v_game.active_cluegiver_id is distinct from v_ctx.player_id then null
      else v_game.current_prompt
    end,
    'promptsRemaining', jsonb_array_length(coalesce(v_game.round_pile, '[]'::jsonb)),
    'lastTurnPoints', v_game.last_turn_points,
    'lastTurnTeam', v_game.last_turn_team,
    'players', v_players,
    'teamA', v_team_a,
    'teamB', v_team_b,
    'you', jsonb_build_object(
      'id', v_ctx.player_id,
      'name', v_ctx.player_name,
      'isHost', v_ctx.is_host,
      'teamNo', v_you_team_no,
      'teamOrder', v_you_team_order
    ),
    'lastError', v_game.last_error
  );
end;
$$;

create or replace function public.fb_init_game(p_game_code text, p_player_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
begin
  perform public.cleanup_lobby_presence(p_game_code);

  select * into v_ctx from public.fb_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  if v_ctx.game_slug not in ('fruit-bowl', 'fruit-bowel') then
    raise exception 'Game mismatch.';
  end if;

  if v_ctx.lobby_status <> 'started' then
    raise exception 'Game has not started.';
  end if;

  insert into public.fruit_bowl_player_state (lobby_id, player_id, team_no, team_order)
  select p.lobby_id, p.id, null, null
  from public.lobby_players p
  where p.lobby_id = v_ctx.lobby_id
  on conflict (lobby_id, player_id) do nothing;

  insert into public.fruit_bowl_games (lobby_id, phase, waiting_on)
  values (v_ctx.lobby_id, 'rules', public.cc_active_player_ids(v_ctx.lobby_id))
  on conflict (lobby_id) do nothing;

  return public.fb_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.fb_remove_waiting(p_waiting jsonb, p_player_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(value) filter (where value <> to_jsonb(p_player_id::text)),
    '[]'::jsonb
  )
  from jsonb_array_elements(coalesce(p_waiting, '[]'::jsonb));
$$;

create or replace function public.fb_continue(p_game_code text, p_player_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.fruit_bowl_games%rowtype;
  v_waiting jsonb;
begin
  perform public.cleanup_lobby_presence(p_game_code);

  select * into v_ctx from public.fb_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_game
  from public.fruit_bowl_games
  where lobby_id = v_ctx.lobby_id;

  if not found then
    raise exception 'Game runtime not initialized.';
  end if;

  if v_game.phase in ('rules', 'teams', 'round_intro', 'round_results') then
    v_waiting := public.fb_remove_waiting(v_game.waiting_on, v_ctx.player_id);
    update public.fruit_bowl_games
    set waiting_on = v_waiting
    where lobby_id = v_ctx.lobby_id;

    if jsonb_array_length(v_waiting) = 0 then
      if v_game.phase = 'rules' then
        update public.fruit_bowl_games
        set phase = 'input',
            waiting_on = '[]'::jsonb,
            last_error = null
        where lobby_id = v_ctx.lobby_id;
      elsif v_game.phase = 'teams' then
        perform public.fb_prepare_round(v_ctx.lobby_id, 1);
      elsif v_game.phase = 'round_intro' then
        update public.fruit_bowl_games
        set phase = 'turn_live',
            waiting_on = '[]'::jsonb,
            turn_ends_at = now() + interval '45 seconds',
            summary_ends_at = null,
            turn_points_current = 0,
            current_prompt = coalesce(round_pile ->> 0, null),
            last_error = null
        where lobby_id = v_ctx.lobby_id;
      elsif v_game.phase = 'round_results' then
        if v_game.round_number >= 3 then
          update public.fruit_bowl_games
          set phase = 'result',
              waiting_on = '[]'::jsonb,
              last_error = null
          where lobby_id = v_ctx.lobby_id;
        else
          perform public.fb_prepare_round(v_ctx.lobby_id, v_game.round_number + 1);
        end if;
      end if;
    end if;
  end if;

  return public.fb_get_state(p_game_code, p_player_token);
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

    select public.fb_team_player_by_order(v_ctx.lobby_id, 1, 1)
    into v_first_cluegiver;

    update public.fruit_bowl_games
    set phase = 'teams',
        waiting_on = public.cc_active_player_ids(v_ctx.lobby_id),
        round_number = 1,
        active_team = 1,
        active_cluegiver_id = v_first_cluegiver,
        team_a_score = 0,
        team_b_score = 0,
        team_a_turn_index = 1,
        team_b_turn_index = 1,
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
    if v_game.round_number >= 3 then
      update public.fruit_bowl_games
      set phase = 'result',
          waiting_on = '[]'::jsonb,
          current_prompt = null,
          turn_ends_at = null,
          summary_ends_at = null
      where lobby_id = v_ctx.lobby_id;
    else
      update public.fruit_bowl_games
      set phase = 'round_results',
          waiting_on = public.cc_active_player_ids(v_ctx.lobby_id),
          current_prompt = null,
          turn_ends_at = null,
          summary_ends_at = null
      where lobby_id = v_ctx.lobby_id;
    end if;
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
    if v_game.round_number >= 3 then
      update public.fruit_bowl_games
      set phase = 'result',
          waiting_on = '[]'::jsonb,
          current_prompt = null,
          turn_ends_at = null,
          summary_ends_at = null
      where lobby_id = v_ctx.lobby_id;
    else
      update public.fruit_bowl_games
      set phase = 'round_results',
          waiting_on = public.cc_active_player_ids(v_ctx.lobby_id),
          current_prompt = null,
          turn_ends_at = null,
          summary_ends_at = null
      where lobby_id = v_ctx.lobby_id;
    end if;
  end if;

  return public.fb_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.fb_play_again(
  p_game_code text,
  p_player_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
begin
  perform public.cleanup_lobby_presence(p_game_code);

  select * into v_ctx from public.fb_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  if v_ctx.is_host is false then
    raise exception 'Only host can play again.';
  end if;

  delete from public.fruit_bowl_entries
  where lobby_id = v_ctx.lobby_id;

  update public.fruit_bowl_player_state
  set team_no = null,
      team_order = null
  where lobby_id = v_ctx.lobby_id;

  update public.fruit_bowl_games
  set phase = 'rules',
      waiting_on = public.cc_active_player_ids(v_ctx.lobby_id),
      round_number = 1,
      active_team = 1,
      active_cluegiver_id = null,
      team_a_score = 0,
      team_b_score = 0,
      team_a_turn_index = 1,
      team_b_turn_index = 1,
      master_prompts = '[]'::jsonb,
      round_pile = '[]'::jsonb,
      current_prompt = null,
      turn_ends_at = null,
      summary_ends_at = null,
      turn_points_current = 0,
      last_turn_points = 0,
      last_turn_team = null,
      last_error = null
  where lobby_id = v_ctx.lobby_id;

  return public.fb_get_state(p_game_code, p_player_token);
end;
$$;

grant execute on function public.fb_player_context(text, text) to anon, authenticated;
grant execute on function public.fb_team_size(uuid, integer) to anon, authenticated;
grant execute on function public.fb_team_player_by_order(uuid, integer, integer) to anon, authenticated;
grant execute on function public.fb_prepare_round(uuid, integer) to anon, authenticated;
grant execute on function public.fb_finish_turn(uuid) to anon, authenticated;
grant execute on function public.fb_advance_after_summary(uuid) to anon, authenticated;
grant execute on function public.fb_get_state(text, text) to anon, authenticated;
grant execute on function public.fb_init_game(text, text) to anon, authenticated;
grant execute on function public.fb_remove_waiting(jsonb, uuid) to anon, authenticated;
grant execute on function public.fb_continue(text, text) to anon, authenticated;
grant execute on function public.fb_submit_prompts(text, text, text, text) to anon, authenticated;
grant execute on function public.fb_mark_prompt(text, text, text) to anon, authenticated;
grant execute on function public.fb_play_again(text, text) to anon, authenticated;
