-- Never Ever simplification:
-- - use one combined card pool (no category selection/re-spin)
-- - no visible round intro phase transitions

create or replace function public.ne_pick_category(p_card_pool jsonb, p_required_count integer)
returns table(category_name text, category_cards jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pool jsonb := coalesce(p_card_pool, '[]'::jsonb);
  v_cards jsonb;
begin
  if p_required_count <= 0 then
    raise exception 'Required card count must be positive.';
  end if;

  if jsonb_typeof(v_pool) = 'array' then
    v_cards := v_pool;
  elsif jsonb_typeof(v_pool) = 'object' and jsonb_typeof(v_pool -> 'categories') = 'array' then
    with all_cards as (
      select value
      from jsonb_array_elements(v_pool -> 'categories') c,
           jsonb_array_elements(coalesce(c.value -> 'cards', '[]'::jsonb))
    )
    select coalesce(jsonb_agg(value), '[]'::jsonb) into v_cards
    from all_cards;
  else
    raise exception 'Card pool format is invalid.';
  end if;

  if jsonb_typeof(v_cards) <> 'array' or jsonb_array_length(v_cards) < p_required_count then
    raise exception 'Need at least % cards in card pool.', p_required_count;
  end if;

  return query select 'All cards'::text, v_cards;
end;
$$;

create or replace function public.ne_continue(p_game_code text, p_player_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.never_ever_games%rowtype;
  v_waiting jsonb;
  v_next_turn integer;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.ne_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_game
  from public.never_ever_games
  where lobby_id = v_ctx.lobby_id
  for update;

  if not found then
    raise exception 'Game runtime not initialized.';
  end if;

  if v_game.phase in ('rules', 'card_reveal') then
    if not (coalesce(v_game.waiting_on, '[]'::jsonb) @> jsonb_build_array(v_ctx.player_id::text)) then
      return public.ne_get_state(p_game_code, p_player_token);
    end if;

    v_waiting := public.ne_remove_waiting(v_game.waiting_on, v_ctx.player_id);
    update public.never_ever_games
    set waiting_on = v_waiting
    where lobby_id = v_ctx.lobby_id;

    if jsonb_array_length(v_waiting) = 0 then
      if v_game.phase = 'rules' then
        perform public.ne_prepare_turn(v_ctx.lobby_id);
      elsif v_game.phase = 'card_reveal' then
        update public.never_ever_games
        set phase = 'vote',
            waiting_on = public.ne_active_player_ids(v_ctx.lobby_id),
            votes = '{}'::jsonb,
            called_out = '[]'::jsonb,
            called_out_option = null,
            last_error = null
        where lobby_id = v_ctx.lobby_id;
      end if;
    end if;
  elsif v_game.phase = 'callout' then
    if not (coalesce(v_game.called_out, '[]'::jsonb) @> jsonb_build_array(v_ctx.player_id::text)) then
      return public.ne_get_state(p_game_code, p_player_token);
    end if;

    v_next_turn := v_game.turn_index + 1;
    if v_next_turn >= 18 then
      update public.never_ever_games
      set turn_index = v_next_turn,
          phase = 'result',
          waiting_on = '[]'::jsonb
      where lobby_id = v_ctx.lobby_id;
      return public.ne_get_state(p_game_code, p_player_token);
    end if;

    update public.never_ever_games
    set turn_index = v_next_turn,
        votes = '{}'::jsonb,
        called_out = '[]'::jsonb,
        called_out_option = null,
        current_reader_id = null,
        current_card = null,
        last_error = null
    where lobby_id = v_ctx.lobby_id;
    perform public.ne_prepare_turn(v_ctx.lobby_id);
  end if;

  return public.ne_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.ne_init_game(p_game_code text, p_player_token text, p_card_pool jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_order jsonb;
  v_pool jsonb;
  v_pick record;
  v_deck jsonb;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.ne_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  if v_ctx.game_slug <> 'never-ever' then
    raise exception 'Game mismatch.';
  end if;

  if v_ctx.lobby_status <> 'started' then
    raise exception 'Game has not started.';
  end if;

  if exists (select 1 from public.never_ever_games g where g.lobby_id = v_ctx.lobby_id) then
    return public.ne_get_state(p_game_code, p_player_token);
  end if;

  if v_ctx.is_host is false then
    raise exception 'Host must initialize this game first.';
  end if;

  v_pool := coalesce(p_card_pool, '[]'::jsonb);
  select * into v_pick from public.ne_pick_category(v_pool, 18);
  v_deck := public.ne_sample_cards(v_pick.category_cards, 18);
  v_order := public.rd_player_order(v_ctx.lobby_id);

  insert into public.never_ever_games (
    lobby_id,
    phase,
    waiting_on,
    player_order,
    turn_index,
    round_number,
    selected_category,
    card_pool,
    deck,
    current_reader_id,
    current_card,
    votes,
    called_out,
    called_out_option,
    callout_counts,
    last_error
  )
  values (
    v_ctx.lobby_id,
    'rules',
    public.ne_active_player_ids(v_ctx.lobby_id),
    v_order,
    0,
    1,
    null,
    v_pool,
    v_deck,
    null,
    null,
    '{}'::jsonb,
    '[]'::jsonb,
    null,
    public.rd_zero_scores(v_order),
    null
  );

  return public.ne_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.ne_play_again(p_game_code text, p_player_token text, p_card_pool jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.never_ever_games%rowtype;
  v_pool jsonb;
  v_order jsonb;
  v_pick record;
  v_deck jsonb;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.ne_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;
  if v_ctx.is_host is false then
    raise exception 'Only host can play again.';
  end if;

  select * into v_game from public.never_ever_games where lobby_id = v_ctx.lobby_id;
  if not found then
    raise exception 'Game runtime not initialized.';
  end if;

  v_pool := coalesce(p_card_pool, v_game.card_pool);
  v_order := public.rd_player_order(v_ctx.lobby_id);
  select * into v_pick from public.ne_pick_category(v_pool, 18);
  v_deck := public.ne_sample_cards(v_pick.category_cards, 18);

  update public.never_ever_games
  set phase = 'rules',
      waiting_on = public.ne_active_player_ids(v_ctx.lobby_id),
      player_order = v_order,
      turn_index = 0,
      round_number = 1,
      selected_category = null,
      card_pool = v_pool,
      deck = v_deck,
      current_reader_id = null,
      current_card = null,
      votes = '{}'::jsonb,
      called_out = '[]'::jsonb,
      called_out_option = null,
      callout_counts = public.rd_zero_scores(v_order),
      last_error = null
  where lobby_id = v_ctx.lobby_id;

  return public.ne_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.ne_reroll_category(p_game_code text, p_player_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Categories are disabled for Never Ever in this runtime version.
  return public.ne_get_state(p_game_code, p_player_token);
end;
$$;

