-- Allow Draw WF joins after host auto-starts the game.
-- Keep existing join behavior unchanged for all other games.

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

  v_name := left(regexp_replace(trim(p_player_name), '\s+', '', 'g'), 10);

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

  if v_lobby.status <> 'lobby'
     and not (v_lobby.game_slug = 'draw-wf' and v_lobby.status = 'started') then
    raise exception 'Lobby is not open for joining.';
  end if;

  select count(*) into v_count
  from public.lobby_players
  where lobby_id = v_lobby.id;

  if v_count >= v_lobby.max_players then
    raise exception 'Lobby is full.';
  end if;

  if exists (
    select 1
    from public.lobby_players p
    where p.lobby_id = v_lobby.id
      and lower(p.display_name) = lower(v_name)
  ) then
    raise exception 'Name already taken in this lobby.';
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
