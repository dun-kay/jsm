-- Fake Famous rename: support new slug in lobby start + runtime init

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
    when v_lobby.game_slug in ('murder-club', 'murder-clubs') then 4
    when v_lobby.game_slug in ('fruit-bowl', 'fruit-bowel') then 4
    when v_lobby.game_slug in ('popular-people', 'celebrities') then 2
    when v_lobby.game_slug = 'lying-llama' then 2
    when v_lobby.game_slug in ('really-donald', 'fake-famous') then 2
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

grant execute on function public.start_game(text, text) to anon, authenticated;

create or replace function public.rd_init_game(p_game_code text, p_player_token text, p_quotes jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_order jsonb;
  v_quotes jsonb;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.rd_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  if v_ctx.game_slug not in ('really-donald', 'fake-famous') then
    raise exception 'Game mismatch.';
  end if;

  if v_ctx.lobby_status <> 'started' then
    raise exception 'Game has not started.';
  end if;

  if exists (select 1 from public.really_donald_games g where g.lobby_id = v_ctx.lobby_id) then
    return public.rd_get_state(p_game_code, p_player_token);
  end if;

  if v_ctx.is_host is false then
    raise exception 'Host must initialize this game first.';
  end if;

  v_quotes := coalesce(p_quotes, '[]'::jsonb);
  if jsonb_typeof(v_quotes) <> 'array' or jsonb_array_length(v_quotes) = 0 then
    raise exception 'Quote pool is required.';
  end if;

  v_order := public.rd_player_order(v_ctx.lobby_id);

  insert into public.really_donald_games (
    lobby_id,
    phase,
    waiting_on,
    player_order,
    quote_pool,
    deck,
    current_card,
    active_player_id,
    round_number,
    turn_index,
    scores,
    truth_votes,
    speaker_votes,
    truth_winners,
    speaker_winners,
    last_error
  )
  values (
    v_ctx.lobby_id,
    'rules',
    public.rd_active_player_ids(v_ctx.lobby_id),
    v_order,
    v_quotes,
    public.rd_shuffle_json(v_quotes),
    null,
    public.rd_player_at(v_order, 0),
    1,
    0,
    public.rd_zero_scores(v_order),
    '{}'::jsonb,
    '{}'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    null
  );

  return public.rd_get_state(p_game_code, p_player_token);
end;
$$;

grant execute on function public.rd_init_game(text, text, jsonb) to anon, authenticated;

