-- Any player can quit an active game, which ends it for all players.

create or replace function public.quit_game(p_game_code text, p_player_token text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lobby public.game_lobbies%rowtype;
begin
  perform public.cleanup_lobby_presence(p_game_code);

  select *
  into v_lobby
  from public.game_lobbies
  where game_code = upper(trim(p_game_code));

  if not found then
    return false;
  end if;

  if not exists (
    select 1
    from public.lobby_players p
    where p.lobby_id = v_lobby.id
      and p.player_token = p_player_token
  ) then
    raise exception 'Session expired.';
  end if;

  update public.game_lobbies
  set status = 'cancelled',
      updated_at = now()
  where id = v_lobby.id;

  delete from public.lobby_players
  where lobby_id = v_lobby.id;

  return true;
end;
$$;

grant execute on function public.quit_game(text, text) to anon, authenticated;
