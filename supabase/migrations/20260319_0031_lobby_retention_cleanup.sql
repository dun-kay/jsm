-- Retention cleanup for old lobbies.
-- Purpose:
-- 1) keep DB lean
-- 2) allow old game codes to be recycled eventually
-- 3) avoid unbounded growth of runtime tables linked by cascade

create or replace function public.purge_old_lobbies(p_keep_days integer default 30)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer := 0;
begin
  if p_keep_days is null or p_keep_days < 1 then
    p_keep_days := 30;
  end if;

  delete from public.game_lobbies gl
  where gl.status in ('cancelled', 'started')
    and gl.updated_at < now() - make_interval(days => p_keep_days);

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

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
  -- Opportunistic cleanup on new game creation.
  perform public.purge_old_lobbies(30);

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

grant execute on function public.purge_old_lobbies(integer) to anon, authenticated;
grant execute on function public.create_game(text, integer, text) to anon, authenticated;
grant execute on function public.create_game(text, integer) to anon, authenticated;
