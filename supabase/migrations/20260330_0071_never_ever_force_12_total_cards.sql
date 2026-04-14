-- Never Ever tuning update:
-- enforce 12 total cards (2 rounds of 6) instead of 18.

create or replace function public.ne_prepare_turn(p_lobby_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.never_ever_games%rowtype;
  v_player_count integer;
  v_reader_idx integer;
  v_reader_id uuid;
  v_card text;
  v_round integer;
  v_max_cards integer;
begin
  select * into v_game
  from public.never_ever_games
  where lobby_id = p_lobby_id
  for update;

  if not found then
    return;
  end if;

  v_max_cards := least(12, coalesce(jsonb_array_length(coalesce(v_game.deck, '[]'::jsonb)), 0));
  if v_max_cards <= 0 or v_game.turn_index >= v_max_cards then
    update public.never_ever_games
    set phase = 'result',
        waiting_on = '[]'::jsonb
    where lobby_id = p_lobby_id;
    return;
  end if;

  v_player_count := public.rd_player_count(v_game.player_order);
  if v_player_count <= 0 then
    update public.never_ever_games
    set phase = 'result',
        waiting_on = '[]'::jsonb
    where lobby_id = p_lobby_id;
    return;
  end if;

  v_reader_idx := mod(v_game.turn_index, v_player_count);
  v_reader_id := public.rd_player_at(v_game.player_order, v_reader_idx);
  v_card := coalesce(v_game.deck ->> v_game.turn_index, null);
  v_round := floor((v_game.turn_index)::numeric / 6)::integer + 1;

  update public.never_ever_games
  set phase = 'card_reveal',
      round_number = v_round,
      current_reader_id = v_reader_id,
      current_card = v_card,
      votes = '{}'::jsonb,
      called_out = '[]'::jsonb,
      called_out_option = null,
      waiting_on = jsonb_build_array(v_reader_id::text),
      last_error = null
  where lobby_id = p_lobby_id;
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
  v_max_cards integer;
  v_is_hung_vote boolean;
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

  v_max_cards := least(12, coalesce(jsonb_array_length(coalesce(v_game.deck, '[]'::jsonb)), 0));

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
    v_is_hung_vote := lower(coalesce(v_game.called_out_option, '')) like 'hung vote%';

    if v_is_hung_vote then
      if not (coalesce(v_game.waiting_on, '[]'::jsonb) @> jsonb_build_array(v_ctx.player_id::text)) then
        return public.ne_get_state(p_game_code, p_player_token);
      end if;
    else
      if not (coalesce(v_game.called_out, '[]'::jsonb) @> jsonb_build_array(v_ctx.player_id::text)) then
        return public.ne_get_state(p_game_code, p_player_token);
      end if;
    end if;

    v_next_turn := v_game.turn_index + 1;
    if v_next_turn >= v_max_cards then
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
  select * into v_pick from public.ne_pick_category(v_pool, 12);
  v_deck := public.ne_take_first_cards(public.ne_sample_cards(v_pick.category_cards, 12), 12);
  v_order := public.rd_player_order(v_ctx.lobby_id);

  insert into public.never_ever_games (
    lobby_id, phase, waiting_on, player_order, turn_index, round_number, selected_category,
    card_pool, deck, current_reader_id, current_card, votes, called_out, called_out_option, callout_counts, last_error
  )
  values (
    v_ctx.lobby_id, 'rules', public.ne_active_player_ids(v_ctx.lobby_id), v_order, 0, 1, null,
    v_pool, v_deck, null, null, '{}'::jsonb, '[]'::jsonb, null, public.rd_zero_scores(v_order), null
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

  select * into v_game
  from public.never_ever_games
  where lobby_id = v_ctx.lobby_id
  for update;

  if not found then
    raise exception 'Game runtime not initialized.';
  end if;

  v_pool := coalesce(p_card_pool, v_game.card_pool);
  v_order := public.rd_player_order(v_ctx.lobby_id);
  select * into v_pick from public.ne_pick_category(v_pool, 12);
  v_deck := public.ne_take_first_cards(public.ne_sample_cards(v_pick.category_cards, 12), 12);

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

-- Normalize existing rows to 12-card max.
update public.never_ever_games
set deck = public.ne_take_first_cards(deck, 12),
    round_number = least(round_number, 2),
    turn_index = least(turn_index, 12);

