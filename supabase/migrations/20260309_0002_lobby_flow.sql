create table if not exists public.game_lobbies (
  id uuid primary key default gen_random_uuid(),
  game_code text not null unique check (game_code ~ '^[A-Z2-9]{6}$'),
  status text not null default 'lobby' check (status in ('lobby', 'started', 'cancelled')),
  max_players integer not null check (max_players between 3 and 100),
  join_buffer integer not null default 10 check (join_buffer between 0 and 20),
  host_secret text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lobby_players (
  id uuid primary key default gen_random_uuid(),
  lobby_id uuid not null references public.game_lobbies(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 10),
  is_host boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lobby_players_unique_name unique (lobby_id, display_name)
);

create index if not exists game_lobbies_game_code_idx on public.game_lobbies (game_code);
create index if not exists game_lobbies_status_idx on public.game_lobbies (status);
create index if not exists lobby_players_lobby_id_idx on public.lobby_players (lobby_id);

drop trigger if exists set_game_lobbies_updated_at on public.game_lobbies;
create trigger set_game_lobbies_updated_at
before update on public.game_lobbies
for each row execute function public.set_updated_at();

drop trigger if exists set_lobby_players_updated_at on public.lobby_players;
create trigger set_lobby_players_updated_at
before update on public.lobby_players
for each row execute function public.set_updated_at();

alter table public.game_lobbies enable row level security;
alter table public.lobby_players enable row level security;

revoke all on table public.game_lobbies from anon, authenticated;
revoke all on table public.lobby_players from anon, authenticated;

create or replace function public.generate_game_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  chars constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  out_code text;
  i integer;
begin
  loop
    out_code := '';
    for i in 1..6 loop
      out_code := out_code || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
    end loop;

    if not exists (select 1 from public.game_lobbies where game_code = out_code) then
      return out_code;
    end if;
  end loop;
end;
$$;

create or replace function public.create_game(p_host_name text, p_max_players integer)
returns table(game_code text, host_secret text, host_player_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_secret text;
  v_lobby_id uuid;
  v_host_name text;
  v_player_id uuid;
begin
  v_host_name := left(trim(p_host_name), 10);

  if v_host_name is null or char_length(v_host_name) = 0 then
    raise exception 'Host name is required.';
  end if;

  if p_max_players < 3 or p_max_players > 100 then
    raise exception 'Player count must be between 3 and 100.';
  end if;

  v_code := public.generate_game_code();
  v_secret := gen_random_uuid()::text;

  insert into public.game_lobbies (game_code, max_players, join_buffer, host_secret)
  values (v_code, p_max_players, 10, v_secret)
  returning id into v_lobby_id;

  insert into public.lobby_players (lobby_id, display_name, is_host)
  values (v_lobby_id, v_host_name, true)
  returning id into v_player_id;

  return query select v_code, v_secret, v_player_id;
end;
$$;

create or replace function public.join_game(p_game_code text, p_player_name text)
returns table(player_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lobby public.game_lobbies%rowtype;
  v_count integer;
  v_name text;
  v_player_id uuid;
begin
  v_name := left(trim(p_player_name), 10);

  if v_name is null or char_length(v_name) = 0 then
    raise exception 'Player name is required.';
  end if;

  select *
  into v_lobby
  from public.game_lobbies
  where game_code = upper(trim(p_game_code));

  if not found then
    raise exception 'Lobby not found.';
  end if;

  if v_lobby.status <> 'lobby' then
    raise exception 'Lobby is not open for joining.';
  end if;

  select count(*) into v_count
  from public.lobby_players
  where lobby_id = v_lobby.id;

  if v_count >= (v_lobby.max_players + v_lobby.join_buffer) then
    raise exception 'Lobby is full.';
  end if;

  insert into public.lobby_players (lobby_id, display_name, is_host)
  values (v_lobby.id, v_name, false)
  returning id into v_player_id;

  return query select v_player_id;
exception
  when unique_violation then
    raise exception 'Name already taken in this lobby.';
end;
$$;

create or replace function public.get_lobby_state(p_game_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lobby public.game_lobbies%rowtype;
  v_player_count integer;
  v_players jsonb;
begin
  select *
  into v_lobby
  from public.game_lobbies
  where game_code = upper(trim(p_game_code));

  if not found then
    raise exception 'Lobby not found.';
  end if;

  select count(*) into v_player_count
  from public.lobby_players
  where lobby_id = v_lobby.id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'name', p.display_name,
        'isHost', p.is_host
      )
      order by p.created_at desc
    ),
    '[]'::jsonb
  )
  into v_players
  from public.lobby_players p
  where p.lobby_id = v_lobby.id;

  return jsonb_build_object(
    'gameCode', v_lobby.game_code,
    'status', v_lobby.status,
    'maxPlayers', v_lobby.max_players,
    'joinBuffer', v_lobby.join_buffer,
    'playerCount', v_player_count,
    'players', v_players
  );
end;
$$;

create or replace function public.start_game(p_game_code text, p_host_secret text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.game_lobbies
  set status = 'started', updated_at = now()
  where game_code = upper(trim(p_game_code))
    and host_secret = p_host_secret
    and status = 'lobby';

  if not found then
    raise exception 'Unable to start game.';
  end if;

  return true;
end;
$$;

create or replace function public.cancel_game(p_game_code text, p_host_secret text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.game_lobbies
  set status = 'cancelled', updated_at = now()
  where game_code = upper(trim(p_game_code))
    and host_secret = p_host_secret
    and status in ('lobby', 'started');

  if not found then
    raise exception 'Unable to cancel game.';
  end if;

  return true;
end;
$$;

grant execute on function public.create_game(text, integer) to anon, authenticated;
grant execute on function public.join_game(text, text) to anon, authenticated;
grant execute on function public.get_lobby_state(text) to anon, authenticated;
grant execute on function public.start_game(text, text) to anon, authenticated;
grant execute on function public.cancel_game(text, text) to anon, authenticated;
grant execute on function public.generate_game_code() to anon, authenticated;
