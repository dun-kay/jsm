-- Add per-game routing support in lobby state.

alter table public.game_lobbies
  add column if not exists game_slug text;

update public.game_lobbies
set game_slug = coalesce(game_slug, 'secret-category')
where game_slug is null;

alter table public.game_lobbies
  alter column game_slug set default 'secret-category',
  alter column game_slug set not null;

create index if not exists game_lobbies_game_slug_idx
  on public.game_lobbies(game_slug);

create or replace function public.create_game(p_host_name text, p_max_players integer, p_game_slug text)
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
  v_game_slug text;
begin
  v_host_name := left(regexp_replace(trim(p_host_name), '\s+', '', 'g'), 10);

  if v_host_name is null or char_length(v_host_name) = 0 then
    raise exception 'Host name is required.';
  end if;

  v_game_slug := nullif(trim(p_game_slug), '');
  if v_game_slug is null then
    raise exception 'Game slug is required.';
  end if;

  v_code := public.generate_game_code();
  v_secret := gen_random_uuid()::text;

  insert into public.game_lobbies (game_code, game_slug, max_players, join_buffer, host_secret)
  values (v_code, v_game_slug, 18, 0, v_secret)
  returning id into v_lobby_id;

  insert into public.lobby_players as lp (lobby_id, display_name, is_host, last_seen_at)
  values (v_lobby_id, v_host_name, true, now())
  returning lp.id, lp.player_token into v_player_id, v_player_token;

  return query select v_code, v_secret, v_player_id, v_player_token;
end;
$$;

create or replace function public.create_game(p_host_name text, p_max_players integer)
returns table(game_code text, host_secret text, host_player_id uuid, host_player_token text)
language sql
security definer
set search_path = public
as $$
  select *
  from public.create_game(p_host_name, p_max_players, 'secret-category');
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
    'gameSlug', v_lobby.game_slug,
    'status', v_lobby.status,
    'maxPlayers', v_lobby.max_players,
    'playerCount', v_player_count,
    'players', v_players
  );
end;
$$;

grant execute on function public.create_game(text, integer, text) to anon, authenticated;
grant execute on function public.create_game(text, integer) to anon, authenticated;

