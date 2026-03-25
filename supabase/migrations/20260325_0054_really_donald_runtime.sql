-- Really Donald runtime (v1)

create or replace function public.start_game(p_game_code text, p_host_secret text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lobby public.game_lobbies%rowtype;
  v_player_count integer;
  v_min_players integer;
begin
  perform public.cleanup_lobby_presence(p_game_code);

  select *
  into v_lobby
  from public.game_lobbies
  where game_code = upper(trim(p_game_code))
    and host_secret = p_host_secret
    and status = 'lobby';

  if not found then
    raise exception 'Unable to start game.';
  end if;

  v_min_players := case
    when v_lobby.game_slug in ('murder-club', 'murder-clubs') then 4
    when v_lobby.game_slug in ('fruit-bowl', 'fruit-bowel') then 4
    when v_lobby.game_slug in ('popular-people', 'celebrities') then 2
    when v_lobby.game_slug = 'lying-llama' then 2
    when v_lobby.game_slug = 'really-donald' then 2
    when v_lobby.game_slug = 'secret-category' then 3
    else 3
  end;

  select count(*) into v_player_count
  from public.lobby_players
  where lobby_id = v_lobby.id;

  if v_player_count < v_min_players then
    raise exception 'At least % players are required to start.', v_min_players;
  end if;

  update public.game_lobbies
  set status = 'started', updated_at = now()
  where id = v_lobby.id;

  return true;
end;
$$;

grant execute on function public.start_game(text, text) to anon, authenticated;

create table if not exists public.really_donald_games (
  lobby_id uuid primary key references public.game_lobbies(id) on delete cascade,
  phase text not null default 'rules' check (
    phase in (
      'rules',
      'round_intro',
      'quote_reveal',
      'truth_vote',
      'truth_result',
      'impression',
      'speaker_vote',
      'turn_result',
      'round_result',
      'result'
    )
  ),
  waiting_on jsonb not null default '[]'::jsonb,
  player_order jsonb not null default '[]'::jsonb,
  quote_pool jsonb not null default '[]'::jsonb,
  deck jsonb not null default '[]'::jsonb,
  current_card jsonb,
  active_player_id uuid references public.lobby_players(id) on delete set null,
  round_number integer not null default 1,
  turn_index integer not null default 0,
  scores jsonb not null default '{}'::jsonb,
  truth_votes jsonb not null default '{}'::jsonb,
  speaker_votes jsonb not null default '{}'::jsonb,
  truth_winners jsonb not null default '[]'::jsonb,
  speaker_winners jsonb not null default '[]'::jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_really_donald_games_updated_at on public.really_donald_games;
create trigger set_really_donald_games_updated_at
before update on public.really_donald_games
for each row execute function public.set_updated_at();

alter table public.really_donald_games enable row level security;
revoke all on table public.really_donald_games from anon, authenticated;

create or replace function public.rd_player_context(p_game_code text, p_player_token text)
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
  return query
  select * from public.sc_player_context(p_game_code, p_player_token);
end;
$$;

create or replace function public.rd_remove_waiting(p_waiting jsonb, p_player_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(value) filter (where value <> to_jsonb(p_player_id::text)),
    '[]'::jsonb
  )
  from jsonb_array_elements(coalesce(p_waiting, '[]'::jsonb));
$$;

create or replace function public.rd_active_player_ids(p_lobby_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(p.id::text order by p.created_at), '[]'::jsonb)
  from public.lobby_players p
  where p.lobby_id = p_lobby_id;
$$;

create or replace function public.rd_player_order(p_lobby_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(p.id::text order by p.created_at), '[]'::jsonb)
  from public.lobby_players p
  where p.lobby_id = p_lobby_id;
$$;

create or replace function public.rd_shuffle_json(p_items jsonb)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(value order by random()), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb));
$$;

create or replace function public.rd_player_count(p_order jsonb)
returns integer
language sql
immutable
as $$
  select coalesce(jsonb_array_length(coalesce(p_order, '[]'::jsonb)), 0);
$$;

create or replace function public.rd_player_at(p_order jsonb, p_idx integer)
returns uuid
language sql
immutable
as $$
  select (p_order ->> p_idx)::uuid;
$$;

