-- Most Likely hardening:
-- - avoid jsonb_object_length dependency
-- - idempotent vote writes (ignore duplicates from same player)

create or replace function public.ml_submit_pair_vote(p_game_code text, p_player_token text, p_choice text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.most_likely_games%rowtype;
  v_votes jsonb;
  v_vote_count integer;
  v_target uuid;
  v_a_vote uuid;
  v_b_vote uuid;
  v_waiting jsonb;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.ml_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  if p_choice not in ('me', 'them') then
    raise exception 'Invalid pair vote.';
  end if;

  select * into v_game
  from public.most_likely_games
  where lobby_id = v_ctx.lobby_id
  for update;

  if not found or v_game.phase <> 'pair_vote' then
    raise exception 'Pair vote is not active.';
  end if;

  if v_ctx.player_id not in (v_game.pair_player_a_id, v_game.pair_player_b_id) then
    raise exception 'Only selected players can vote now.';
  end if;

  v_votes := case
    when jsonb_typeof(coalesce(v_game.pair_votes, '{}'::jsonb)) = 'object' then coalesce(v_game.pair_votes, '{}'::jsonb)
    else '{}'::jsonb
  end;

  -- Duplicate submit from same player: return current state (no extra write).
  if (v_votes ? v_ctx.player_id::text) then
    return public.ml_get_state(p_game_code, p_player_token);
  end if;

  if p_choice = 'me' then
    v_target := v_ctx.player_id;
  else
    v_target := case
      when v_ctx.player_id = v_game.pair_player_a_id then v_game.pair_player_b_id
      else v_game.pair_player_a_id
    end;
  end if;

  v_votes := jsonb_set(v_votes, array[v_ctx.player_id::text], to_jsonb(v_target::text), true);

  update public.most_likely_games
  set pair_votes = v_votes
  where lobby_id = v_ctx.lobby_id;

  select count(*) into v_vote_count
  from jsonb_each_text(v_votes);

  if v_vote_count < 2 then
    return public.ml_get_state(p_game_code, p_player_token);
  end if;

  v_a_vote := (v_votes ->> v_game.pair_player_a_id::text)::uuid;
  v_b_vote := (v_votes ->> v_game.pair_player_b_id::text)::uuid;

  with ids as (
    select value::text as id
    from jsonb_array_elements_text(v_game.player_order)
  )
  select coalesce(jsonb_agg(to_jsonb(id)), '[]'::jsonb)
  into v_waiting
  from ids
  where id <> v_game.pair_player_a_id::text
    and id <> v_game.pair_player_b_id::text;

  if v_a_vote = v_b_vote then
    update public.most_likely_games
    set phase = 'group_vote',
        group_mode = 'consensus',
        proposed_winner_id = v_a_vote,
        group_votes = '{}'::jsonb,
        waiting_on = v_waiting,
        last_error = null
    where lobby_id = v_ctx.lobby_id;
  else
    update public.most_likely_games
    set phase = 'group_vote',
        group_mode = 'split',
        proposed_winner_id = null,
        group_votes = '{}'::jsonb,
        waiting_on = v_waiting,
        last_error = null
    where lobby_id = v_ctx.lobby_id;
  end if;

  return public.ml_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.ml_submit_group_vote(p_game_code text, p_player_token text, p_choice text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.most_likely_games%rowtype;
  v_votes jsonb;
  v_vote_count integer;
  v_waiting_count integer;
  v_yes integer;
  v_no integer;
  v_a integer;
  v_b integer;
  v_winners jsonb;
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

  if not found or v_game.phase <> 'group_vote' then
    raise exception 'Group vote is not active.';
  end if;

  if not (coalesce(v_game.waiting_on, '[]'::jsonb) @> jsonb_build_array(v_ctx.player_id::text)) then
    raise exception 'Only validators can vote now.';
  end if;

  if v_game.group_mode = 'consensus' then
    if p_choice not in ('agree', 'disagree') then
      raise exception 'Invalid group vote.';
    end if;
  else
    if p_choice not in (v_game.pair_player_a_id::text, v_game.pair_player_b_id::text) then
      raise exception 'Invalid group vote.';
    end if;
  end if;

  v_votes := case
    when jsonb_typeof(coalesce(v_game.group_votes, '{}'::jsonb)) = 'object' then coalesce(v_game.group_votes, '{}'::jsonb)
    else '{}'::jsonb
  end;

  -- Duplicate submit from same validator: return current state (no extra write).
  if (v_votes ? v_ctx.player_id::text) then
    return public.ml_get_state(p_game_code, p_player_token);
  end if;

  v_votes := jsonb_set(v_votes, array[v_ctx.player_id::text], to_jsonb(p_choice), true);

  update public.most_likely_games
  set group_votes = v_votes
  where lobby_id = v_ctx.lobby_id;

  select count(*) into v_vote_count from jsonb_each_text(v_votes);
  v_waiting_count := jsonb_array_length(coalesce(v_game.waiting_on, '[]'::jsonb));
  if v_vote_count < v_waiting_count then
    return public.ml_get_state(p_game_code, p_player_token);
  end if;

  if v_game.group_mode = 'consensus' then
    select count(*) filter (where value = 'agree'),
           count(*) filter (where value = 'disagree')
    into v_yes, v_no
    from jsonb_each_text(v_votes);

    if v_yes = v_no then
      update public.most_likely_games
      set group_votes = '{}'::jsonb,
          last_error = 'Hung vote. Re-vote.'
      where lobby_id = v_ctx.lobby_id;
      return public.ml_get_state(p_game_code, p_player_token);
    end if;

    if v_yes > v_no then
      v_winners := jsonb_build_array(v_game.proposed_winner_id::text);
    else
      v_winners := jsonb_build_array(v_game.pair_player_a_id::text, v_game.pair_player_b_id::text);
    end if;
  else
    select count(*) filter (where value = v_game.pair_player_a_id::text),
           count(*) filter (where value = v_game.pair_player_b_id::text)
    into v_a, v_b
    from jsonb_each_text(v_votes);

    if v_a = v_b then
      update public.most_likely_games
      set group_votes = '{}'::jsonb,
          last_error = 'Hung vote. Re-vote.'
      where lobby_id = v_ctx.lobby_id;
      return public.ml_get_state(p_game_code, p_player_token);
    end if;

    if v_a > v_b then
      v_winners := jsonb_build_array(v_game.pair_player_a_id::text);
    else
      v_winners := jsonb_build_array(v_game.pair_player_b_id::text);
    end if;
  end if;

  update public.most_likely_games
  set phase = 'turn_result',
      winner_ids = v_winners,
      waiting_on = v_winners,
      penalty_counts = public.ml_increment_counts(v_game.penalty_counts, v_winners),
      last_error = null
  where lobby_id = v_ctx.lobby_id;

  return public.ml_get_state(p_game_code, p_player_token);
end;
$$;

