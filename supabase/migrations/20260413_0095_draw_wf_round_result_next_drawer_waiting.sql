-- Draw WF: round_result should wait on next drawer, not previous drawer

create or replace function public.dwf_resolve_round(p_lobby_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.draw_wf_games%rowtype;
  v_round public.draw_wf_rounds%rowtype;
  v_guesser text;
  v_all_correct boolean := true;
  v_has_blocking boolean := false;
  v_curr integer;
  v_long integer;
  v_order jsonb;
  v_count integer;
  v_next_drawer_idx integer;
  v_next_drawer_id uuid;
begin
  select * into v_game from public.draw_wf_games where lobby_id = p_lobby_id for update;
  if not found or v_game.current_round_id is null then return; end if;

  select * into v_round from public.draw_wf_rounds where id = v_game.current_round_id for update;
  if not found then return; end if;

  for v_guesser in select jsonb_array_elements_text(coalesce(v_round.guesser_ids,'[]'::jsonb)) loop
    v_has_blocking := true;
    if not exists (
      select 1 from public.draw_wf_guesses g
      where g.round_id = v_round.id
        and g.player_id::text = v_guesser
        and g.is_blocking = true
    ) then
      insert into public.draw_wf_guesses (round_id, player_id, guess_value, is_correct, is_blocking)
      values (v_round.id, v_guesser::uuid, '', false, true)
      on conflict (round_id, player_id)
      do nothing;
      v_all_correct := false;
    else
      if exists (
        select 1 from public.draw_wf_guesses g
        where g.round_id = v_round.id
          and g.player_id::text = v_guesser
          and g.is_blocking = true
          and g.is_correct = false
      ) then
        v_all_correct := false;
      end if;
    end if;
  end loop;

  if not v_has_blocking then
    v_all_correct := true;
  end if;

  if v_all_correct then
    v_curr := coalesce(v_game.current_streak, 0) + 1;
  else
    v_curr := 0;
  end if;
  v_long := greatest(coalesce(v_game.longest_streak,0), v_curr);

  v_order := public.rd_player_order(p_lobby_id);
  v_count := public.rd_player_count(v_order);
  if v_count > 0 then
    v_next_drawer_idx := mod(v_game.turn_index + 1, v_count);
    v_next_drawer_id := public.rd_player_at(v_order, v_next_drawer_idx);
  else
    v_next_drawer_id := null;
  end if;

  update public.draw_wf_rounds
  set all_correct = v_all_correct,
      closed_at = now()
  where id = v_round.id;

  update public.draw_wf_games
  set phase = 'round_result',
      waiting_on = case when v_next_drawer_id is null then '[]'::jsonb else jsonb_build_array(v_next_drawer_id::text) end,
      player_order = v_order,
      current_streak = v_curr,
      longest_streak = v_long,
      last_activity_at = now(),
      last_error = null
  where lobby_id = p_lobby_id;
end;
$$;

grant execute on function public.dwf_resolve_round(uuid) to anon, authenticated;
