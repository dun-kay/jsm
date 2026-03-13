-- Allow non-host players to leave lobby during onboarding and rejoin with a new name.

create or replace function public.leave_game(p_game_code text, p_player_token text)
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
    return true;
  end if;

  if v_player.is_host then
    raise exception 'Host cannot leave via this action.';
  end if;

  if v_lobby.status <> 'lobby' then
    raise exception 'Cannot leave after game start.';
  end if;

  delete from public.lobby_players
  where id = v_player.id;

  return true;
end;
$$;

grant execute on function public.leave_game(text, text) to anon, authenticated;
