-- Draw WF: any active player can remove another player (not self).
-- Rules:
-- 1) If removed player is the current/next drawer, remover becomes immediate next drawer.
-- 2) If removed player is not current/next drawer, flow continues naturally (including solo flow).

create or replace function public.dwf_remove_player(
  p_game_code text,
  p_player_token text,
  p_target_player_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.draw_wf_games%rowtype;
  v_round public.draw_wf_rounds%rowtype;
  v_has_game boolean := false;
  v_active_ids jsonb := '[]'::jsonb;
  v_new_order_jsonb jsonb := '[]'::jsonb;
  v_filtered_guessers jsonb := '[]'::jsonb;
  v_player_count integer := 0;
  v_first_active text := null;
  v_target_turn_pos integer := null; -- 1-based
  v_caller_turn_pos integer := null; -- 1-based in rebuilt order
  v_removed_is_drawer boolean := false;
  v_removed_is_next_drawer boolean := false;
  v_force_remover_next_draw boolean := false;
  v_existing_order text[] := array[]::text[];
  v_base_order text[] := array[]::text[];
  v_new_order text[] := array[]::text[];
  v_order_id text;
  v_insert_pos integer := 1;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.dwf_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  if p_target_player_id is null then
    raise exception 'Missing target player.';
  end if;

  if p_target_player_id = v_ctx.player_id then
    raise exception 'You cannot remove yourself.';
  end if;

  if not exists (
    select 1
    from public.lobby_players p
    where p.lobby_id = v_ctx.lobby_id
      and p.id = p_target_player_id
  ) then
    raise exception 'Player is no longer in this game.';
  end if;

  select * into v_game
  from public.draw_wf_games
  where lobby_id = v_ctx.lobby_id
  for update;
  v_has_game := found;

  if v_has_game then
    select ordinality::integer
      into v_target_turn_pos
    from jsonb_array_elements_text(coalesce(v_game.player_order, '[]'::jsonb)) with ordinality
    where value = p_target_player_id::text
    limit 1;

    if v_game.current_round_id is not null then
      select * into v_round
      from public.draw_wf_rounds
      where id = v_game.current_round_id
      for update;
      if found then
        v_removed_is_drawer := (v_round.drawer_player_id = p_target_player_id);
      end if;
    end if;

    -- In round_result, waiting_on points to the upcoming drawer.
    if v_game.phase = 'round_result'
       and coalesce(v_game.waiting_on, '[]'::jsonb) @> jsonb_build_array(p_target_player_id::text) then
      v_removed_is_next_drawer := true;
    end if;

    v_force_remover_next_draw := v_removed_is_drawer or v_removed_is_next_drawer;
  end if;

  delete from public.lobby_players p
  where p.lobby_id = v_ctx.lobby_id
    and p.id = p_target_player_id;

  if not v_has_game then
    return public.dwf_get_state(p_game_code, p_player_token);
  end if;

  v_active_ids := coalesce(public.dwf_active_player_ids(v_ctx.lobby_id), '[]'::jsonb);
  v_player_count := jsonb_array_length(v_active_ids);

  if v_player_count <= 0 then
    update public.draw_wf_games
    set phase = 'rules',
        waiting_on = '[]'::jsonb,
        player_order = '[]'::jsonb,
        turn_index = 0,
        current_round_id = null,
        last_activity_at = now(),
        last_error = 'No active players.'
    where lobby_id = v_ctx.lobby_id;

    return public.dwf_get_state(p_game_code, p_player_token);
  end if;

  select value into v_first_active
  from jsonb_array_elements_text(v_active_ids)
  limit 1;

  -- Rebuild order from current queue while removing target and keeping active players.
  select coalesce(array_agg(value), array[]::text[])
    into v_existing_order
  from jsonb_array_elements_text(coalesce(v_game.player_order, '[]'::jsonb));

  foreach v_order_id in array v_existing_order loop
    if v_order_id <> p_target_player_id::text
       and (v_active_ids @> jsonb_build_array(v_order_id))
       and not (v_base_order @> array[v_order_id]) then
      v_base_order := array_append(v_base_order, v_order_id);
    end if;
  end loop;

  -- Add any active players missing from prior order, by join order.
  for v_order_id in
    select p.id::text
    from public.lobby_players p
    where p.lobby_id = v_ctx.lobby_id
    order by p.created_at
  loop
    if not (v_base_order @> array[v_order_id]) then
      v_base_order := array_append(v_base_order, v_order_id);
    end if;
  end loop;

  v_new_order := v_base_order;

  -- If target was current/next drawer, put remover into target's queue slot.
  if v_force_remover_next_draw and array_position(v_base_order, v_ctx.player_id::text) is not null then
    v_new_order := array_remove(v_base_order, v_ctx.player_id::text);
    v_insert_pos := least(
      greatest(coalesce(v_target_turn_pos, 1), 1),
      coalesce(array_length(v_new_order, 1), 0) + 1
    );
    v_new_order :=
      coalesce(v_new_order[1:v_insert_pos - 1], array[]::text[])
      || array[v_ctx.player_id::text]
      || coalesce(v_new_order[v_insert_pos:array_length(v_new_order, 1)], array[]::text[]);
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by ord), '[]'::jsonb)
    into v_new_order_jsonb
  from unnest(v_new_order) with ordinality as u(x, ord);

  v_caller_turn_pos := array_position(v_new_order, v_ctx.player_id::text);

  -- Keep round guesser list aligned with active players.
  if v_game.current_round_id is not null then
    select * into v_round
    from public.draw_wf_rounds
    where id = v_game.current_round_id
    for update;

    if found then
      select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
        into v_filtered_guessers
      from (
        select distinct value as x
        from jsonb_array_elements_text(coalesce(v_round.guesser_ids, '[]'::jsonb))
        where value in (
          select p.id::text
          from public.lobby_players p
          where p.lobby_id = v_ctx.lobby_id
        )
      ) filtered;

      update public.draw_wf_rounds
      set guesser_ids = v_filtered_guessers
      where id = v_round.id;
    end if;
  end if;

  -- Base sanitize update.
  update public.draw_wf_games g
  set player_order = coalesce(v_new_order_jsonb, public.rd_player_order(v_ctx.lobby_id)),
      waiting_on = (
        select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
        from (
          select distinct value as x
          from jsonb_array_elements_text(coalesce(g.waiting_on, '[]'::jsonb))
          where value in (
            select p.id::text
            from public.lobby_players p
            where p.lobby_id = v_ctx.lobby_id
          )
        ) filtered_waiting
      ),
      turn_index = mod(coalesce(g.turn_index, 0), greatest(v_player_count, 1)),
      last_activity_at = now(),
      last_error = null
  where g.lobby_id = v_ctx.lobby_id;

  select * into v_game
  from public.draw_wf_games
  where lobby_id = v_ctx.lobby_id
  for update;

  -- Critical behavior: if removed player was current/next drawer, remover is immediate next drawer.
  if v_force_remover_next_draw and v_caller_turn_pos is not null then
    update public.draw_wf_games
    set phase = 'round_result',
        waiting_on = jsonb_build_array(v_ctx.player_id::text),
        turn_index = (v_caller_turn_pos - 2), -- continue() adds +1 before start_round()
        current_round_id = null,
        last_activity_at = now(),
        last_error = null
    where lobby_id = v_ctx.lobby_id;

    return public.dwf_get_state(p_game_code, p_player_token);
  end if;

  -- Non-drawer removals: keep phase stable; do not jump users out of active screens.
  if v_game.phase = 'guess_intro' and jsonb_array_length(coalesce(v_game.waiting_on, '[]'::jsonb)) = 0 then
    update public.draw_wf_games
    set phase = 'guess_live',
        waiting_on = coalesce(v_filtered_guessers, '[]'::jsonb),
        last_activity_at = now(),
        last_error = null
    where lobby_id = v_ctx.lobby_id;
  elsif v_game.phase = 'guess_live' and jsonb_array_length(coalesce(v_game.waiting_on, '[]'::jsonb)) = 0 then
    if jsonb_array_length(coalesce(v_filtered_guessers, '[]'::jsonb)) > 0 then
      -- Keep active guessers in guess flow; no forced result jump.
      update public.draw_wf_games
      set waiting_on = coalesce(v_filtered_guessers, '[]'::jsonb),
          last_activity_at = now(),
          last_error = null
      where lobby_id = v_ctx.lobby_id;
    else
      -- Nobody left to guess; safe to resolve.
      perform public.dwf_resolve_round(v_ctx.lobby_id);
    end if;
  elsif v_game.phase = 'round_result' and jsonb_array_length(coalesce(v_game.waiting_on, '[]'::jsonb)) = 0 then
    update public.draw_wf_games
    set waiting_on = case when v_first_active is null then '[]'::jsonb else jsonb_build_array(v_first_active) end,
        last_activity_at = now(),
        last_error = null
    where lobby_id = v_ctx.lobby_id;
  end if;

  return public.dwf_get_state(p_game_code, p_player_token);
end;
$$;

grant execute on function public.dwf_remove_player(text, text, uuid) to anon, authenticated;
