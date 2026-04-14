-- Never Ever final hard cap: always 18 cards total (2 rounds of 9).

create or replace function public.ne_take_first_cards(p_cards jsonb, p_limit integer)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(e.value order by e.ord), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_cards, '[]'::jsonb)) with ordinality e(value, ord)
  where e.ord <= greatest(0, p_limit);
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
  v_deck := public.ne_take_first_cards(public.ne_sample_cards(v_pick.category_cards, 18), 18);
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
  select * into v_pick from public.ne_pick_category(v_pool, 18);
  v_deck := public.ne_take_first_cards(public.ne_sample_cards(v_pick.category_cards, 18), 18);

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

-- Normalize old rows now.
update public.never_ever_games
set deck = public.ne_take_first_cards(deck, 18),
    round_number = least(round_number, 2),
    turn_index = least(turn_index, 18);

grant execute on function public.ne_take_first_cards(jsonb, integer) to anon, authenticated;

