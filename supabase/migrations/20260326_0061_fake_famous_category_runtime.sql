-- Fake Famous categories: select one category for the full game and allow host re-spin

alter table public.really_donald_games
  add column if not exists selected_category text;

create or replace function public.rd_pick_category(p_quote_pool jsonb, p_required_count integer)
returns table(category_name text, category_quotes jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pool jsonb := coalesce(p_quote_pool, '[]'::jsonb);
begin
  if p_required_count <= 0 then
    raise exception 'Required quote count must be positive.';
  end if;

  if jsonb_typeof(v_pool) = 'object' and jsonb_typeof(v_pool -> 'categories') = 'array' then
    return query
    with cats as (
      select
        coalesce(nullif(trim(c.value ->> 'name'), ''), 'General') as name,
        coalesce(c.value -> 'quotes', '[]'::jsonb) as quotes
      from jsonb_array_elements(v_pool -> 'categories') as c(value)
    ),
    valid as (
      select
        name,
        quotes,
        (
          select count(*)
          from (
            select distinct coalesce(nullif(q.value ->> 'id', ''), md5(q.value::text)) as quote_key
            from jsonb_array_elements(quotes) as q(value)
          ) uq
        ) as unique_count
      from cats
      where jsonb_typeof(quotes) = 'array'
    )
    select name, quotes
    from valid
    where unique_count >= p_required_count
    order by random()
    limit 1;

    if found then
      return;
    end if;

    raise exception 'No category has at least % unique quotes.', p_required_count;
  end if;

  if jsonb_typeof(v_pool) = 'array' then
    return query select 'General'::text, v_pool;
    return;
  end if;

  raise exception 'Quote pool format is invalid.';
end;
$$;

create or replace function public.rd_get_state(p_game_code text, p_player_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.really_donald_games%rowtype;
  v_players jsonb;
  v_scores jsonb;
  v_winner_ids jsonb;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.rd_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_game
  from public.really_donald_games
  where lobby_id = v_ctx.lobby_id;

  if not found then
    raise exception 'Game runtime not initialized.';
  end if;

  with ordered as (
    select ordinality - 1 as idx, value::text as player_id_text
    from jsonb_array_elements_text(v_game.player_order) with ordinality
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'name', p.display_name,
        'isHost', p.is_host,
        'turnOrder', o.idx,
        'score', coalesce((v_game.scores ->> p.id::text)::integer, 0)
      )
      order by o.idx
    ),
    '[]'::jsonb
  )
  into v_players
  from ordered o
  join public.lobby_players p
    on p.lobby_id = v_ctx.lobby_id
   and p.id::text = o.player_id_text;

  v_scores := coalesce(v_game.scores, '{}'::jsonb);

  with score_rows as (
    select p.id as player_id,
           coalesce((v_scores ->> p.id::text)::integer, 0) as score
    from public.lobby_players p
    where p.lobby_id = v_ctx.lobby_id
  ),
  max_score as (
    select max(score) as score from score_rows
  )
  select coalesce(jsonb_agg(sr.player_id::text), '[]'::jsonb)
  into v_winner_ids
  from score_rows sr
  join max_score ms on sr.score = ms.score;

  return jsonb_build_object(
    'phase', v_game.phase,
    'roundNumber', v_game.round_number,
    'turnIndex', v_game.turn_index,
    'activePlayerId', v_game.active_player_id,
    'players', v_players,
    'scores', v_scores,
    'currentCard', coalesce(v_game.current_card, '{}'::jsonb),
    'truthVotes', coalesce(v_game.truth_votes, '{}'::jsonb),
    'speakerVotes', coalesce(v_game.speaker_votes, '{}'::jsonb),
    'truthWinners', coalesce(v_game.truth_winners, '[]'::jsonb),
    'speakerWinners', coalesce(v_game.speaker_winners, '[]'::jsonb),
    'selectedCategory', v_game.selected_category,
    'waitingOn', coalesce(v_game.waiting_on, '[]'::jsonb),
    'winnerIds', v_winner_ids,
    'lastError', v_game.last_error,
    'you', jsonb_build_object(
      'id', v_ctx.player_id,
      'name', v_ctx.player_name,
      'isHost', v_ctx.is_host,
      'score', coalesce((v_scores ->> v_ctx.player_id::text)::integer, 0)
    )
  );
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
  v_pick record;
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
  if jsonb_typeof(v_quotes) not in ('array', 'object') then
    raise exception 'Quote pool is required.';
  end if;

  v_order := public.rd_player_order(v_ctx.lobby_id);
  v_required_turns := public.rd_player_count(v_order) * 2;
  select * into v_pick from public.rd_pick_category(v_quotes, v_required_turns);
  v_deck := public.rd_sample_quote_deck(v_pick.category_quotes, v_required_turns);

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
    selected_category,
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
    v_pick.category_name,
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
  v_pick record;
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
  select * into v_pick from public.rd_pick_category(v_quotes, v_required_turns);
  v_deck := public.rd_sample_quote_deck(v_pick.category_quotes, v_required_turns);

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
      selected_category = v_pick.category_name,
      last_error = null
  where lobby_id = v_ctx.lobby_id;

  return public.rd_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.rd_reroll_category(p_game_code text, p_player_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.really_donald_games%rowtype;
  v_required_turns integer;
  v_pick record;
  v_deck jsonb;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.rd_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  if v_ctx.is_host is false then
    raise exception 'Only host can re-spin category.';
  end if;

  select * into v_game
  from public.really_donald_games
  where lobby_id = v_ctx.lobby_id
  for update;

  if not found then
    raise exception 'Game runtime not initialized.';
  end if;

  if v_game.phase <> 'round_intro' or v_game.turn_index <> 0 then
    raise exception 'Category can only be re-spun before round 1 starts.';
  end if;

  if jsonb_array_length(coalesce(v_game.waiting_on, '[]'::jsonb)) <> public.rd_player_count(v_game.player_order) then
    raise exception 'Category re-spin must happen before players continue.';
  end if;

  v_required_turns := public.rd_player_count(v_game.player_order) * 2;
  select * into v_pick from public.rd_pick_category(v_game.quote_pool, v_required_turns);
  v_deck := public.rd_sample_quote_deck(v_pick.category_quotes, v_required_turns);

  update public.really_donald_games
  set selected_category = v_pick.category_name,
      deck = v_deck,
      current_card = null,
      last_error = null
  where lobby_id = v_ctx.lobby_id;

  return public.rd_get_state(p_game_code, p_player_token);
end;
$$;

grant execute on function public.rd_pick_category(jsonb, integer) to anon, authenticated;
grant execute on function public.rd_get_state(text, text) to anon, authenticated;
grant execute on function public.rd_init_game(text, text, jsonb) to anon, authenticated;
grant execute on function public.rd_play_again(text, text, jsonb) to anon, authenticated;
grant execute on function public.rd_reroll_category(text, text) to anon, authenticated;

