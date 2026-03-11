-- Session persistence and timeout rules.
-- Players can reload and resume if they return within 120 seconds.
-- Host inactivity for 120 seconds cancels lobby.
-- Non-host inactivity for 120 seconds removes that player.

alter table public.lobby_players
  add column if not exists player_token text,
  add column if not exists last_seen_at timestamptz;

update public.lobby_players
set player_token = coalesce(player_token, gen_random_uuid()::text),
    last_seen_at = coalesce(last_seen_at, now());

alter table public.lobby_players
  alter column player_token set not null,
  alter column player_token set default gen_random_uuid()::text,
  alter column last_seen_at set not null,
  alter column last_seen_at set default now();

create unique index if not exists lobby_players_player_token_uidx
  on public.lobby_players(player_token);

create or replace function public.cleanup_lobby_presence(p_game_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lobby_id uuid;
  v_host_stale boolean;
begin
  select id into v_lobby_id
  from public.game_lobbies
  where game_code = upper(trim(p_game_code));

  if not found then
    return;
  end if;

  delete from public.lobby_players p
  where p.lobby_id = v_lobby_id
    and p.is_host = false
    and p.last_seen_at < now() - interval '120 seconds';

  select exists (
    select 1
    from public.lobby_players p
    where p.lobby_id = v_lobby_id
      and p.is_host = true
      and p.last_seen_at < now() - interval '120 seconds'
  ) into v_host_stale;

  if v_host_stale then
    update public.game_lobbies
    set status = 'cancelled',
        updated_at = now()
    where id = v_lobby_id
      and status <> 'cancelled';
  end if;
end;
$$;

create or replace function public.create_game(p_host_name text, p_max_players integer)
returns table(game_code text, host_secret text, host_player_id uuid, host_player_token text)
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
  v_player_token text;
begin
  v_host_name := left(trim(p_host_name), 10);

  if v_host_name is null or char_length(v_host_name) = 0 then
    raise exception 'Host name is required.';
  end if;

  v_code := public.generate_game_code();
  v_secret := gen_random_uuid()::text;

  insert into public.game_lobbies (game_code, max_players, join_buffer, host_secret)
  values (v_code, 18, 0, v_secret)
  returning id into v_lobby_id;

  insert into public.lobby_players as lp (lobby_id, display_name, is_host, last_seen_at)
  values (v_lobby_id, v_host_name, true, now())
  returning lp.id, lp.player_token into v_player_id, v_player_token;

  return query select v_code, v_secret, v_player_id, v_player_token;
end;
$$;

create or replace function public.join_game(p_game_code text, p_player_name text)
returns table(player_id uuid, player_token text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lobby public.game_lobbies%rowtype;
  v_count integer;
  v_name text;
  v_player_id uuid;
  v_player_token text;
begin
  perform public.cleanup_lobby_presence(p_game_code);

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

  if v_count >= v_lobby.max_players then
    raise exception 'Lobby is full.';
  end if;

  insert into public.lobby_players as lp (lobby_id, display_name, is_host, last_seen_at)
  values (v_lobby.id, v_name, false, now())
  returning lp.id, lp.player_token into v_player_id, v_player_token;

  return query select v_player_id, v_player_token;
exception
  when unique_violation then
    raise exception 'Name already taken in this lobby.';
end;
$$;

create or replace function public.rejoin_game(p_game_code text, p_player_token text)
returns table(player_id uuid, player_name text, is_host boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lobby public.game_lobbies%rowtype;
  v_player public.lobby_players%rowtype;
begin
  perform public.cleanup_lobby_presence(p_game_code);

  select *
  into v_lobby
  from public.game_lobbies
  where game_code = upper(trim(p_game_code));

  if not found then
    raise exception 'Lobby not found.';
  end if;

  select p.*
  into v_player
  from public.lobby_players p
  where p.lobby_id = v_lobby.id
    and p.player_token = p_player_token;

  if not found then
    raise exception 'Session expired.';
  end if;

  if v_player.last_seen_at < now() - interval '120 seconds' then
    if v_player.is_host then
      update public.game_lobbies
      set status = 'cancelled', updated_at = now()
      where id = v_lobby.id;
    end if;

    delete from public.lobby_players where id = v_player.id;
    raise exception 'Session expired.';
  end if;

  update public.lobby_players
  set last_seen_at = now(), updated_at = now()
  where id = v_player.id;

  return query select v_player.id, v_player.display_name, v_player.is_host;
end;
$$;

create or replace function public.touch_player(p_game_code text, p_player_token text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lobby public.game_lobbies%rowtype;
  v_player public.lobby_players%rowtype;
begin
  perform public.cleanup_lobby_presence(p_game_code);

  select *
  into v_lobby
  from public.game_lobbies
  where game_code = upper(trim(p_game_code));

  if not found then
    return false;
  end if;

  select p.*
  into v_player
  from public.lobby_players p
  where p.lobby_id = v_lobby.id
    and p.player_token = p_player_token;

  if not found then
    return false;
  end if;

  if v_player.last_seen_at < now() - interval '120 seconds' then
    if v_player.is_host then
      update public.game_lobbies
      set status = 'cancelled', updated_at = now()
      where id = v_lobby.id;
    end if;

    delete from public.lobby_players where id = v_player.id;
    return false;
  end if;

  update public.lobby_players
  set last_seen_at = now(), updated_at = now()
  where id = v_player.id;

  perform public.cleanup_lobby_presence(p_game_code);

  return true;
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
  perform public.cleanup_lobby_presence(p_game_code);

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
declare
  v_lobby_id uuid;
  v_player_count integer;
begin
  perform public.cleanup_lobby_presence(p_game_code);

  select id into v_lobby_id
  from public.game_lobbies
  where game_code = upper(trim(p_game_code))
    and host_secret = p_host_secret
    and status = 'lobby';

  if not found then
    raise exception 'Unable to start game.';
  end if;

  select count(*) into v_player_count
  from public.lobby_players
  where lobby_id = v_lobby_id;

  if v_player_count < 3 then
    raise exception 'At least 3 players are required to start.';
  end if;

  update public.game_lobbies
  set status = 'started', updated_at = now()
  where id = v_lobby_id;

  return true;
end;
$$;

grant execute on function public.cleanup_lobby_presence(text) to anon, authenticated;
grant execute on function public.create_game(text, integer) to anon, authenticated;
grant execute on function public.join_game(text, text) to anon, authenticated;
grant execute on function public.rejoin_game(text, text) to anon, authenticated;
grant execute on function public.touch_player(text, text) to anon, authenticated;
grant execute on function public.get_lobby_state(text) to anon, authenticated;
grant execute on function public.start_game(text, text) to anon, authenticated;
