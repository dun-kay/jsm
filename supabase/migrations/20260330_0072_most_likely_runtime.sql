-- Most Likely runtime

create table if not exists public.most_likely_games (
  lobby_id uuid primary key references public.game_lobbies(id) on delete cascade,
  phase text not null default 'rules' check (phase in ('rules', 'card_reveal', 'pair_vote', 'group_vote', 'turn_result', 'result')),
  waiting_on jsonb not null default '[]'::jsonb,
  player_order jsonb not null default '[]'::jsonb,
  turn_index integer not null default 0,
  round_number integer not null default 1,
  card_pool jsonb not null default '[]'::jsonb,
  deck jsonb not null default '[]'::jsonb,
  current_card text,
  current_reader_id uuid references public.lobby_players(id) on delete set null,
  pair_player_a_id uuid references public.lobby_players(id) on delete set null,
  pair_player_b_id uuid references public.lobby_players(id) on delete set null,
  pair_votes jsonb not null default '{}'::jsonb,
  group_votes jsonb not null default '{}'::jsonb,
  group_mode text check (group_mode in ('consensus', 'split')),
  proposed_winner_id uuid references public.lobby_players(id) on delete set null,
  winner_ids jsonb not null default '[]'::jsonb,
  penalty_counts jsonb not null default '{}'::jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_most_likely_games_updated_at on public.most_likely_games;
create trigger set_most_likely_games_updated_at
before update on public.most_likely_games
for each row execute function public.set_updated_at();

alter table public.most_likely_games enable row level security;
revoke all on table public.most_likely_games from anon, authenticated;

create or replace function public.ml_player_context(p_game_code text, p_player_token text)
returns table(
  lobby_id uuid,
  game_slug text,
  lobby_status text,
  player_id uuid,
  player_name text,
  is_host boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query select * from public.sc_player_context(p_game_code, p_player_token);
end;
$$;

create or replace function public.ml_active_player_ids(p_lobby_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(p.id::text) order by p.created_at), '[]'::jsonb)
  from public.lobby_players p
  where p.lobby_id = p_lobby_id;
$$;

create or replace function public.ml_remove_waiting(p_waiting jsonb, p_player_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(value) filter (where value <> to_jsonb(p_player_id::text)), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_waiting, '[]'::jsonb));
$$;

