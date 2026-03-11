-- Allow host to reroll category/secret category before clue turns begin.

create or replace function public.sc_reroll_category(p_game_code text, p_player_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_state public.secret_category_games%rowtype;
  v_main text;
  v_secret text;
  v_options jsonb;
  v_turn_order jsonb;
  v_spy_id uuid;
begin
  perform public.cleanup_lobby_presence(p_game_code);

  select * into v_ctx from public.sc_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  if v_ctx.is_host is false then
    raise exception 'Only host can reroll category.';
  end if;

  select * into v_state
  from public.secret_category_games
  where lobby_id = v_ctx.lobby_id;

  if not found then
    raise exception 'Game runtime not initialized.';
  end if;

  if v_state.phase not in ('rules', 'role_reveal') then
    raise exception 'Reroll is only allowed before clue turns.';
  end if;

  select * into v_main, v_secret, v_options from public.sc_pick_round_data();

  select coalesce(jsonb_agg(to_jsonb(p.id) order by random()), '[]'::jsonb)
  into v_turn_order
  from public.lobby_players p
  where p.lobby_id = v_ctx.lobby_id;

  select (elem::text)::uuid
  into v_spy_id
  from jsonb_array_elements_text(v_turn_order) elem
  order by random()
  limit 1;

  update public.secret_category_games
  set main_category = v_main,
      secret_category = v_secret,
      secret_options = v_options,
      spy_player_id = v_spy_id,
      turn_order = v_turn_order,
      turn_index = 0,
      waiting_on = public.sc_active_player_ids(v_ctx.lobby_id),
      phase = 'role_reveal',
      votes = '{}'::jsonb,
      vote_attempt = 1,
      round_result = 'pending'
  where lobby_id = v_ctx.lobby_id;

  return public.sc_get_state(p_game_code, p_player_token);
end;
$$;

grant execute on function public.sc_reroll_category(text, text) to anon, authenticated;

