-- Most Likely update:
-- - hard cap to 9 total cards per game
-- - deterministic pair scheduling so with 18 players and 9 turns,
--   each player appears in a face-off at least once.

create or replace function public.ml_prepare_turn(p_lobby_id uuid, p_reader_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.most_likely_games%rowtype;
  v_reader_id uuid;
  v_card text;
  v_max_cards integer;
  v_player_count integer;
  v_pair_a_idx integer;
  v_pair_b_idx integer;
  v_pair_a_id uuid;
  v_pair_b_id uuid;
begin
  select * into v_game
  from public.most_likely_games
  where lobby_id = p_lobby_id
  for update;

  if not found then
    return;
  end if;

  v_max_cards := least(9, coalesce(jsonb_array_length(coalesce(v_game.deck, '[]'::jsonb)), 0));
  if v_max_cards <= 0 or v_game.turn_index >= v_max_cards then
    update public.most_likely_games
    set phase = 'result',
        waiting_on = '[]'::jsonb
    where lobby_id = p_lobby_id;
    return;
  end if;

  v_player_count := public.rd_player_count(v_game.player_order);
  if v_player_count < 3 then
    raise exception 'Most Likely requires at least 3 players.';
  end if;

  -- Deterministic face-off schedule:
  -- turn 0 -> slots 0/1, turn 1 -> 2/3, ... ensures full coverage at 18 players over 9 turns.
  v_pair_a_idx := mod(v_game.turn_index * 2, v_player_count);
  v_pair_b_idx := mod(v_game.turn_index * 2 + 1, v_player_count);
  v_pair_a_id := public.rd_player_at(v_game.player_order, v_pair_a_idx);
  v_pair_b_id := public.rd_player_at(v_game.player_order, v_pair_b_idx);

  if p_reader_id is not null and p_reader_id <> v_pair_a_id and p_reader_id <> v_pair_b_id then
    v_reader_id := p_reader_id;
  else
    -- Pick a reader not in the active pair.
    select value::uuid
    into v_reader_id
    from jsonb_array_elements_text(v_game.player_order)
    where value::uuid not in (v_pair_a_id, v_pair_b_id)
    order by random()
    limit 1;
  end if;

  v_card := coalesce(v_game.deck ->> v_game.turn_index, null);

  update public.most_likely_games
  set phase = 'card_reveal',
      round_number = 1,
      current_card = v_card,
      current_reader_id = v_reader_id,
      pair_player_a_id = v_pair_a_id,
      pair_player_b_id = v_pair_b_id,
      pair_votes = '{}'::jsonb,
      group_votes = '{}'::jsonb,
      group_mode = null,
      proposed_winner_id = null,
      winner_ids = '[]'::jsonb,
      waiting_on = jsonb_build_array(v_reader_id::text),
      last_error = null
  where lobby_id = p_lobby_id;
end;
$$;

create or replace function public.ml_init_game(p_game_code text, p_player_token text, p_card_pool jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_pool jsonb;
  v_deck jsonb;
  v_order jsonb;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.ml_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  if v_ctx.game_slug <> 'most-likely' then
    raise exception 'Game mismatch.';
  end if;

  if v_ctx.lobby_status <> 'started' then
    raise exception 'Game has not started.';
  end if;

  if exists (select 1 from public.most_likely_games g where g.lobby_id = v_ctx.lobby_id) then
    return public.ml_get_state(p_game_code, p_player_token);
  end if;

  if v_ctx.is_host is false then
    raise exception 'Host must initialize this game first.';
  end if;

  v_pool := coalesce(p_card_pool, '[]'::jsonb);
  v_deck := public.ml_sample_cards(v_pool, 9);
  v_order := public.rd_player_order(v_ctx.lobby_id);

  insert into public.most_likely_games (
    lobby_id, phase, waiting_on, player_order, turn_index, round_number, card_pool, deck,
    current_card, current_reader_id, pair_player_a_id, pair_player_b_id, pair_votes, group_votes,
    group_mode, proposed_winner_id, winner_ids, penalty_counts, last_error
  )
  values (
    v_ctx.lobby_id, 'rules', public.ml_active_player_ids(v_ctx.lobby_id), v_order, 0, 1, v_pool, v_deck,
    null, null, null, null, '{}'::jsonb, '{}'::jsonb, null, null, '[]'::jsonb, public.rd_zero_scores(v_order), null
  );

  return public.ml_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.ml_play_again(p_game_code text, p_player_token text, p_card_pool jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.most_likely_games%rowtype;
  v_pool jsonb;
  v_order jsonb;
  v_deck jsonb;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.ml_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;
  if v_ctx.is_host is false then
    raise exception 'Only host can play again.';
  end if;

  select * into v_game from public.most_likely_games where lobby_id = v_ctx.lobby_id;
  if not found then
    raise exception 'Game runtime not initialized.';
  end if;

  v_pool := coalesce(p_card_pool, v_game.card_pool);
  v_order := public.rd_player_order(v_ctx.lobby_id);
  v_deck := public.ml_sample_cards(v_pool, 9);

  update public.most_likely_games
  set phase = 'rules',
      waiting_on = public.ml_active_player_ids(v_ctx.lobby_id),
      player_order = v_order,
      turn_index = 0,
      round_number = 1,
      card_pool = v_pool,
      deck = v_deck,
      current_card = null,
      current_reader_id = null,
      pair_player_a_id = null,
      pair_player_b_id = null,
      pair_votes = '{}'::jsonb,
      group_votes = '{}'::jsonb,
      group_mode = null,
      proposed_winner_id = null,
      winner_ids = '[]'::jsonb,
      penalty_counts = public.rd_zero_scores(v_order),
      last_error = null
  where lobby_id = v_ctx.lobby_id;

  return public.ml_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.ml_continue(p_game_code text, p_player_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.most_likely_games%rowtype;
  v_waiting jsonb;
  v_next_turn integer;
  v_next_reader uuid;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.ml_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_game
  from public.most_likely_games
  where lobby_id = v_ctx.lobby_id
  for update;

  if not found then
    raise exception 'Game runtime not initialized.';
  end if;

  if not (coalesce(v_game.waiting_on, '[]'::jsonb) @> jsonb_build_array(v_ctx.player_id::text)) then
    return public.ml_get_state(p_game_code, p_player_token);
  end if;

  if v_game.phase in ('rules', 'card_reveal') then
    v_waiting := public.ml_remove_waiting(v_game.waiting_on, v_ctx.player_id);
    update public.most_likely_games set waiting_on = v_waiting where lobby_id = v_ctx.lobby_id;

    if jsonb_array_length(v_waiting) = 0 then
      if v_game.phase = 'rules' then
        perform public.ml_prepare_turn(v_ctx.lobby_id, null);
      else
        update public.most_likely_games
        set phase = 'pair_vote',
            waiting_on = jsonb_build_array(v_game.pair_player_a_id::text, v_game.pair_player_b_id::text),
            pair_votes = '{}'::jsonb,
            last_error = null
        where lobby_id = v_ctx.lobby_id;
      end if;
    end if;
  elsif v_game.phase = 'turn_result' then
    v_next_turn := v_game.turn_index + 1;
    if v_next_turn >= 9 then
      update public.most_likely_games
      set turn_index = v_next_turn,
          phase = 'result',
          waiting_on = '[]'::jsonb
      where lobby_id = v_ctx.lobby_id;
      return public.ml_get_state(p_game_code, p_player_token);
    end if;

    select value::uuid into v_next_reader
    from jsonb_array_elements_text(coalesce(v_game.winner_ids, '[]'::jsonb))
    order by random()
    limit 1;

    if v_next_reader is null then
      v_next_reader := v_game.current_reader_id;
    end if;

    update public.most_likely_games
    set turn_index = v_next_turn
    where lobby_id = v_ctx.lobby_id;

    perform public.ml_prepare_turn(v_ctx.lobby_id, v_next_reader);
  end if;

  return public.ml_get_state(p_game_code, p_player_token);
end;
$$;

-- Normalize existing rows to 9-card cap.
update public.most_likely_games g
set deck = (
  select coalesce(jsonb_agg(e.value order by e.ord), '[]'::jsonb)
  from jsonb_array_elements(coalesce(g.deck, '[]'::jsonb)) with ordinality e(value, ord)
  where e.ord <= 9
),
turn_index = least(turn_index, 9),
round_number = 1;

