-- Never Ever: enforce hard cap of 18 total cards (2 x 9)

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

  v_max_cards := least(18, coalesce(jsonb_array_length(coalesce(v_game.deck, '[]'::jsonb)), 0));
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
  v_round := floor((v_game.turn_index)::numeric / 9)::integer + 1;

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

  v_max_cards := least(18, coalesce(jsonb_array_length(coalesce(v_game.deck, '[]'::jsonb)), 0));

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

-- Normalize any existing rows with oversized decks.
update public.never_ever_games g
set deck = (
  select coalesce(jsonb_agg(e.value order by e.ord), '[]'::jsonb)
  from jsonb_array_elements(coalesce(g.deck, '[]'::jsonb)) with ordinality e(value, ord)
  where e.ord <= 18
)
where jsonb_typeof(coalesce(g.deck, '[]'::jsonb)) = 'array'
  and jsonb_array_length(coalesce(g.deck, '[]'::jsonb)) > 18;

