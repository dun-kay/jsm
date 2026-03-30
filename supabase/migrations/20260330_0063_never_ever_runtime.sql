-- Never Ever runtime

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
    when v_lobby.game_slug in ('really-donald', 'fake-famous') then 2
    when v_lobby.game_slug = 'never-ever' then 2
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

create table if not exists public.never_ever_games (
  lobby_id uuid primary key references public.game_lobbies(id) on delete cascade,
  phase text not null default 'rules' check (phase in ('rules', 'round_intro', 'card_reveal', 'vote', 'callout', 'result')),
  waiting_on jsonb not null default '[]'::jsonb,
  player_order jsonb not null default '[]'::jsonb,
  turn_index integer not null default 0,
  round_number integer not null default 1,
  selected_category text,
  card_pool jsonb not null default '[]'::jsonb,
  deck jsonb not null default '[]'::jsonb,
  current_reader_id uuid references public.lobby_players(id) on delete set null,
  current_card text,
  votes jsonb not null default '{}'::jsonb,
  called_out jsonb not null default '[]'::jsonb,
  called_out_option text,
  callout_counts jsonb not null default '{}'::jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_never_ever_games_updated_at on public.never_ever_games;
create trigger set_never_ever_games_updated_at
before update on public.never_ever_games
for each row execute function public.set_updated_at();

alter table public.never_ever_games enable row level security;
revoke all on table public.never_ever_games from anon, authenticated;

create or replace function public.ne_active_player_ids(p_lobby_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(p.id::text) order by p.created_at), '[]'::jsonb)
  from public.lobby_players p
  where p.lobby_id = p_lobby_id;
$$;

create or replace function public.ne_remove_waiting(p_waiting jsonb, p_player_id uuid)
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

create or replace function public.ne_increment_counts(p_counts jsonb, p_player_ids jsonb)
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

create or replace function public.ne_player_context(p_game_code text, p_player_token text)
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

