-- Celebrities runtime tables + RPCs.
-- Includes per-game min-player check in start_game.

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
    when v_lobby.game_slug = 'celebrities' then 2
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

create table if not exists public.celebrities_games (
  lobby_id uuid primary key references public.game_lobbies(id) on delete cascade,
  phase text not null default 'rules' check (phase in ('rules', 'input', 'reveal', 'guess_pick', 'guess_input', 'guess_confirm', 'result')),
  waiting_on jsonb not null default '[]'::jsonb,
  reveal_round integer not null default 0,
  reveal_ends_at timestamptz,
  first_turn_done boolean not null default false,
  current_asker_id uuid references public.lobby_players(id) on delete set null,
  current_target_id uuid references public.lobby_players(id) on delete set null,
  current_guess text,
  asker_confirm boolean,
  target_confirm boolean,
  pending_next_asker_id uuid references public.lobby_players(id) on delete set null,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_celebrities_games_updated_at on public.celebrities_games;
create trigger set_celebrities_games_updated_at
before update on public.celebrities_games
for each row execute function public.set_updated_at();

create table if not exists public.celebrities_entries (
  id uuid primary key default gen_random_uuid(),
  lobby_id uuid not null references public.game_lobbies(id) on delete cascade,
  player_id uuid references public.lobby_players(id) on delete cascade,
  slot integer,
  celeb_name text not null,
  is_bot boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint celebrities_entries_slot_chk check (slot is null or slot between 1 and 2)
);

drop trigger if exists set_celebrities_entries_updated_at on public.celebrities_entries;
create trigger set_celebrities_entries_updated_at
before update on public.celebrities_entries
for each row execute function public.set_updated_at();

create unique index if not exists celebrities_entries_player_slot_uidx
  on public.celebrities_entries(lobby_id, player_id, slot)
  where is_bot = false;

create table if not exists public.celebrities_player_state (
  lobby_id uuid not null references public.game_lobbies(id) on delete cascade,
  player_id uuid not null references public.lobby_players(id) on delete cascade,
  leader_id uuid not null references public.lobby_players(id) on delete cascade,
  celebrity_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (lobby_id, player_id)
);

drop trigger if exists set_celebrities_player_state_updated_at on public.celebrities_player_state;
create trigger set_celebrities_player_state_updated_at
before update on public.celebrities_player_state
for each row execute function public.set_updated_at();

alter table public.celebrities_games enable row level security;
alter table public.celebrities_entries enable row level security;
alter table public.celebrities_player_state enable row level security;
revoke all on table public.celebrities_games from anon, authenticated;
revoke all on table public.celebrities_entries from anon, authenticated;
revoke all on table public.celebrities_player_state from anon, authenticated;

create or replace function public.cc_active_player_ids(p_lobby_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(p.id) order by p.created_at), '[]'::jsonb)
  from public.lobby_players p
  where p.lobby_id = p_lobby_id;
$$;

create or replace function public.cc_name_norm(p_value text)
returns text
language sql
immutable
as $$
  select regexp_replace(lower(coalesce(p_value, '')), '[^a-z0-9]', '', 'g');
$$;

create or replace function public.cc_name_too_close(p_left text, p_right text)
returns boolean
language sql
immutable
as $$
  select case
    when p_left = '' or p_right = '' then false
    when p_left = p_right then true
    when char_length(p_left) >= 4 and position(p_left in p_right) > 0 then true
    when char_length(p_right) >= 4 and position(p_right in p_left) > 0 then true
    else false
  end;
$$;

