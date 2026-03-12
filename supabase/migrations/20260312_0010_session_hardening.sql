-- Harden session behavior for active gameplay.
-- 1) Extend inactivity timeout from 120s to 20 minutes.
-- 2) Refresh player presence during Secret Categories RPC context lookup.

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
    and p.last_seen_at < now() - interval '20 minutes';

  select exists (
    select 1
    from public.lobby_players p
    where p.lobby_id = v_lobby_id
      and p.is_host = true
      and p.last_seen_at < now() - interval '20 minutes'
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

  if v_player.last_seen_at < now() - interval '20 minutes' then
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

  if v_player.last_seen_at < now() - interval '20 minutes' then
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

create or replace function public.sc_player_context(p_game_code text, p_player_token text)
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
declare
  v_lobby public.game_lobbies%rowtype;
  v_player public.lobby_players%rowtype;
begin
  select *
  into v_lobby
  from public.game_lobbies
  where game_code = upper(trim(p_game_code));

  if not found then
    return;
  end if;

  select p.*
  into v_player
  from public.lobby_players p
  where p.lobby_id = v_lobby.id
    and p.player_token = p_player_token;

  if not found then
    return;
  end if;

  if v_player.last_seen_at < now() - interval '20 minutes' then
    if v_player.is_host then
      update public.game_lobbies
      set status = 'cancelled',
          updated_at = now()
      where id = v_lobby.id
        and status <> 'cancelled';
    end if;

    delete from public.lobby_players where id = v_player.id;
    return;
  end if;

  update public.lobby_players
  set last_seen_at = now(),
      updated_at = now()
  where id = v_player.id;

  return query
  select
    v_lobby.id,
    v_lobby.game_slug,
    v_lobby.status,
    v_player.id,
    v_player.display_name,
    v_player.is_host;
end;
$$;

grant execute on function public.cleanup_lobby_presence(text) to anon, authenticated;
grant execute on function public.rejoin_game(text, text) to anon, authenticated;
grant execute on function public.touch_player(text, text) to anon, authenticated;
grant execute on function public.sc_player_context(text, text) to anon, authenticated;
