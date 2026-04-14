-- Fake Famous: only active player advances truth_result and turn_result

create or replace function public.rd_submit_truth_vote(p_game_code text, p_player_token text, p_choice text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.really_donald_games%rowtype;
  v_votes jsonb;
  v_truth text;
  v_winners jsonb;
  v_non_active_count integer;
  v_vote_count integer;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.rd_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  if lower(trim(p_choice)) not in ('real', 'fake') then
    raise exception 'Invalid vote choice.';
  end if;

  select * into v_game from public.really_donald_games where lobby_id = v_ctx.lobby_id;
  if not found or v_game.phase <> 'truth_vote' then
    raise exception 'Truth vote is not active.';
  end if;
  if v_ctx.player_id = v_game.active_player_id then
    raise exception 'Active player does not vote in this phase.';
  end if;

  v_votes := jsonb_set(coalesce(v_game.truth_votes, '{}'::jsonb), array[v_ctx.player_id::text], to_jsonb(lower(trim(p_choice))), true);

  update public.really_donald_games
  set truth_votes = v_votes,
      last_error = null
  where lobby_id = v_ctx.lobby_id;

  v_non_active_count := public.rd_player_count(v_game.player_order) - 1;
  select count(*) into v_vote_count from jsonb_each_text(v_votes);

  if v_vote_count < v_non_active_count then
    return public.rd_get_state(p_game_code, p_player_token);
  end if;

  v_truth := case when coalesce((v_game.current_card ->> 'isReal')::boolean, false) then 'real' else 'fake' end;

  select coalesce(jsonb_agg(key), '[]'::jsonb)
  into v_winners
  from jsonb_each_text(v_votes)
  where value = v_truth;

  update public.really_donald_games
  set phase = 'truth_result',
      truth_winners = v_winners,
      scores = public.rd_increment_scores(scores, v_winners),
      waiting_on = jsonb_build_array(v_game.active_player_id::text),
      last_error = null
  where lobby_id = v_ctx.lobby_id;

  return public.rd_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.rd_submit_speaker_vote(p_game_code text, p_player_token text, p_speaker text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.really_donald_games%rowtype;
  v_votes jsonb;
  v_correct text;
  v_winners jsonb;
  v_non_active_count integer;
  v_vote_count integer;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.rd_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_game from public.really_donald_games where lobby_id = v_ctx.lobby_id;
  if not found or v_game.phase <> 'speaker_vote' then
    raise exception 'Speaker vote is not active.';
  end if;
  if v_ctx.player_id = v_game.active_player_id then
    raise exception 'Active player does not vote in this phase.';
  end if;

  if not exists (
    select 1
    from jsonb_array_elements_text(coalesce(v_game.current_card -> 'speakerOptions', '[]'::jsonb)) as o(value)
    where o.value = p_speaker
  ) then
    raise exception 'Invalid speaker option.';
  end if;

  v_votes := jsonb_set(coalesce(v_game.speaker_votes, '{}'::jsonb), array[v_ctx.player_id::text], to_jsonb(p_speaker), true);

  update public.really_donald_games
  set speaker_votes = v_votes,
      last_error = null
  where lobby_id = v_ctx.lobby_id;

  v_non_active_count := public.rd_player_count(v_game.player_order) - 1;
  select count(*) into v_vote_count from jsonb_each_text(v_votes);

  if v_vote_count < v_non_active_count then
    return public.rd_get_state(p_game_code, p_player_token);
  end if;

  v_correct := coalesce(v_game.current_card ->> 'correctSpeaker', '');

  select coalesce(jsonb_agg(key), '[]'::jsonb)
  into v_winners
  from jsonb_each_text(v_votes)
  where value = v_correct;

  update public.really_donald_games
  set phase = 'turn_result',
      speaker_winners = v_winners,
      scores = public.rd_increment_scores(scores, v_winners),
      waiting_on = jsonb_build_array(v_game.active_player_id::text),
      last_error = null
  where lobby_id = v_ctx.lobby_id;

  return public.rd_get_state(p_game_code, p_player_token);
end;
$$;

grant execute on function public.rd_submit_truth_vote(text, text, text) to anon, authenticated;
grant execute on function public.rd_submit_speaker_vote(text, text, text) to anon, authenticated;