create or replace function public.cc_player_context(p_game_code text, p_player_token text)
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

  return jsonb_build_object(
    'phase', v_game.phase,
    'revealRound', v_game.reveal_round,
    'revealEndsAt', v_game.reveal_ends_at,
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

create or replace function public.cc_init_game(p_game_code text, p_player_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_asker uuid;
begin
  perform public.cleanup_lobby_presence(p_game_code);

  select * into v_ctx from public.cc_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  if v_ctx.game_slug <> 'celebrities' then
    raise exception 'Game mismatch.';
  end if;

  if v_ctx.lobby_status <> 'started' then
    raise exception 'Game has not started.';
  end if;

  if exists (select 1 from public.celebrities_games where lobby_id = v_ctx.lobby_id) then
    return public.cc_get_state(p_game_code, p_player_token);
  end if;

  select p.id
  into v_asker
  from public.lobby_players p
  where p.lobby_id = v_ctx.lobby_id
  order by random()
  limit 1;

  insert into public.celebrities_games (
    lobby_id,
    phase,
    waiting_on,
    reveal_round,
    current_asker_id
  )
  values (
    v_ctx.lobby_id,
    'rules',
    public.cc_active_player_ids(v_ctx.lobby_id),
    0,
    v_asker
  );

  insert into public.celebrities_player_state (lobby_id, player_id, leader_id)
  select p.lobby_id, p.id, p.id
  from public.lobby_players p
  where p.lobby_id = v_ctx.lobby_id
  on conflict (lobby_id, player_id) do nothing;

  return public.cc_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.cc_remove_waiting(p_waiting jsonb, p_player_id uuid)
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

create or replace function public.cc_continue(p_game_code text, p_player_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.celebrities_games%rowtype;
  v_waiting jsonb;
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
    raise exception 'Game runtime not initialized.';
  end if;

  if v_game.phase = 'rules' then
    v_waiting := public.cc_remove_waiting(v_game.waiting_on, v_ctx.player_id);
    update public.celebrities_games
    set waiting_on = v_waiting
    where lobby_id = v_ctx.lobby_id;

    if jsonb_array_length(v_waiting) = 0 then
      update public.celebrities_games
      set phase = 'input',
          waiting_on = '[]'::jsonb,
          last_error = null
      where lobby_id = v_ctx.lobby_id;
    end if;
  elsif v_game.phase = 'reveal' then
    if v_game.reveal_ends_at is not null and now() < v_game.reveal_ends_at then
      raise exception 'Reveal timer is still running.';
    end if;

    v_waiting := public.cc_remove_waiting(v_game.waiting_on, v_ctx.player_id);
    update public.celebrities_games
    set waiting_on = v_waiting
    where lobby_id = v_ctx.lobby_id;

    if jsonb_array_length(v_waiting) = 0 then
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
    end if;
  end if;

  return public.cc_get_state(p_game_code, p_player_token);
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
        reveal_ends_at = now() + interval '30 seconds',
        waiting_on = public.cc_active_player_ids(v_ctx.lobby_id),
        last_error = null
    where lobby_id = v_ctx.lobby_id;
  end if;

  return public.cc_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.cc_pick_target(
  p_game_code text,
  p_player_token text,
  p_target_player_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.celebrities_games%rowtype;
  v_my_leader uuid;
  v_target_leader uuid;
begin
  perform public.cleanup_lobby_presence(p_game_code);

  select * into v_ctx from public.cc_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_game
  from public.celebrities_games
  where lobby_id = v_ctx.lobby_id;

  if not found or v_game.phase <> 'guess_pick' then
    raise exception 'Target pick is not active.';
  end if;

  if v_game.current_asker_id <> v_ctx.player_id then
    raise exception 'It is not your turn.';
  end if;

  if p_target_player_id = v_ctx.player_id then
    raise exception 'Pick another player.';
  end if;

  select leader_id into v_my_leader
  from public.celebrities_player_state
  where lobby_id = v_ctx.lobby_id
    and player_id = v_ctx.player_id;

  select leader_id into v_target_leader
  from public.celebrities_player_state
  where lobby_id = v_ctx.lobby_id
    and player_id = p_target_player_id;

  if v_target_leader is null then
    raise exception 'Invalid target.';
  end if;

  if v_my_leader = v_target_leader then
    raise exception 'Target must be outside your team.';
  end if;

  update public.celebrities_games
  set phase = 'guess_input',
      current_target_id = p_target_player_id,
      current_guess = null,
      asker_confirm = null,
      target_confirm = null,
      last_error = null
  where lobby_id = v_ctx.lobby_id;

  return public.cc_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.cc_submit_guess(
  p_game_code text,
  p_player_token text,
  p_guess text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.celebrities_games%rowtype;
  v_guess text;
begin
  perform public.cleanup_lobby_presence(p_game_code);

  select * into v_ctx from public.cc_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_game
  from public.celebrities_games
  where lobby_id = v_ctx.lobby_id;

  if not found or v_game.phase <> 'guess_input' then
    raise exception 'Guess input is not active.';
  end if;

  if v_game.current_asker_id <> v_ctx.player_id then
    raise exception 'Only the asking player can submit the guess.';
  end if;

  v_guess := left(trim(p_guess), 20);
  if v_guess = '' then
    raise exception 'Enter a celebrity guess.';
  end if;

  update public.celebrities_games
  set phase = 'guess_confirm',
      current_guess = v_guess,
      asker_confirm = null,
      target_confirm = null,
      last_error = null
  where lobby_id = v_ctx.lobby_id;

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
        reveal_ends_at = now() + interval '30 seconds',
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

grant execute on function public.cc_active_player_ids(uuid) to anon, authenticated;
grant execute on function public.cc_name_norm(text) to anon, authenticated;
grant execute on function public.cc_name_too_close(text, text) to anon, authenticated;
grant execute on function public.cc_player_context(text, text) to anon, authenticated;
grant execute on function public.cc_get_state(text, text) to anon, authenticated;
grant execute on function public.cc_init_game(text, text) to anon, authenticated;
grant execute on function public.cc_remove_waiting(jsonb, uuid) to anon, authenticated;
grant execute on function public.cc_continue(text, text) to anon, authenticated;
grant execute on function public.cc_submit_celebrities(text, text, text, text) to anon, authenticated;
grant execute on function public.cc_pick_target(text, text, uuid) to anon, authenticated;
grant execute on function public.cc_submit_guess(text, text, text) to anon, authenticated;
grant execute on function public.cc_confirm_guess(text, text, boolean) to anon, authenticated;
