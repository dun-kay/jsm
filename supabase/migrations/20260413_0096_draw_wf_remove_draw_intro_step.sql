-- Draw WF: remove draw_intro step by starting each round directly in draw_live

create or replace function public.dwf_start_round(p_lobby_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.draw_wf_games%rowtype;
  v_order jsonb;
  v_count integer;
  v_drawer_idx integer;
  v_drawer_id uuid;
  v_round integer;
  v_word text;
  v_round_id uuid;
  v_guessers jsonb;
begin
  select * into v_game
  from public.draw_wf_games
  where lobby_id = p_lobby_id
  for update;

  if not found then
    return;
  end if;

  v_order := public.rd_player_order(p_lobby_id);
  v_count := public.rd_player_count(v_order);

  if v_count <= 0 then
    update public.draw_wf_games
    set phase = 'rules', waiting_on = '[]'::jsonb, last_error = 'No active players.'
    where lobby_id = p_lobby_id;
    return;
  end if;

  v_drawer_idx := mod(v_game.turn_index, v_count);
  v_drawer_id := public.rd_player_at(v_order, v_drawer_idx);
  v_round := v_game.round_number + 1;
  v_word := public.dwf_pick_word(v_game.word_pool);

  select coalesce(jsonb_agg(value), '[]'::jsonb)
  into v_guessers
  from jsonb_array_elements(v_order)
  where value <> to_jsonb(v_drawer_id::text);

  insert into public.draw_wf_rounds (
    lobby_id, round_number, drawer_player_id, word, word_mask, letter_bank, guesser_ids, draw_deadline_at, guess_deadline_at
  ) values (
    p_lobby_id,
    v_round,
    v_drawer_id,
    v_word,
    public.dwf_word_mask(v_word),
    public.dwf_letter_bank(v_word),
    coalesce(v_guessers,'[]'::jsonb),
    now() + interval '10 seconds',
    null
  ) returning id into v_round_id;

  update public.draw_wf_games
  set player_order = v_order,
      phase = 'draw_live',
      round_number = v_round,
      current_round_id = v_round_id,
      waiting_on = jsonb_build_array(v_drawer_id::text),
      last_activity_at = now(),
      last_error = null
  where lobby_id = p_lobby_id;
end;
$$;

grant execute on function public.dwf_start_round(uuid) to anon, authenticated;