create or replace function public.rd_zero_scores(p_order jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_scores jsonb := '{}'::jsonb;
  v_id text;
begin
  for v_id in select jsonb_array_elements_text(coalesce(p_order, '[]'::jsonb)) loop
    v_scores := jsonb_set(v_scores, array[v_id], '0'::jsonb, true);
  end loop;
  return v_scores;
end;
$$;

create or replace function public.rd_increment_scores(p_scores jsonb, p_player_ids jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_scores jsonb := coalesce(p_scores, '{}'::jsonb);
  v_id text;
  v_curr integer;
begin
  for v_id in select jsonb_array_elements_text(coalesce(p_player_ids, '[]'::jsonb)) loop
    v_curr := coalesce((v_scores ->> v_id)::integer, 0);
    v_scores := jsonb_set(v_scores, array[v_id], to_jsonb(v_curr + 1), true);
  end loop;
  return v_scores;
end;
$$;

create or replace function public.rd_draw_card(p_quote_pool jsonb, p_deck jsonb)
returns table(card jsonb, next_deck jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deck jsonb := coalesce(p_deck, '[]'::jsonb);
  v_pool jsonb := coalesce(p_quote_pool, '[]'::jsonb);
begin
  if jsonb_array_length(v_pool) = 0 then
    raise exception 'Quote pool is empty.';
  end if;

  if jsonb_array_length(v_deck) = 0 then
    v_deck := public.rd_shuffle_json(v_pool);
  end if;

  card := v_deck -> 0;
  select coalesce(jsonb_agg(e.value order by e.ord), '[]'::jsonb)
  into next_deck
  from jsonb_array_elements(v_deck) with ordinality as e(value, ord)
  where e.ord > 1;

  return next;
end;
$$;

create or replace function public.rd_prepare_turn(p_lobby_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.really_donald_games%rowtype;
  v_player_count integer;
  v_active_idx integer;
  v_round integer;
  v_card jsonb;
  v_next_deck jsonb;
begin
  select * into v_game
  from public.really_donald_games
  where lobby_id = p_lobby_id
  for update;

  if not found then
    return;
  end if;

  v_player_count := public.rd_player_count(v_game.player_order);
  if v_player_count <= 0 then
    update public.really_donald_games
    set phase = 'result', waiting_on = '[]'::jsonb
    where lobby_id = p_lobby_id;
    return;
  end if;

  v_round := floor((v_game.turn_index)::numeric / v_player_count)::integer + 1;
  v_active_idx := mod(v_game.turn_index, v_player_count);

  select d.card, d.next_deck
  into v_card, v_next_deck
  from public.rd_draw_card(v_game.quote_pool, v_game.deck) d;

  update public.really_donald_games
  set phase = 'quote_reveal',
      round_number = v_round,
      active_player_id = public.rd_player_at(v_game.player_order, v_active_idx),
      current_card = v_card,
      deck = coalesce(v_next_deck, '[]'::jsonb),
      truth_votes = '{}'::jsonb,
      speaker_votes = '{}'::jsonb,
      truth_winners = '[]'::jsonb,
      speaker_winners = '[]'::jsonb,
      waiting_on = jsonb_build_array(public.rd_player_at(v_game.player_order, v_active_idx)::text),
      last_error = null
  where lobby_id = p_lobby_id;
end;
$$;

create or replace function public.rd_get_state(p_game_code text, p_player_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.really_donald_games%rowtype;
  v_players jsonb;
  v_scores jsonb;
  v_winner_ids jsonb;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.rd_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_game
  from public.really_donald_games
  where lobby_id = v_ctx.lobby_id;

  if not found then
    raise exception 'Game runtime not initialized.';
  end if;

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
        'score', coalesce((v_game.scores ->> p.id::text)::integer, 0)
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

  v_scores := coalesce(v_game.scores, '{}'::jsonb);

  with score_rows as (
    select p.id as player_id,
           coalesce((v_scores ->> p.id::text)::integer, 0) as score
    from public.lobby_players p
    where p.lobby_id = v_ctx.lobby_id
  ),
  max_score as (
    select max(score) as score from score_rows
  )
  select coalesce(jsonb_agg(sr.player_id::text), '[]'::jsonb)
  into v_winner_ids
  from score_rows sr
  join max_score ms on sr.score = ms.score;

  return jsonb_build_object(
    'phase', v_game.phase,
    'roundNumber', v_game.round_number,
    'turnIndex', v_game.turn_index,
    'activePlayerId', v_game.active_player_id,
    'players', v_players,
    'scores', v_scores,
    'currentCard', coalesce(v_game.current_card, '{}'::jsonb),
    'truthVotes', coalesce(v_game.truth_votes, '{}'::jsonb),
    'speakerVotes', coalesce(v_game.speaker_votes, '{}'::jsonb),
    'truthWinners', coalesce(v_game.truth_winners, '[]'::jsonb),
    'speakerWinners', coalesce(v_game.speaker_winners, '[]'::jsonb),
    'waitingOn', coalesce(v_game.waiting_on, '[]'::jsonb),
    'winnerIds', v_winner_ids,
    'lastError', v_game.last_error,
    'you', jsonb_build_object(
      'id', v_ctx.player_id,
      'name', v_ctx.player_name,
      'isHost', v_ctx.is_host,
      'score', coalesce((v_scores ->> v_ctx.player_id::text)::integer, 0)
    )
  );
end;
$$;

create or replace function public.rd_init_game(p_game_code text, p_player_token text, p_quotes jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_order jsonb;
  v_quotes jsonb;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.rd_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  if v_ctx.game_slug <> 'really-donald' then
    raise exception 'Game mismatch.';
  end if;

  if v_ctx.lobby_status <> 'started' then
    raise exception 'Game has not started.';
  end if;

  if exists (select 1 from public.really_donald_games g where g.lobby_id = v_ctx.lobby_id) then
    return public.rd_get_state(p_game_code, p_player_token);
  end if;

  if v_ctx.is_host is false then
    raise exception 'Host must initialize this game first.';
  end if;

  v_quotes := coalesce(p_quotes, '[]'::jsonb);
  if jsonb_typeof(v_quotes) <> 'array' or jsonb_array_length(v_quotes) = 0 then
    raise exception 'Quote pool is required.';
  end if;

  v_order := public.rd_player_order(v_ctx.lobby_id);

  insert into public.really_donald_games (
    lobby_id,
    phase,
    waiting_on,
    player_order,
    quote_pool,
    deck,
    current_card,
    active_player_id,
    round_number,
    turn_index,
    scores,
    truth_votes,
    speaker_votes,
    truth_winners,
    speaker_winners,
    last_error
  )
  values (
    v_ctx.lobby_id,
    'rules',
    public.rd_active_player_ids(v_ctx.lobby_id),
    v_order,
    v_quotes,
    public.rd_shuffle_json(v_quotes),
    null,
    public.rd_player_at(v_order, 0),
    1,
    0,
    public.rd_zero_scores(v_order),
    '{}'::jsonb,
    '{}'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    null
  );

  return public.rd_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.rd_continue(p_game_code text, p_player_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.really_donald_games%rowtype;
  v_waiting jsonb;
  v_player_count integer;
  v_total_turns integer;
  v_next_turn integer;
  v_next_round integer;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.rd_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_game from public.really_donald_games where lobby_id = v_ctx.lobby_id;
  if not found then
    raise exception 'Game runtime not initialized.';
  end if;

  if v_game.phase not in ('rules', 'round_intro', 'quote_reveal', 'truth_result', 'impression', 'turn_result', 'round_result') then
    raise exception 'Continue is not available right now.';
  end if;

  if not exists (
    select 1
    from jsonb_array_elements_text(coalesce(v_game.waiting_on, '[]'::jsonb)) as w(value)
    where w.value = v_ctx.player_id::text
  ) then
    raise exception 'Waiting for another player.';
  end if;

  v_waiting := public.rd_remove_waiting(v_game.waiting_on, v_ctx.player_id);
  update public.really_donald_games
  set waiting_on = v_waiting
  where lobby_id = v_ctx.lobby_id;

  if jsonb_array_length(v_waiting) > 0 then
    return public.rd_get_state(p_game_code, p_player_token);
  end if;

  if v_game.phase = 'rules' then
    update public.really_donald_games
    set phase = 'round_intro',
        waiting_on = public.rd_active_player_ids(v_ctx.lobby_id),
        last_error = null
    where lobby_id = v_ctx.lobby_id;
    return public.rd_get_state(p_game_code, p_player_token);
  end if;

  if v_game.phase = 'round_intro' then
    perform public.rd_prepare_turn(v_ctx.lobby_id);
    return public.rd_get_state(p_game_code, p_player_token);
  end if;

  if v_game.phase = 'quote_reveal' then
    update public.really_donald_games
    set phase = 'truth_vote',
        waiting_on = '[]'::jsonb,
        truth_votes = '{}'::jsonb,
        truth_winners = '[]'::jsonb,
        last_error = null
    where lobby_id = v_ctx.lobby_id;
    return public.rd_get_state(p_game_code, p_player_token);
  end if;

  if v_game.phase = 'truth_result' then
    update public.really_donald_games
    set phase = 'impression',
        waiting_on = jsonb_build_array(v_game.active_player_id::text),
        last_error = null
    where lobby_id = v_ctx.lobby_id;
    return public.rd_get_state(p_game_code, p_player_token);
  end if;

  if v_game.phase = 'impression' then
    update public.really_donald_games
    set phase = 'speaker_vote',
        waiting_on = '[]'::jsonb,
        speaker_votes = '{}'::jsonb,
        speaker_winners = '[]'::jsonb,
        last_error = null
    where lobby_id = v_ctx.lobby_id;
    return public.rd_get_state(p_game_code, p_player_token);
  end if;

  if v_game.phase = 'turn_result' then
    v_player_count := public.rd_player_count(v_game.player_order);
    v_total_turns := v_player_count * 3;
    v_next_turn := v_game.turn_index + 1;

    if v_next_turn >= v_total_turns then
      update public.really_donald_games
      set phase = 'result',
          turn_index = v_next_turn,
          waiting_on = '[]'::jsonb,
          active_player_id = null,
          last_error = null
      where lobby_id = v_ctx.lobby_id;
      return public.rd_get_state(p_game_code, p_player_token);
    end if;

    v_next_round := floor((v_next_turn)::numeric / v_player_count)::integer + 1;

    if v_next_round > v_game.round_number then
      update public.really_donald_games
      set phase = 'round_result',
          turn_index = v_next_turn,
          round_number = v_next_round,
          waiting_on = public.rd_active_player_ids(v_ctx.lobby_id),
          active_player_id = null,
          last_error = null
      where lobby_id = v_ctx.lobby_id;
      return public.rd_get_state(p_game_code, p_player_token);
    end if;

    update public.really_donald_games
    set turn_index = v_next_turn,
        last_error = null
    where lobby_id = v_ctx.lobby_id;

    perform public.rd_prepare_turn(v_ctx.lobby_id);
    return public.rd_get_state(p_game_code, p_player_token);
  end if;

  if v_game.phase = 'round_result' then
    update public.really_donald_games
    set phase = 'round_intro',
        waiting_on = public.rd_active_player_ids(v_ctx.lobby_id),
        last_error = null
    where lobby_id = v_ctx.lobby_id;
    return public.rd_get_state(p_game_code, p_player_token);
  end if;

  return public.rd_get_state(p_game_code, p_player_token);
end;
$$;

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
      waiting_on = public.rd_active_player_ids(v_ctx.lobby_id),
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
      waiting_on = public.rd_active_player_ids(v_ctx.lobby_id),
      last_error = null
  where lobby_id = v_ctx.lobby_id;

  return public.rd_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.rd_play_again(p_game_code text, p_player_token text, p_quotes jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.really_donald_games%rowtype;
  v_quotes jsonb;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.rd_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;
  if v_ctx.is_host is false then
    raise exception 'Only host can play again.';
  end if;

  select * into v_game from public.really_donald_games where lobby_id = v_ctx.lobby_id;
  if not found then
    raise exception 'Game runtime not initialized.';
  end if;

  v_quotes := coalesce(p_quotes, v_game.quote_pool);

  update public.really_donald_games
  set phase = 'rules',
      waiting_on = public.rd_active_player_ids(v_ctx.lobby_id),
      player_order = public.rd_player_order(v_ctx.lobby_id),
      quote_pool = v_quotes,
      deck = public.rd_shuffle_json(v_quotes),
      current_card = null,
      active_player_id = public.rd_player_at(public.rd_player_order(v_ctx.lobby_id), 0),
      round_number = 1,
      turn_index = 0,
      scores = public.rd_zero_scores(public.rd_player_order(v_ctx.lobby_id)),
      truth_votes = '{}'::jsonb,
      speaker_votes = '{}'::jsonb,
      truth_winners = '[]'::jsonb,
      speaker_winners = '[]'::jsonb,
      last_error = null
  where lobby_id = v_ctx.lobby_id;

  return public.rd_get_state(p_game_code, p_player_token);
end;
$$;

grant execute on function public.rd_player_context(text, text) to anon, authenticated;
grant execute on function public.rd_remove_waiting(jsonb, uuid) to anon, authenticated;
grant execute on function public.rd_active_player_ids(uuid) to anon, authenticated;
grant execute on function public.rd_player_order(uuid) to anon, authenticated;
grant execute on function public.rd_shuffle_json(jsonb) to anon, authenticated;
grant execute on function public.rd_player_count(jsonb) to anon, authenticated;
grant execute on function public.rd_player_at(jsonb, integer) to anon, authenticated;
grant execute on function public.rd_zero_scores(jsonb) to anon, authenticated;
grant execute on function public.rd_increment_scores(jsonb, jsonb) to anon, authenticated;
grant execute on function public.rd_draw_card(jsonb, jsonb) to anon, authenticated;
grant execute on function public.rd_prepare_turn(uuid) to anon, authenticated;
grant execute on function public.rd_get_state(text, text) to anon, authenticated;
grant execute on function public.rd_init_game(text, text, jsonb) to anon, authenticated;
grant execute on function public.rd_continue(text, text) to anon, authenticated;
grant execute on function public.rd_submit_truth_vote(text, text, text) to anon, authenticated;
grant execute on function public.rd_submit_speaker_vote(text, text, text) to anon, authenticated;
grant execute on function public.rd_play_again(text, text, jsonb) to anon, authenticated;