create or replace function public.ml_increment_counts(p_counts jsonb, p_player_ids jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_counts jsonb := coalesce(p_counts, '{}'::jsonb);
  v_id text;
  v_curr integer;
begin
  for v_id in select jsonb_array_elements_text(coalesce(p_player_ids, '[]'::jsonb)) loop
    v_curr := coalesce((v_counts ->> v_id)::integer, 0);
    v_counts := jsonb_set(v_counts, array[v_id], to_jsonb(v_curr + 1), true);
  end loop;
  return v_counts;
end;
$$;

create or replace function public.ml_sample_cards(p_cards jsonb, p_required_count integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cards jsonb := coalesce(p_cards, '[]'::jsonb);
  v_deck jsonb;
begin
  if jsonb_typeof(v_cards) <> 'array' then
    raise exception 'Cards must be an array.';
  end if;

  if jsonb_array_length(v_cards) < p_required_count then
    raise exception 'Need at least % cards.', p_required_count;
  end if;

  with picked as (
    select value
    from jsonb_array_elements(v_cards)
    order by random()
    limit p_required_count
  )
  select coalesce(jsonb_agg(value), '[]'::jsonb) into v_deck
  from picked;

  return v_deck;
end;
$$;

create or replace function public.ml_random_pair(p_player_order jsonb, p_reader_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pair jsonb;
begin
  with ids as (
    select value::uuid as id
    from jsonb_array_elements_text(coalesce(p_player_order, '[]'::jsonb))
    where value::uuid <> p_reader_id
  ),
  picked as (
    select id::text
    from ids
    order by random()
    limit 2
  )
  select coalesce(jsonb_agg(to_jsonb(id)), '[]'::jsonb) into v_pair
  from picked;

  if jsonb_array_length(v_pair) <> 2 then
    raise exception 'Need at least 3 players for Most Likely.';
  end if;

  return v_pair;
end;
$$;

create or replace function public.ml_prepare_turn(p_lobby_id uuid, p_reader_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.most_likely_games%rowtype;
  v_reader_id uuid;
  v_pair jsonb;
  v_card text;
  v_max_cards integer;
begin
  select * into v_game
  from public.most_likely_games
  where lobby_id = p_lobby_id
  for update;

  if not found then
    return;
  end if;

  v_max_cards := least(18, coalesce(jsonb_array_length(coalesce(v_game.deck, '[]'::jsonb)), 0));
  if v_max_cards <= 0 or v_game.turn_index >= v_max_cards then
    update public.most_likely_games
    set phase = 'result',
        waiting_on = '[]'::jsonb
    where lobby_id = p_lobby_id;
    return;
  end if;

  if p_reader_id is null then
    select value::uuid into v_reader_id
    from jsonb_array_elements_text(v_game.player_order)
    order by random()
    limit 1;
  else
    v_reader_id := p_reader_id;
  end if;

  v_pair := public.ml_random_pair(v_game.player_order, v_reader_id);
  v_card := coalesce(v_game.deck ->> v_game.turn_index, null);

  update public.most_likely_games
  set phase = 'card_reveal',
      round_number = floor((v_game.turn_index)::numeric / 9)::integer + 1,
      current_card = v_card,
      current_reader_id = v_reader_id,
      pair_player_a_id = (v_pair ->> 0)::uuid,
      pair_player_b_id = (v_pair ->> 1)::uuid,
      pair_votes = '{}'::jsonb,
      group_votes = '{}'::jsonb,
      group_mode = null,
      proposed_winner_id = null,
      winner_ids = '[]'::jsonb,
      waiting_on = jsonb_build_array(v_reader_id::text),
      last_error = null
  where lobby_id = p_lobby_id;
end;
$$;

create or replace function public.ml_get_state(p_game_code text, p_player_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.most_likely_games%rowtype;
  v_players jsonb;
  v_counts jsonb;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.ml_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_game
  from public.most_likely_games
  where lobby_id = v_ctx.lobby_id;

  if not found then
    return public.ml_init_game(p_game_code, p_player_token, null);
  end if;

  v_counts := coalesce(v_game.penalty_counts, '{}'::jsonb);

  with ordered as (
    select ordinality - 1 as idx, value::text as player_id_text
    from jsonb_array_elements_text(v_game.player_order) with ordinality
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'name', p.display_name,
        'isHost', p.is_host,
        'turnOrder', o.idx,
        'penaltyCount', coalesce((v_counts ->> p.id::text)::integer, 0)
      )
      order by o.idx
    ),
    '[]'::jsonb
  )
  into v_players
  from ordered o
  join public.lobby_players p
    on p.lobby_id = v_ctx.lobby_id
   and p.id::text = o.player_id_text;

  return jsonb_build_object(
    'phase', v_game.phase,
    'turnIndex', v_game.turn_index,
    'roundNumber', v_game.round_number,
    'currentCard', v_game.current_card,
    'currentReaderId', v_game.current_reader_id,
    'pairPlayerAId', v_game.pair_player_a_id,
    'pairPlayerBId', v_game.pair_player_b_id,
    'pairVotes', coalesce(v_game.pair_votes, '{}'::jsonb),
    'groupVotes', coalesce(v_game.group_votes, '{}'::jsonb),
    'groupMode', v_game.group_mode,
    'proposedWinnerId', v_game.proposed_winner_id,
    'winnerIds', coalesce(v_game.winner_ids, '[]'::jsonb),
    'waitingOn', coalesce(v_game.waiting_on, '[]'::jsonb),
    'penaltyCounts', v_counts,
    'players', v_players,
    'lastError', v_game.last_error,
    'you', jsonb_build_object(
      'id', v_ctx.player_id,
      'name', v_ctx.player_name,
      'isHost', v_ctx.is_host,
      'penaltyCount', coalesce((v_counts ->> v_ctx.player_id::text)::integer, 0)
    )
  );
end;
$$;

create or replace function public.ml_init_game(p_game_code text, p_player_token text, p_card_pool jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_pool jsonb;
  v_deck jsonb;
  v_order jsonb;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.ml_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  if v_ctx.game_slug <> 'most-likely' then
    raise exception 'Game mismatch.';
  end if;

  if v_ctx.lobby_status <> 'started' then
    raise exception 'Game has not started.';
  end if;

  if exists (select 1 from public.most_likely_games g where g.lobby_id = v_ctx.lobby_id) then
    return public.ml_get_state(p_game_code, p_player_token);
  end if;

  if v_ctx.is_host is false then
    raise exception 'Host must initialize this game first.';
  end if;

  v_pool := coalesce(p_card_pool, '[]'::jsonb);
  v_deck := public.ml_sample_cards(v_pool, 18);
  v_order := public.rd_player_order(v_ctx.lobby_id);

  insert into public.most_likely_games (
    lobby_id, phase, waiting_on, player_order, turn_index, round_number, card_pool, deck,
    current_card, current_reader_id, pair_player_a_id, pair_player_b_id, pair_votes, group_votes,
    group_mode, proposed_winner_id, winner_ids, penalty_counts, last_error
  )
  values (
    v_ctx.lobby_id, 'rules', public.ml_active_player_ids(v_ctx.lobby_id), v_order, 0, 1, v_pool, v_deck,
    null, null, null, null, '{}'::jsonb, '{}'::jsonb, null, null, '[]'::jsonb, public.rd_zero_scores(v_order), null
  );

  return public.ml_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.ml_continue(p_game_code text, p_player_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.most_likely_games%rowtype;
  v_waiting jsonb;
  v_next_turn integer;
  v_next_reader uuid;
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

  if not found then
    raise exception 'Game runtime not initialized.';
  end if;

  if not (coalesce(v_game.waiting_on, '[]'::jsonb) @> jsonb_build_array(v_ctx.player_id::text)) then
    return public.ml_get_state(p_game_code, p_player_token);
  end if;

  if v_game.phase in ('rules', 'card_reveal') then
    v_waiting := public.ml_remove_waiting(v_game.waiting_on, v_ctx.player_id);
    update public.most_likely_games set waiting_on = v_waiting where lobby_id = v_ctx.lobby_id;

    if jsonb_array_length(v_waiting) = 0 then
      if v_game.phase = 'rules' then
        perform public.ml_prepare_turn(v_ctx.lobby_id, null);
      else
        update public.most_likely_games
        set phase = 'pair_vote',
            waiting_on = jsonb_build_array(v_game.pair_player_a_id::text, v_game.pair_player_b_id::text),
            pair_votes = '{}'::jsonb,
            last_error = null
        where lobby_id = v_ctx.lobby_id;
      end if;
    end if;
  elsif v_game.phase = 'turn_result' then
    v_next_turn := v_game.turn_index + 1;
    if v_next_turn >= 18 then
      update public.most_likely_games
      set turn_index = v_next_turn,
          phase = 'result',
          waiting_on = '[]'::jsonb
      where lobby_id = v_ctx.lobby_id;
      return public.ml_get_state(p_game_code, p_player_token);
    end if;

    select value::uuid into v_next_reader
    from jsonb_array_elements_text(coalesce(v_game.winner_ids, '[]'::jsonb))
    order by random()
    limit 1;

    if v_next_reader is null then
      v_next_reader := v_game.current_reader_id;
    end if;

    update public.most_likely_games
    set turn_index = v_next_turn
    where lobby_id = v_ctx.lobby_id;

    perform public.ml_prepare_turn(v_ctx.lobby_id, v_next_reader);
  end if;

  return public.ml_get_state(p_game_code, p_player_token);
end;
$$;

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

  if p_choice = 'me' then
    v_target := v_ctx.player_id;
  else
    v_target := case
      when v_ctx.player_id = v_game.pair_player_a_id then v_game.pair_player_b_id
      else v_game.pair_player_a_id
    end;
  end if;

  v_votes := case
    when jsonb_typeof(coalesce(v_game.pair_votes, '{}'::jsonb)) = 'object' then coalesce(v_game.pair_votes, '{}'::jsonb)
    else '{}'::jsonb
  end;
  v_votes := jsonb_set(v_votes, array[v_ctx.player_id::text], to_jsonb(v_target::text), true);

  update public.most_likely_games
  set pair_votes = v_votes
  where lobby_id = v_ctx.lobby_id;

  if jsonb_object_length(v_votes) < 2 then
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

create or replace function public.ml_play_again(p_game_code text, p_player_token text, p_card_pool jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.most_likely_games%rowtype;
  v_pool jsonb;
  v_order jsonb;
  v_deck jsonb;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.ml_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;
  if v_ctx.is_host is false then
    raise exception 'Only host can play again.';
  end if;

  select * into v_game from public.most_likely_games where lobby_id = v_ctx.lobby_id;
  if not found then
    raise exception 'Game runtime not initialized.';
  end if;

  v_pool := coalesce(p_card_pool, v_game.card_pool);
  v_order := public.rd_player_order(v_ctx.lobby_id);
  v_deck := public.ml_sample_cards(v_pool, 18);

  update public.most_likely_games
  set phase = 'rules',
      waiting_on = public.ml_active_player_ids(v_ctx.lobby_id),
      player_order = v_order,
      turn_index = 0,
      round_number = 1,
      card_pool = v_pool,
      deck = v_deck,
      current_card = null,
      current_reader_id = null,
      pair_player_a_id = null,
      pair_player_b_id = null,
      pair_votes = '{}'::jsonb,
      group_votes = '{}'::jsonb,
      group_mode = null,
      proposed_winner_id = null,
      winner_ids = '[]'::jsonb,
      penalty_counts = public.rd_zero_scores(v_order),
      last_error = null
  where lobby_id = v_ctx.lobby_id;

  return public.ml_get_state(p_game_code, p_player_token);
end;
$$;

grant execute on function public.ml_player_context(text, text) to anon, authenticated;
grant execute on function public.ml_active_player_ids(uuid) to anon, authenticated;
grant execute on function public.ml_remove_waiting(jsonb, uuid) to anon, authenticated;
grant execute on function public.ml_increment_counts(jsonb, jsonb) to anon, authenticated;
grant execute on function public.ml_sample_cards(jsonb, integer) to anon, authenticated;
grant execute on function public.ml_random_pair(jsonb, uuid) to anon, authenticated;
grant execute on function public.ml_prepare_turn(uuid, uuid) to anon, authenticated;
grant execute on function public.ml_get_state(text, text) to anon, authenticated;
grant execute on function public.ml_init_game(text, text, jsonb) to anon, authenticated;
grant execute on function public.ml_continue(text, text) to anon, authenticated;
grant execute on function public.ml_submit_pair_vote(text, text, text) to anon, authenticated;
grant execute on function public.ml_submit_group_vote(text, text, text) to anon, authenticated;
grant execute on function public.ml_play_again(text, text, jsonb) to anon, authenticated;

