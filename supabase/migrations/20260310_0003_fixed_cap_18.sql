-- Enforce fixed lobby cap of 18 players and remove overflow buffer.

alter table public.game_lobbies
  alter column max_players set default 18,
  alter column join_buffer set default 0;

alter table public.game_lobbies
  drop constraint if exists game_lobbies_max_players_check;

alter table public.game_lobbies
  add constraint game_lobbies_max_players_check check (max_players = 18);

alter table public.game_lobbies
  drop constraint if exists game_lobbies_join_buffer_check;

alter table public.game_lobbies
  add constraint game_lobbies_join_buffer_check check (join_buffer = 0);

update public.game_lobbies
set max_players = 18,
    join_buffer = 0,
    updated_at = now()
where max_players <> 18 or join_buffer <> 0;

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

  v_code := public.generate_game_code();
  v_secret := gen_random_uuid()::text;

  insert into public.game_lobbies (game_code, max_players, join_buffer, host_secret)
  values (v_code, 18, 0, v_secret)
  returning id into v_lobby_id;

  insert into public.lobby_players (lobby_id, display_name, is_host)
  values (v_lobby_id, v_host_name, true)
  returning id into v_player_id;

  return query select v_code, v_secret, v_player_id;
end;
$$;
