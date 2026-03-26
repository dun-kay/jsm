-- Fake Famous: build a unique quote deck per game session (no repeats in a game)

create or replace function public.rd_sample_quote_deck(p_quote_pool jsonb, p_required_count integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pool jsonb := coalesce(p_quote_pool, '[]'::jsonb);
  v_unique_count integer;
  v_deck jsonb;
begin
  if jsonb_typeof(v_pool) <> 'array' then
    raise exception 'Quote pool must be an array.';
  end if;

  if p_required_count <= 0 then
    return '[]'::jsonb;
  end if;

  with pool as (
    select
      value as quote,
      coalesce(nullif(value ->> 'id', ''), md5(value::text)) as quote_key
    from jsonb_array_elements(v_pool)
  ),
  dedup as (
    select distinct on (quote_key) quote
    from pool
    order by quote_key
  )
  select count(*)
  into v_unique_count
  from dedup;

  if v_unique_count < p_required_count then
    raise exception 'Need at least % unique quotes for this game. Found %.', p_required_count, v_unique_count;
  end if;

  with pool as (
    select
      value as quote,
      coalesce(nullif(value ->> 'id', ''), md5(value::text)) as quote_key
    from jsonb_array_elements(v_pool)
  ),
  dedup as (
    select distinct on (quote_key) quote
    from pool
    order by quote_key
  ),
  picked as (
    select quote
    from dedup
    order by random()
    limit p_required_count
  )
  select coalesce(jsonb_agg(quote), '[]'::jsonb)
  into v_deck
  from picked;

  return v_deck;
end;
$$;

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
  v_required_turns integer;
  v_deck jsonb;
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
  v_required_turns := public.rd_player_count(v_order) * 2;
  v_deck := public.rd_sample_quote_deck(v_quotes, v_required_turns);

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
    v_deck,
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

create or replace function public.rd_play_again(p_game_code text, p_player_token text, p_quotes jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.really_donald_games%rowtype;
  v_quotes jsonb;
  v_order jsonb;
  v_required_turns integer;
  v_deck jsonb;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.rd_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;
  if v_ctx.is_host is false then
    raise exception 'Only host can play again.';
  end if;

  select * into v_game from public.really_donald_games where lobby_id = v_ctx.lobby_id;
  if not found then
    raise exception 'Game runtime not initialized.';
  end if;

  v_quotes := coalesce(p_quotes, v_game.quote_pool);
  v_order := public.rd_player_order(v_ctx.lobby_id);
  v_required_turns := public.rd_player_count(v_order) * 2;
  v_deck := public.rd_sample_quote_deck(v_quotes, v_required_turns);

  update public.really_donald_games
  set phase = 'rules',
      waiting_on = public.rd_active_player_ids(v_ctx.lobby_id),
      player_order = v_order,
      quote_pool = v_quotes,
      deck = v_deck,
      current_card = null,
      active_player_id = public.rd_player_at(v_order, 0),
      round_number = 1,
      turn_index = 0,
      scores = public.rd_zero_scores(v_order),
      truth_votes = '{}'::jsonb,
      speaker_votes = '{}'::jsonb,
      truth_winners = '[]'::jsonb,
      speaker_winners = '[]'::jsonb,
      last_error = null
  where lobby_id = v_ctx.lobby_id;

  return public.rd_get_state(p_game_code, p_player_token);
end;
$$;

grant execute on function public.rd_sample_quote_deck(jsonb, integer) to anon, authenticated;
grant execute on function public.rd_init_game(text, text, jsonb) to anon, authenticated;
grant execute on function public.rd_play_again(text, text, jsonb) to anon, authenticated;

