-- Rename Celebrities game slug to Popular People.
-- New slug: popular-people

update public.game_lobbies
set game_slug = 'popular-people'
where game_slug = 'celebrities';

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

  if v_ctx.game_slug not in ('popular-people', 'celebrities') then
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

grant execute on function public.start_game(text, text) to anon, authenticated;
grant execute on function public.cc_init_game(text, text) to anon, authenticated;
