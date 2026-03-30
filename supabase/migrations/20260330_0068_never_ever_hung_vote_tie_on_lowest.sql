-- Never Ever: treat any tie on the least-selected option as a hung vote.
-- This avoids arbitrary tie-break picking when two+ options are equally least.

create or replace function public.ne_submit_vote(p_game_code text, p_player_token text, p_choice text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.never_ever_games%rowtype;
  v_votes jsonb;
  v_vote_count integer;
  v_player_count integer;
  v_called_option text;
  v_called_out jsonb;
  v_waiting jsonb;
  v_min_count integer;
  v_min_option_count integer;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.ne_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  if p_choice not in ('Again', 'Never again', 'Maybe?', 'Never ever') then
    raise exception 'Invalid choice.';
  end if;

  select * into v_game
  from public.never_ever_games
  where lobby_id = v_ctx.lobby_id
  for update;

  if not found or v_game.phase <> 'vote' then
    raise exception 'Voting is not active.';
  end if;

  v_votes := case
    when jsonb_typeof(coalesce(v_game.votes, '{}'::jsonb)) = 'object' then coalesce(v_game.votes, '{}'::jsonb)
    else '{}'::jsonb
  end;

  v_votes := jsonb_set(v_votes, array[v_ctx.player_id::text], to_jsonb(p_choice), true);

  update public.never_ever_games
  set votes = v_votes
  where lobby_id = v_ctx.lobby_id;

  select count(*) into v_vote_count
  from jsonb_each_text(v_votes);

  v_player_count := public.rd_player_count(v_game.player_order);
  if v_vote_count < v_player_count then
    return public.ne_get_state(p_game_code, p_player_token);
  end if;

  with counts as (
    select value as choice, count(*) as c
    from jsonb_each_text(v_votes)
    group by value
  )
  select min(c) into v_min_count
  from counts;

  with counts as (
    select value as choice, count(*) as c
    from jsonb_each_text(v_votes)
    group by value
  )
  select count(*) into v_min_option_count
  from counts
  where c = v_min_count;

  if coalesce(v_min_option_count, 0) > 1 then
    v_called_option := 'Hung vote, no one gets called out this time...';
    v_called_out := '[]'::jsonb;
    v_waiting := jsonb_build_array(v_game.current_reader_id::text);
  else
    with counts as (
      select value as choice, count(*) as c
      from jsonb_each_text(v_votes)
      group by value
    )
    select choice
    into v_called_option
    from counts
    where c = v_min_count
    order by
      case choice
        when 'Again' then 1
        when 'Never again' then 2
        when 'Maybe?' then 3
        when 'Never ever' then 4
        else 5
      end
    limit 1;

    select coalesce(jsonb_agg(key), '[]'::jsonb)
    into v_called_out
    from jsonb_each_text(v_votes)
    where value = v_called_option;

    if jsonb_array_length(v_called_out) = 0 then
      v_waiting := jsonb_build_array(v_game.current_reader_id::text);
    else
      v_waiting := v_called_out;
    end if;
  end if;

  update public.never_ever_games
  set phase = 'callout',
      called_out = v_called_out,
      called_out_option = v_called_option,
      waiting_on = v_waiting,
      callout_counts = public.ne_increment_counts(v_game.callout_counts, v_called_out),
      last_error = null
  where lobby_id = v_ctx.lobby_id;

  return public.ne_get_state(p_game_code, p_player_token);
end;
$$;

