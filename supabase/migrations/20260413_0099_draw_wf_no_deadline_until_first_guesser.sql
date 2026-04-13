-- Draw WF: prevent auto-resolve while drawer is sharing and no guessers have joined yet
-- Start guess deadline only when there is at least one active guesser.

create or replace function public.dwf_submit_drawing(p_game_code text, p_player_token text, p_replay_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.draw_wf_games%rowtype;
  v_round public.draw_wf_rounds%rowtype;
  v_guesser_count integer := 0;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.dwf_player_context(p_game_code, p_player_token);
  if not found then raise exception 'Session expired.'; end if;

  select * into v_game from public.draw_wf_games where lobby_id = v_ctx.lobby_id for update;
  if not found or v_game.phase <> 'draw_live' then
    raise exception 'Drawing is not active.';
  end if;

  select * into v_round from public.draw_wf_rounds where id = v_game.current_round_id for update;
  if not found or v_round.drawer_player_id <> v_ctx.player_id then
    raise exception 'Only the current drawer can submit.';
  end if;

  v_guesser_count := jsonb_array_length(coalesce(v_round.guesser_ids, '[]'::jsonb));

  update public.draw_wf_rounds
  set replay_payload = p_replay_payload,
      guess_deadline_at = case when v_guesser_count > 0 then now() + interval '10 seconds' else null end
  where id = v_round.id;

  update public.draw_wf_games
  set phase = 'guess_live',
      waiting_on = coalesce(v_round.guesser_ids, '[]'::jsonb),
      last_activity_at = now(),
      last_error = null
  where lobby_id = v_ctx.lobby_id;

  return public.dwf_get_state(p_game_code, p_player_token);
end;
$$;

grant execute on function public.dwf_submit_drawing(text, text, jsonb) to anon, authenticated;