create or replace function public.ne_pick_category(p_card_pool jsonb, p_required_count integer)
returns table(category_name text, category_cards jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pool jsonb := coalesce(p_card_pool, '[]'::jsonb);
begin
  if p_required_count <= 0 then
    raise exception 'Required card count must be positive.';
  end if;

  if jsonb_typeof(v_pool) = 'object' and jsonb_typeof(v_pool -> 'categories') = 'array' then
    return query
    with cats as (
      select
        coalesce(nullif(trim(c.value ->> 'name'), ''), 'General') as name,
        coalesce(c.value -> 'cards', '[]'::jsonb) as cards
      from jsonb_array_elements(v_pool -> 'categories') as c(value)
    )
    select name, cards
    from cats
    where jsonb_typeof(cards) = 'array'
      and jsonb_array_length(cards) >= p_required_count
    order by random()
    limit 1;

    if found then
      return;
    end if;
    raise exception 'No category has at least % cards.', p_required_count;
  end if;

  if jsonb_typeof(v_pool) = 'array' then
    return query select 'General'::text, v_pool;
    return;
  end if;

  raise exception 'Card pool format is invalid.';
end;
$$;

create or replace function public.ne_sample_cards(p_cards jsonb, p_required_count integer)
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
    raise exception 'Need at least % cards in selected category.', p_required_count;
  end if;

  with picked as (
    select value
    from jsonb_array_elements(v_cards)
    order by random()
    limit p_required_count
  )
  select coalesce(jsonb_agg(value), '[]'::jsonb)
  into v_deck
  from picked;

  return v_deck;
end;
$$;

create or replace function public.ne_prepare_turn(p_lobby_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.never_ever_games%rowtype;
  v_player_count integer;
  v_reader_idx integer;
  v_reader_id uuid;
  v_card text;
  v_round integer;
begin
  select * into v_game
  from public.never_ever_games
  where lobby_id = p_lobby_id
  for update;

  if not found then
    return;
  end if;

  if v_game.turn_index >= 18 then
    update public.never_ever_games
    set phase = 'result',
        waiting_on = '[]'::jsonb
    where lobby_id = p_lobby_id;
    return;
  end if;

  v_player_count := public.rd_player_count(v_game.player_order);
  if v_player_count <= 0 then
    update public.never_ever_games
    set phase = 'result',
        waiting_on = '[]'::jsonb
    where lobby_id = p_lobby_id;
    return;
  end if;

  v_reader_idx := mod(v_game.turn_index, v_player_count);
  v_reader_id := public.rd_player_at(v_game.player_order, v_reader_idx);
  v_card := coalesce(v_game.deck ->> v_game.turn_index, null);
  v_round := floor((v_game.turn_index)::numeric / 9)::integer + 1;

  update public.never_ever_games
  set phase = 'card_reveal',
      round_number = v_round,
      current_reader_id = v_reader_id,
      current_card = v_card,
      votes = '{}'::jsonb,
      called_out = '[]'::jsonb,
      called_out_option = null,
      waiting_on = jsonb_build_array(v_reader_id::text),
      last_error = null
  where lobby_id = p_lobby_id;
end;
$$;

create or replace function public.ne_get_state(p_game_code text, p_player_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.never_ever_games%rowtype;
  v_players jsonb;
  v_counts jsonb;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.ne_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_game
  from public.never_ever_games
  where lobby_id = v_ctx.lobby_id;

  if not found then
    return public.ne_init_game(p_game_code, p_player_token, null);
  end if;

  v_counts := coalesce(v_game.callout_counts, '{}'::jsonb);

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
        'calloutCount', coalesce((v_counts ->> p.id::text)::integer, 0)
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
    'roundNumber', v_game.round_number,
    'turnIndex', v_game.turn_index,
    'selectedCategory', v_game.selected_category,
    'currentReaderId', v_game.current_reader_id,
    'currentCard', v_game.current_card,
    'votes', coalesce(v_game.votes, '{}'::jsonb),
    'calledOut', coalesce(v_game.called_out, '[]'::jsonb),
    'calledOutOption', v_game.called_out_option,
    'calloutCounts', v_counts,
    'waitingOn', coalesce(v_game.waiting_on, '[]'::jsonb),
    'players', v_players,
    'lastError', v_game.last_error,
    'you', jsonb_build_object(
      'id', v_ctx.player_id,
      'name', v_ctx.player_name,
      'isHost', v_ctx.is_host,
      'calloutCount', coalesce((v_counts ->> v_ctx.player_id::text)::integer, 0)
    )
  );
end;
$$;

create or replace function public.ne_init_game(p_game_code text, p_player_token text, p_card_pool jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_order jsonb;
  v_pool jsonb;
  v_pick record;
  v_deck jsonb;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.ne_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  if v_ctx.game_slug <> 'never-ever' then
    raise exception 'Game mismatch.';
  end if;

  if v_ctx.lobby_status <> 'started' then
    raise exception 'Game has not started.';
  end if;

  if exists (select 1 from public.never_ever_games g where g.lobby_id = v_ctx.lobby_id) then
    return public.ne_get_state(p_game_code, p_player_token);
  end if;

  if v_ctx.is_host is false then
    raise exception 'Host must initialize this game first.';
  end if;

  v_pool := coalesce(p_card_pool, '[]'::jsonb);
  select * into v_pick from public.ne_pick_category(v_pool, 18);
  v_deck := public.ne_sample_cards(v_pick.category_cards, 18);
  v_order := public.rd_player_order(v_ctx.lobby_id);

  insert into public.never_ever_games (
    lobby_id,
    phase,
    waiting_on,
    player_order,
    turn_index,
    round_number,
    selected_category,
    card_pool,
    deck,
    current_reader_id,
    current_card,
    votes,
    called_out,
    called_out_option,
    callout_counts,
    last_error
  )
  values (
    v_ctx.lobby_id,
    'rules',
    public.ne_active_player_ids(v_ctx.lobby_id),
    v_order,
    0,
    1,
    v_pick.category_name,
    v_pool,
    v_deck,
    null,
    null,
    '{}'::jsonb,
    '[]'::jsonb,
    null,
    public.rd_zero_scores(v_order),
    null
  );

  return public.ne_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.ne_continue(p_game_code text, p_player_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.never_ever_games%rowtype;
  v_waiting jsonb;
  v_curr_round integer;
  v_next_turn integer;
  v_next_round integer;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.ne_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_game
  from public.never_ever_games
  where lobby_id = v_ctx.lobby_id
  for update;

  if not found then
    raise exception 'Game runtime not initialized.';
  end if;

  if v_game.phase in ('rules', 'round_intro', 'card_reveal') then
    if not (coalesce(v_game.waiting_on, '[]'::jsonb) @> jsonb_build_array(v_ctx.player_id::text)) then
      return public.ne_get_state(p_game_code, p_player_token);
    end if;

    v_waiting := public.ne_remove_waiting(v_game.waiting_on, v_ctx.player_id);
    update public.never_ever_games
    set waiting_on = v_waiting
    where lobby_id = v_ctx.lobby_id;

    if jsonb_array_length(v_waiting) = 0 then
      if v_game.phase = 'rules' then
        update public.never_ever_games
        set phase = 'round_intro',
            round_number = 1,
            waiting_on = public.ne_active_player_ids(v_ctx.lobby_id),
            last_error = null
        where lobby_id = v_ctx.lobby_id;
      elsif v_game.phase = 'round_intro' then
        perform public.ne_prepare_turn(v_ctx.lobby_id);
      elsif v_game.phase = 'card_reveal' then
        update public.never_ever_games
        set phase = 'vote',
            waiting_on = public.ne_active_player_ids(v_ctx.lobby_id),
            votes = '{}'::jsonb,
            called_out = '[]'::jsonb,
            called_out_option = null,
            last_error = null
        where lobby_id = v_ctx.lobby_id;
      end if;
    end if;
  elsif v_game.phase = 'callout' then
    if not (coalesce(v_game.called_out, '[]'::jsonb) @> jsonb_build_array(v_ctx.player_id::text)) then
      return public.ne_get_state(p_game_code, p_player_token);
    end if;

    v_next_turn := v_game.turn_index + 1;
    if v_next_turn >= 18 then
      update public.never_ever_games
      set turn_index = v_next_turn,
          phase = 'result',
          waiting_on = '[]'::jsonb
      where lobby_id = v_ctx.lobby_id;
      return public.ne_get_state(p_game_code, p_player_token);
    end if;

    v_curr_round := floor((v_game.turn_index)::numeric / 9)::integer + 1;
    v_next_round := floor((v_next_turn)::numeric / 9)::integer + 1;

    if v_next_round > v_curr_round then
      update public.never_ever_games
      set turn_index = v_next_turn,
          round_number = v_next_round,
          phase = 'round_intro',
          waiting_on = public.ne_active_player_ids(v_ctx.lobby_id),
          votes = '{}'::jsonb,
          called_out = '[]'::jsonb,
          called_out_option = null,
          current_reader_id = null,
          current_card = null,
          last_error = null
      where lobby_id = v_ctx.lobby_id;
    else
      update public.never_ever_games
      set turn_index = v_next_turn
      where lobby_id = v_ctx.lobby_id;
      perform public.ne_prepare_turn(v_ctx.lobby_id);
    end if;
  end if;

  return public.ne_get_state(p_game_code, p_player_token);
end;
$$;

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
  v_player_count integer;
  v_called_option text;
  v_called_out jsonb;
  v_waiting jsonb;
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

  v_votes := coalesce(v_game.votes, '{}'::jsonb);
  v_votes := jsonb_set(v_votes, array[v_ctx.player_id::text], to_jsonb(p_choice), true);

  update public.never_ever_games
  set votes = v_votes
  where lobby_id = v_ctx.lobby_id;

  v_player_count := public.rd_player_count(v_game.player_order);
  if jsonb_object_length(v_votes) < v_player_count then
    return public.ne_get_state(p_game_code, p_player_token);
  end if;

  with vote_rows as (
    select key as player_id, value as choice
    from jsonb_each_text(v_votes)
  ),
  counts as (
    select choice, count(*) as c
    from vote_rows
    group by choice
    having count(*) > 0
  )
  select choice
  into v_called_option
  from counts
  order by c asc,
    case choice
      when 'Again' then 1
      when 'Never again' then 2
      when 'Maybe?' then 3
      when 'Never ever' then 4
      else 5
    end
  limit 1;

  select coalesce(jsonb_agg(player_id), '[]'::jsonb)
  into v_called_out
  from (
    select key as player_id
    from jsonb_each_text(v_votes)
    where value = v_called_option
  ) t;

  if jsonb_array_length(v_called_out) = 0 then
    v_waiting := jsonb_build_array(v_game.current_reader_id::text);
  else
    v_waiting := v_called_out;
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

create or replace function public.ne_play_again(p_game_code text, p_player_token text, p_card_pool jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.never_ever_games%rowtype;
  v_pool jsonb;
  v_order jsonb;
  v_pick record;
  v_deck jsonb;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.ne_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;
  if v_ctx.is_host is false then
    raise exception 'Only host can play again.';
  end if;

  select * into v_game from public.never_ever_games where lobby_id = v_ctx.lobby_id;
  if not found then
    raise exception 'Game runtime not initialized.';
  end if;

  v_pool := coalesce(p_card_pool, v_game.card_pool);
  v_order := public.rd_player_order(v_ctx.lobby_id);
  select * into v_pick from public.ne_pick_category(v_pool, 18);
  v_deck := public.ne_sample_cards(v_pick.category_cards, 18);

  update public.never_ever_games
  set phase = 'rules',
      waiting_on = public.ne_active_player_ids(v_ctx.lobby_id),
      player_order = v_order,
      turn_index = 0,
      round_number = 1,
      selected_category = v_pick.category_name,
      card_pool = v_pool,
      deck = v_deck,
      current_reader_id = null,
      current_card = null,
      votes = '{}'::jsonb,
      called_out = '[]'::jsonb,
      called_out_option = null,
      callout_counts = public.rd_zero_scores(v_order),
      last_error = null
  where lobby_id = v_ctx.lobby_id;

  return public.ne_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.ne_reroll_category(p_game_code text, p_player_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.never_ever_games%rowtype;
  v_pick record;
  v_deck jsonb;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.ne_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;
  if v_ctx.is_host is false then
    raise exception 'Only host can re-spin category.';
  end if;

  select * into v_game
  from public.never_ever_games
  where lobby_id = v_ctx.lobby_id
  for update;

  if not found then
    raise exception 'Game runtime not initialized.';
  end if;

  if v_game.phase <> 'round_intro' or v_game.turn_index <> 0 then
    raise exception 'Category can only be re-spun before round 1 starts.';
  end if;

  select * into v_pick from public.ne_pick_category(v_game.card_pool, 18);
  v_deck := public.ne_sample_cards(v_pick.category_cards, 18);

  update public.never_ever_games
  set selected_category = v_pick.category_name,
      deck = v_deck,
      current_card = null,
      current_reader_id = null,
      votes = '{}'::jsonb,
      called_out = '[]'::jsonb,
      called_out_option = null,
      last_error = null
  where lobby_id = v_ctx.lobby_id;

  return public.ne_get_state(p_game_code, p_player_token);
end;
$$;

grant execute on function public.ne_active_player_ids(uuid) to anon, authenticated;
grant execute on function public.ne_remove_waiting(jsonb, uuid) to anon, authenticated;
grant execute on function public.ne_increment_counts(jsonb, jsonb) to anon, authenticated;
grant execute on function public.ne_player_context(text, text) to anon, authenticated;
grant execute on function public.ne_pick_category(jsonb, integer) to anon, authenticated;
grant execute on function public.ne_sample_cards(jsonb, integer) to anon, authenticated;
grant execute on function public.ne_prepare_turn(uuid) to anon, authenticated;
grant execute on function public.ne_get_state(text, text) to anon, authenticated;
grant execute on function public.ne_init_game(text, text, jsonb) to anon, authenticated;
grant execute on function public.ne_continue(text, text) to anon, authenticated;
grant execute on function public.ne_submit_vote(text, text, text) to anon, authenticated;
grant execute on function public.ne_play_again(text, text, jsonb) to anon, authenticated;
grant execute on function public.ne_reroll_category(text, text) to anon, authenticated;
