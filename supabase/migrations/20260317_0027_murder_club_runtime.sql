-- Murder Club runtime (v1.1 large-group tuned)
-- - 4 to 18 players
-- - hidden killer roles per round
-- - structured discussion timers
-- - public team votes, secret mission votes
-- - auto-advance timers
-- - first to 3 points wins

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
    when v_lobby.game_slug in ('murder-club', 'murder-clubs') then 4
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

create table if not exists public.murder_club_games (
  lobby_id uuid primary key references public.game_lobbies(id) on delete cascade,
  phase text not null default 'rules' check (
    phase in ('rules', 'team_pick', 'discussion_phase', 'team_vote', 'mission_vote', 'round_result', 'result')
  ),
  waiting_on jsonb not null default '[]'::jsonb,
  round_number integer not null default 1,
  target_score integer not null default 3,
  innocent_score integer not null default 0,
  killer_score integer not null default 0,
  reject_streak integer not null default 0,
  leader_order_index integer not null default 1,
  current_leader_id uuid references public.lobby_players(id) on delete set null,
  team_size_required integer not null default 2,
  mission_fail_threshold integer not null default 1,
  selected_team jsonb not null default '[]'::jsonb,
  round_roles jsonb not null default '{}'::jsonb,
  team_votes jsonb not null default '{}'::jsonb,
  mission_votes jsonb not null default '{}'::jsonb,
  discussion_leader_ends_at timestamptz,
  discussion_ends_at timestamptz,
  team_vote_ends_at timestamptz,
  mission_vote_ends_at timestamptz,
  result_ends_at timestamptz,
  last_murder_count integer not null default 0,
  last_team_approved boolean,
  last_line text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_murder_club_games_updated_at on public.murder_club_games;
create trigger set_murder_club_games_updated_at
before update on public.murder_club_games
for each row execute function public.set_updated_at();

create table if not exists public.murder_club_player_state (
  lobby_id uuid not null references public.game_lobbies(id) on delete cascade,
  player_id uuid not null references public.lobby_players(id) on delete cascade,
  turn_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (lobby_id, player_id)
);

drop trigger if exists set_murder_club_player_state_updated_at on public.murder_club_player_state;
create trigger set_murder_club_player_state_updated_at
before update on public.murder_club_player_state
for each row execute function public.set_updated_at();

create unique index if not exists murder_club_player_state_order_uidx
  on public.murder_club_player_state(lobby_id, turn_order);

alter table public.murder_club_games enable row level security;
alter table public.murder_club_player_state enable row level security;
revoke all on table public.murder_club_games from anon, authenticated;
revoke all on table public.murder_club_player_state from anon, authenticated;

create or replace function public.mc_player_context(p_game_code text, p_player_token text)
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

create or replace function public.mc_team_size_for_count(p_player_count integer)
returns integer
language sql
immutable
as $$
  select case
    when p_player_count between 4 and 5 then 2
    when p_player_count between 6 and 8 then 3
    when p_player_count between 9 and 12 then 4
    else 5
  end;
$$;

create or replace function public.mc_killer_count_for_players(p_player_count integer)
returns integer
language sql
immutable
as $$
  select case
    when p_player_count between 4 and 5 then 1
    when p_player_count between 6 and 8 then 2
    when p_player_count between 9 and 12 then 3
    else 4
  end;
$$;

create or replace function public.mc_discussion_total_seconds(p_player_count integer)
returns integer
language sql
immutable
as $$
  select case when p_player_count >= 9 then 35 else 25 end;
$$;

create or replace function public.mc_discussion_leader_seconds(p_player_count integer)
returns integer
language sql
immutable
as $$
  select case when p_player_count >= 9 then 7 else 5 end;
$$;

create or replace function public.mc_team_order_count(p_lobby_id uuid)
returns integer
language sql
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.murder_club_player_state ps
  where ps.lobby_id = p_lobby_id;
$$;

create or replace function public.mc_player_by_turn_order(p_lobby_id uuid, p_order integer)
returns uuid
language sql
security definer
set search_path = public
as $$
  select ps.player_id
  from public.murder_club_player_state ps
  where ps.lobby_id = p_lobby_id
    and ps.turn_order = p_order
  limit 1;
$$;

create or replace function public.mc_assign_round_roles(p_lobby_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_count integer;
  v_killer_count integer;
  v_roles jsonb := '{}'::jsonb;
  v_row record;
begin
  select count(*) into v_player_count
  from public.lobby_players p
  where p.lobby_id = p_lobby_id;

  v_killer_count := public.mc_killer_count_for_players(v_player_count);

  for v_row in
    select p.id
    from public.lobby_players p
    where p.lobby_id = p_lobby_id
    order by random()
  loop
    if v_killer_count > 0 then
      v_roles := jsonb_set(v_roles, array[v_row.id::text], '"killer"'::jsonb, true);
      v_killer_count := v_killer_count - 1;
    else
      v_roles := jsonb_set(v_roles, array[v_row.id::text], '"innocent"'::jsonb, true);
    end if;
  end loop;

  return v_roles;
end;
$$;

create or replace function public.mc_maybe_finalize_team_vote(p_lobby_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.murder_club_games%rowtype;
  v_player_count integer;
  v_yes integer := 0;
  v_no integer := 0;
  v_vote record;
  v_approved boolean;
  v_order_count integer;
  v_next_order integer;
  v_next_leader uuid;
begin
  select * into v_game
  from public.murder_club_games
  where lobby_id = p_lobby_id;

  if not found or v_game.phase <> 'team_vote' then
    return;
  end if;

  select count(*) into v_player_count
  from public.lobby_players p
  where p.lobby_id = p_lobby_id;

  for v_vote in
    select value
    from jsonb_each_text(coalesce(v_game.team_votes, '{}'::jsonb))
  loop
    if lower(v_vote.value) = 'approve' then
      v_yes := v_yes + 1;
    else
      v_no := v_no + 1;
    end if;
  end loop;

  if v_yes + v_no < v_player_count then
    if v_game.team_vote_ends_at is not null and now() < v_game.team_vote_ends_at then
      return;
    end if;
    v_no := v_no + (v_player_count - (v_yes + v_no));
  end if;

  v_approved := v_yes > v_no;
  if not v_approved and v_game.reject_streak >= 2 then
    v_approved := true;
  end if;

  if v_approved then
    update public.murder_club_games
    set phase = 'mission_vote',
        mission_vote_ends_at = now() + interval '5 seconds',
        mission_votes = '{}'::jsonb,
        last_team_approved = true,
        reject_streak = 0,
        last_error = null
    where lobby_id = p_lobby_id;
    return;
  end if;

  v_order_count := public.mc_team_order_count(p_lobby_id);
  if v_order_count <= 0 then
    v_order_count := 1;
  end if;
  v_next_order := case when v_game.leader_order_index >= v_order_count then 1 else v_game.leader_order_index + 1 end;
  v_next_leader := public.mc_player_by_turn_order(p_lobby_id, v_next_order);

  update public.murder_club_games
  set phase = 'team_pick',
      reject_streak = reject_streak + 1,
      leader_order_index = v_next_order,
      current_leader_id = v_next_leader,
      selected_team = '[]'::jsonb,
      team_votes = '{}'::jsonb,
      mission_votes = '{}'::jsonb,
      discussion_leader_ends_at = null,
      discussion_ends_at = null,
      team_vote_ends_at = null,
      mission_vote_ends_at = null,
      result_ends_at = null,
      last_team_approved = false,
      last_line = null,
      last_error = null
  where lobby_id = p_lobby_id;
end;
$$;

create or replace function public.mc_maybe_finalize_mission(p_lobby_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.murder_club_games%rowtype;
  v_selected_count integer;
  v_submitted integer := 0;
  v_murders integer := 0;
  v_vote record;
  v_fail boolean;
begin
  select * into v_game
  from public.murder_club_games
  where lobby_id = p_lobby_id;

  if not found or v_game.phase <> 'mission_vote' then
    return;
  end if;

  select jsonb_array_length(coalesce(v_game.selected_team, '[]'::jsonb))
  into v_selected_count;

  for v_vote in
    select value
    from jsonb_each_text(coalesce(v_game.mission_votes, '{}'::jsonb))
  loop
    v_submitted := v_submitted + 1;
    if lower(v_vote.value) = 'murder' then
      v_murders := v_murders + 1;
    end if;
  end loop;

  if v_submitted < v_selected_count then
    if v_game.mission_vote_ends_at is not null and now() < v_game.mission_vote_ends_at then
      return;
    end if;
  end if;

  v_fail := v_murders >= v_game.mission_fail_threshold;

  update public.murder_club_games
  set phase = 'round_result',
      innocent_score = innocent_score + case when v_fail then 0 else 1 end,
      killer_score = killer_score + case when v_fail then 1 else 0 end,
      last_murder_count = v_murders,
      result_ends_at = now() + interval '4 seconds',
      last_line = case
        when v_fail then 'The tide pulls something back to shore... not everyone made it.'
        else 'For now, the town sleeps peacefully.'
      end,
      team_votes = '{}'::jsonb,
      mission_votes = '{}'::jsonb,
      discussion_leader_ends_at = null,
      discussion_ends_at = null,
      team_vote_ends_at = null,
      mission_vote_ends_at = null,
      last_error = null
  where lobby_id = p_lobby_id;
end;
$$;

create or replace function public.mc_advance_from_round_result(p_lobby_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.murder_club_games%rowtype;
  v_player_count integer;
  v_order_count integer;
  v_next_order integer;
  v_next_leader uuid;
begin
  select * into v_game
  from public.murder_club_games
  where lobby_id = p_lobby_id;

  if not found or v_game.phase <> 'round_result' then
    return;
  end if;

  if v_game.result_ends_at is not null and now() < v_game.result_ends_at then
    return;
  end if;

  if v_game.innocent_score >= v_game.target_score or v_game.killer_score >= v_game.target_score then
    update public.murder_club_games
    set phase = 'result',
        result_ends_at = null
    where lobby_id = p_lobby_id;
    return;
  end if;

  select count(*) into v_player_count
  from public.lobby_players p
  where p.lobby_id = p_lobby_id;

  v_order_count := public.mc_team_order_count(p_lobby_id);
  if v_order_count <= 0 then
    v_order_count := 1;
  end if;
  v_next_order := case when v_game.leader_order_index >= v_order_count then 1 else v_game.leader_order_index + 1 end;
  v_next_leader := public.mc_player_by_turn_order(p_lobby_id, v_next_order);

  update public.murder_club_games
  set phase = 'team_pick',
      round_number = round_number + 1,
      reject_streak = 0,
      leader_order_index = v_next_order,
      current_leader_id = v_next_leader,
      team_size_required = public.mc_team_size_for_count(v_player_count),
      mission_fail_threshold = case when v_player_count >= 9 then 2 else 1 end,
      selected_team = '[]'::jsonb,
      round_roles = public.mc_assign_round_roles(p_lobby_id),
      last_murder_count = 0,
      last_team_approved = null,
      result_ends_at = null,
      last_line = null,
      last_error = null
  where lobby_id = p_lobby_id;
end;
$$;

create or replace function public.mc_tick(p_lobby_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.murder_club_games%rowtype;
begin
  select * into v_game
  from public.murder_club_games
  where lobby_id = p_lobby_id;

  if not found then
    return;
  end if;

  if v_game.phase = 'discussion_phase' and v_game.discussion_ends_at is not null and now() >= v_game.discussion_ends_at then
    update public.murder_club_games
    set phase = 'team_vote',
        team_vote_ends_at = now() + interval '5 seconds',
        team_votes = '{}'::jsonb,
        discussion_leader_ends_at = null,
        discussion_ends_at = null,
        last_error = null
    where lobby_id = p_lobby_id;
  elsif v_game.phase = 'team_vote' then
    perform public.mc_maybe_finalize_team_vote(p_lobby_id);
  elsif v_game.phase = 'mission_vote' then
    perform public.mc_maybe_finalize_mission(p_lobby_id);
  elsif v_game.phase = 'round_result' then
    perform public.mc_advance_from_round_result(p_lobby_id);
  end if;
end;
$$;

create or replace function public.mc_init_game(p_game_code text, p_player_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_player_count integer;
  v_first_leader uuid;
  v_roles jsonb;
begin
  perform public.cleanup_lobby_presence(p_game_code);

  select * into v_ctx from public.mc_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  if v_ctx.game_slug <> 'murder-club' then
    raise exception 'Game mismatch.';
  end if;

  if v_ctx.lobby_status <> 'started' then
    raise exception 'Game has not started.';
  end if;

  insert into public.murder_club_player_state (lobby_id, player_id, turn_order)
  select p.lobby_id, p.id, row_number() over (order by p.created_at)
  from public.lobby_players p
  where p.lobby_id = v_ctx.lobby_id
  on conflict (lobby_id, player_id) do nothing;

  select count(*) into v_player_count
  from public.lobby_players p
  where p.lobby_id = v_ctx.lobby_id;

  select player_id into v_first_leader
  from public.murder_club_player_state ps
  where ps.lobby_id = v_ctx.lobby_id
  order by random()
  limit 1;

  v_roles := public.mc_assign_round_roles(v_ctx.lobby_id);

  insert into public.murder_club_games (
    lobby_id,
    phase,
    waiting_on,
    round_number,
    target_score,
    innocent_score,
    killer_score,
    reject_streak,
    leader_order_index,
    current_leader_id,
    team_size_required,
    mission_fail_threshold,
    selected_team,
    round_roles
  )
  values (
    v_ctx.lobby_id,
    'rules',
    public.cc_active_player_ids(v_ctx.lobby_id),
    1,
    3,
    0,
    0,
    0,
    coalesce((select turn_order from public.murder_club_player_state where lobby_id = v_ctx.lobby_id and player_id = v_first_leader limit 1), 1),
    v_first_leader,
    public.mc_team_size_for_count(v_player_count),
    case when v_player_count >= 9 then 2 else 1 end,
    '[]'::jsonb,
    v_roles
  )
  on conflict (lobby_id) do nothing;

  return public.mc_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.mc_get_state(p_game_code text, p_player_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.murder_club_games%rowtype;
  v_players jsonb;
  v_selected_ids text[];
  v_team_votes jsonb;
  v_am_selected boolean;
  v_my_role text;
begin
  perform public.cleanup_lobby_presence(p_game_code);

  select * into v_ctx from public.mc_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_game
  from public.murder_club_games
  where lobby_id = v_ctx.lobby_id;

  if not found then
    raise exception 'Game runtime not initialized.';
  end if;

  perform public.mc_tick(v_ctx.lobby_id);

  select * into v_game
  from public.murder_club_games
  where lobby_id = v_ctx.lobby_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'name', p.display_name,
        'isHost', p.is_host,
        'turnOrder', ps.turn_order
      )
      order by ps.turn_order
    ),
    '[]'::jsonb
  )
  into v_players
  from public.lobby_players p
  join public.murder_club_player_state ps
    on ps.lobby_id = p.lobby_id
   and ps.player_id = p.id
  where p.lobby_id = v_ctx.lobby_id;

  select array_agg(value::text)
  into v_selected_ids
  from jsonb_array_elements_text(coalesce(v_game.selected_team, '[]'::jsonb));

  v_am_selected := v_selected_ids is not null and v_ctx.player_id::text = any(v_selected_ids);
  v_my_role := coalesce(v_game.round_roles ->> v_ctx.player_id::text, 'innocent');

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'playerId', p.id,
        'name', p.display_name,
        'vote', case
          when v_game.team_votes ? p.id::text then v_game.team_votes ->> p.id::text
          else null
        end
      )
      order by ps.turn_order
    ),
    '[]'::jsonb
  )
  into v_team_votes
  from public.lobby_players p
  join public.murder_club_player_state ps
    on ps.lobby_id = p.lobby_id
   and ps.player_id = p.id
  where p.lobby_id = v_ctx.lobby_id;

  return jsonb_build_object(
    'phase', v_game.phase,
    'roundNumber', v_game.round_number,
    'targetScore', v_game.target_score,
    'innocentScore', v_game.innocent_score,
    'killerScore', v_game.killer_score,
    'rejectStreak', v_game.reject_streak,
    'leaderId', v_game.current_leader_id,
    'teamSizeRequired', v_game.team_size_required,
    'missionFailThreshold', v_game.mission_fail_threshold,
    'selectedTeam', coalesce(v_game.selected_team, '[]'::jsonb),
    'players', v_players,
    'teamVotes', v_team_votes,
    'discussionLeaderEndsAt', v_game.discussion_leader_ends_at,
    'discussionEndsAt', v_game.discussion_ends_at,
    'teamVoteEndsAt', v_game.team_vote_ends_at,
    'missionVoteEndsAt', v_game.mission_vote_ends_at,
    'resultEndsAt', v_game.result_ends_at,
    'lastMurderCount', v_game.last_murder_count,
    'lastTeamApproved', v_game.last_team_approved,
    'lastLine', v_game.last_line,
    'you', jsonb_build_object(
      'id', v_ctx.player_id,
      'name', v_ctx.player_name,
      'isHost', v_ctx.is_host,
      'isLeader', v_ctx.player_id = v_game.current_leader_id,
      'isSelected', v_am_selected,
      'role', v_my_role,
      'canUseMurder', (v_am_selected and v_my_role = 'killer')
    ),
    'waitingOn', coalesce(v_game.waiting_on, '[]'::jsonb),
    'lastError', v_game.last_error
  );
end;
$$;

create or replace function public.mc_remove_waiting(p_waiting jsonb, p_player_id uuid)
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

create or replace function public.mc_continue(p_game_code text, p_player_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.murder_club_games%rowtype;
  v_waiting jsonb;
begin
  perform public.cleanup_lobby_presence(p_game_code);

  select * into v_ctx from public.mc_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_game
  from public.murder_club_games
  where lobby_id = v_ctx.lobby_id;

  if not found then
    raise exception 'Game runtime not initialized.';
  end if;

  if v_game.phase = 'rules' then
    v_waiting := public.mc_remove_waiting(v_game.waiting_on, v_ctx.player_id);
    update public.murder_club_games
    set waiting_on = v_waiting
    where lobby_id = v_ctx.lobby_id;

    if jsonb_array_length(v_waiting) = 0 then
      update public.murder_club_games
      set phase = 'team_pick',
          waiting_on = '[]'::jsonb,
          last_error = null
      where lobby_id = v_ctx.lobby_id;
    end if;
  end if;

  return public.mc_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.mc_set_team(
  p_game_code text,
  p_player_token text,
  p_selected_team jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.murder_club_games%rowtype;
  v_player_count integer;
  v_total_discussion integer;
  v_leader_discussion integer;
  v_selected_count integer;
begin
  perform public.cleanup_lobby_presence(p_game_code);

  select * into v_ctx from public.mc_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_game
  from public.murder_club_games
  where lobby_id = v_ctx.lobby_id;

  if not found or v_game.phase <> 'team_pick' then
    raise exception 'Team selection is not active.';
  end if;

  if v_ctx.player_id <> v_game.current_leader_id then
    raise exception 'Only the current leader can pick the team.';
  end if;

  select jsonb_array_length(coalesce(p_selected_team, '[]'::jsonb))
  into v_selected_count;

  if v_selected_count <> v_game.team_size_required then
    raise exception 'Select exactly % players.', v_game.team_size_required;
  end if;

  select count(*) into v_player_count
  from public.lobby_players p
  where p.lobby_id = v_ctx.lobby_id;

  select public.mc_discussion_total_seconds(v_player_count),
         public.mc_discussion_leader_seconds(v_player_count)
  into v_total_discussion, v_leader_discussion;

  update public.murder_club_games
  set phase = 'discussion_phase',
      selected_team = p_selected_team,
      team_votes = '{}'::jsonb,
      mission_votes = '{}'::jsonb,
      discussion_leader_ends_at = now() + make_interval(secs => v_leader_discussion),
      discussion_ends_at = now() + make_interval(secs => v_total_discussion),
      team_vote_ends_at = null,
      mission_vote_ends_at = null,
      result_ends_at = null,
      last_error = null
  where lobby_id = v_ctx.lobby_id;

  return public.mc_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.mc_cast_team_vote(
  p_game_code text,
  p_player_token text,
  p_vote text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.murder_club_games%rowtype;
  v_vote text;
begin
  perform public.cleanup_lobby_presence(p_game_code);

  select * into v_ctx from public.mc_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_game
  from public.murder_club_games
  where lobby_id = v_ctx.lobby_id;

  if not found or v_game.phase <> 'team_vote' then
    raise exception 'Team vote is not active.';
  end if;

  v_vote := lower(trim(p_vote));
  if v_vote not in ('approve', 'reject') then
    raise exception 'Invalid vote.';
  end if;

  update public.murder_club_games
  set team_votes = jsonb_set(coalesce(team_votes, '{}'::jsonb), array[v_ctx.player_id::text], to_jsonb(v_vote), true),
      last_error = null
  where lobby_id = v_ctx.lobby_id;

  perform public.mc_maybe_finalize_team_vote(v_ctx.lobby_id);
  return public.mc_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.mc_cast_mission_vote(
  p_game_code text,
  p_player_token text,
  p_vote text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.murder_club_games%rowtype;
  v_vote text;
  v_my_role text;
begin
  perform public.cleanup_lobby_presence(p_game_code);

  select * into v_ctx from public.mc_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_game
  from public.murder_club_games
  where lobby_id = v_ctx.lobby_id;

  if not found or v_game.phase <> 'mission_vote' then
    raise exception 'Mission vote is not active.';
  end if;

  if not exists (
    select 1
    from jsonb_array_elements_text(coalesce(v_game.selected_team, '[]'::jsonb)) as s(value)
    where s.value = v_ctx.player_id::text
  ) then
    raise exception 'Only selected team members can vote on the mission.';
  end if;

  v_vote := lower(trim(p_vote));
  if v_vote not in ('safe', 'murder') then
    raise exception 'Invalid vote.';
  end if;

  v_my_role := coalesce(v_game.round_roles ->> v_ctx.player_id::text, 'innocent');
  if v_vote = 'murder' and v_my_role <> 'killer' then
    raise exception 'Only killers can cast murder votes.';
  end if;

  update public.murder_club_games
  set mission_votes = jsonb_set(coalesce(mission_votes, '{}'::jsonb), array[v_ctx.player_id::text], to_jsonb(v_vote), true),
      last_error = null
  where lobby_id = v_ctx.lobby_id;

  perform public.mc_maybe_finalize_mission(v_ctx.lobby_id);
  return public.mc_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.mc_play_again(
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
  v_player_count integer;
  v_first_leader uuid;
begin
  perform public.cleanup_lobby_presence(p_game_code);

  select * into v_ctx from public.mc_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  if v_ctx.is_host is false then
    raise exception 'Only host can play again.';
  end if;

  select count(*) into v_player_count
  from public.lobby_players p
  where p.lobby_id = v_ctx.lobby_id;

  select ps.player_id
  into v_first_leader
  from public.murder_club_player_state ps
  where ps.lobby_id = v_ctx.lobby_id
  order by random()
  limit 1;

  update public.murder_club_games
  set phase = 'rules',
      waiting_on = public.cc_active_player_ids(v_ctx.lobby_id),
      round_number = 1,
      innocent_score = 0,
      killer_score = 0,
      reject_streak = 0,
      leader_order_index = coalesce((select turn_order from public.murder_club_player_state where lobby_id = v_ctx.lobby_id and player_id = v_first_leader limit 1), 1),
      current_leader_id = v_first_leader,
      team_size_required = public.mc_team_size_for_count(v_player_count),
      mission_fail_threshold = case when v_player_count >= 9 then 2 else 1 end,
      selected_team = '[]'::jsonb,
      round_roles = public.mc_assign_round_roles(v_ctx.lobby_id),
      team_votes = '{}'::jsonb,
      mission_votes = '{}'::jsonb,
      discussion_leader_ends_at = null,
      discussion_ends_at = null,
      team_vote_ends_at = null,
      mission_vote_ends_at = null,
      result_ends_at = null,
      last_murder_count = 0,
      last_team_approved = null,
      last_line = null,
      last_error = null
  where lobby_id = v_ctx.lobby_id;

  return public.mc_get_state(p_game_code, p_player_token);
end;
$$;

grant execute on function public.mc_player_context(text, text) to anon, authenticated;
grant execute on function public.mc_team_size_for_count(integer) to anon, authenticated;
grant execute on function public.mc_killer_count_for_players(integer) to anon, authenticated;
grant execute on function public.mc_discussion_total_seconds(integer) to anon, authenticated;
grant execute on function public.mc_discussion_leader_seconds(integer) to anon, authenticated;
grant execute on function public.mc_team_order_count(uuid) to anon, authenticated;
grant execute on function public.mc_player_by_turn_order(uuid, integer) to anon, authenticated;
grant execute on function public.mc_assign_round_roles(uuid) to anon, authenticated;
grant execute on function public.mc_maybe_finalize_team_vote(uuid) to anon, authenticated;
grant execute on function public.mc_maybe_finalize_mission(uuid) to anon, authenticated;
grant execute on function public.mc_advance_from_round_result(uuid) to anon, authenticated;
grant execute on function public.mc_tick(uuid) to anon, authenticated;
grant execute on function public.mc_init_game(text, text) to anon, authenticated;
grant execute on function public.mc_get_state(text, text) to anon, authenticated;
grant execute on function public.mc_remove_waiting(jsonb, uuid) to anon, authenticated;
grant execute on function public.mc_continue(text, text) to anon, authenticated;
grant execute on function public.mc_set_team(text, text, jsonb) to anon, authenticated;
grant execute on function public.mc_cast_team_vote(text, text, text) to anon, authenticated;
grant execute on function public.mc_cast_mission_vote(text, text, text) to anon, authenticated;
grant execute on function public.mc_play_again(text, text) to anon, authenticated;
