-- Secret Categories runtime state and RPCs.

create table if not exists public.secret_category_games (
  lobby_id uuid primary key references public.game_lobbies(id) on delete cascade,
  round_no integer not null default 1,
  phase text not null default 'rules' check (phase in ('rules', 'role_reveal', 'turn_clues', 'discussion', 'vote', 'spy_guess', 'result')),
  main_category text not null,
  secret_category text not null,
  secret_options jsonb not null default '[]'::jsonb,
  spy_player_id uuid not null references public.lobby_players(id) on delete cascade,
  turn_order jsonb not null default '[]'::jsonb,
  turn_index integer not null default 0,
  waiting_on jsonb not null default '[]'::jsonb,
  votes jsonb not null default '{}'::jsonb,
  vote_attempt integer not null default 1,
  round_result text not null default 'pending' check (round_result in ('pending', 'spy_found', 'spy_not_found', 'spy_guessed_correct', 'spy_guessed_wrong')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_secret_category_games_updated_at on public.secret_category_games;
create trigger set_secret_category_games_updated_at
before update on public.secret_category_games
for each row execute function public.set_updated_at();

create index if not exists secret_category_games_phase_idx on public.secret_category_games(phase);

alter table public.secret_category_games enable row level security;
revoke all on table public.secret_category_games from anon, authenticated;

create or replace function public.sc_player_context(p_game_code text, p_player_token text)
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
  select
    l.id,
    l.game_slug,
    l.status,
    p.id,
    p.display_name,
    p.is_host
  from public.game_lobbies l
  join public.lobby_players p on p.lobby_id = l.id
  where l.game_code = upper(trim(p_game_code))
    and p.player_token = p_player_token;
end;
$$;

create or replace function public.sc_pick_round_data()
returns table(main_category text, secret_category text, secret_options jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_main text;
  v_secret text;
  v_options jsonb;
begin
  select * into v_main, v_options
  from (
    values
      ('TV Sitcoms', '["Seinfeld","Friends","Big Bang Theory","The Simpsons","The Office","Parks and Recreation","Brooklyn Nine-Nine","Modern Family","How I Met Your Mother","Community"]'::jsonb),
      ('Cars', '["Ford","Ferrari","Fiat","Honda","Toyota","Mazda","Nissan","Porsche","Tesla","BMW"]'::jsonb),
      ('Sports', '["Soccer","Basketball","Tennis","Golf","Cricket","Rugby","Baseball","Hockey","Formula 1","MMA"]'::jsonb),
      ('Food', '["Pizza","Burger","Sushi","Tacos","Pasta","Steak","Salad","Curry","Ramen","Dumplings"]'::jsonb),
      ('Travel', '["Tokyo","Paris","London","New York","Sydney","Rome","Bangkok","Barcelona","Dubai","Singapore"]'::jsonb)
  ) as pool(main_category, options)
  order by random()
  limit 1;

  select elem::text into v_secret
  from jsonb_array_elements_text(v_options) elem
  order by random()
  limit 1;

  return query select v_main, v_secret, v_options;
end;
$$;

create or replace function public.sc_active_player_ids(p_lobby_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(p.id) order by p.created_at), '[]'::jsonb)
  from public.lobby_players p
  where p.lobby_id = p_lobby_id;
$$;

create or replace function public.sc_init_game(p_game_code text, p_player_token text)
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

  if v_ctx.game_slug <> 'secret-category' then
    raise exception 'Game mismatch.';
  end if;

  if v_ctx.lobby_status <> 'started' then
    raise exception 'Game has not started.';
  end if;

  select * into v_state from public.secret_category_games where lobby_id = v_ctx.lobby_id;
  if found then
    return public.sc_get_state(p_game_code, p_player_token);
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

  insert into public.secret_category_games (
    lobby_id,
    round_no,
    phase,
    main_category,
    secret_category,
    secret_options,
    spy_player_id,
    turn_order,
    turn_index,
    waiting_on,
    votes,
    vote_attempt,
    round_result
  )
  values (
    v_ctx.lobby_id,
    1,
    'rules',
    v_main,
    v_secret,
    v_options,
    v_spy_id,
    v_turn_order,
    0,
    public.sc_active_player_ids(v_ctx.lobby_id),
    '{}'::jsonb,
    1,
    'pending'
  );

  return public.sc_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.sc_remove_waiting(p_waiting jsonb, p_player_id uuid)
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

create or replace function public.sc_get_state(p_game_code text, p_player_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_state public.secret_category_games%rowtype;
  v_players jsonb;
  v_current_turn_id uuid;
begin
  perform public.cleanup_lobby_presence(p_game_code);

  select * into v_ctx from public.sc_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_state from public.secret_category_games where lobby_id = v_ctx.lobby_id;
  if not found then
    return public.sc_init_game(p_game_code, p_player_token);
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'name', p.display_name
      )
      order by p.created_at
    ),
    '[]'::jsonb
  )
  into v_players
  from public.lobby_players p
  where p.lobby_id = v_ctx.lobby_id;

  select (elem::text)::uuid
  into v_current_turn_id
  from jsonb_array_elements_text(v_state.turn_order) with ordinality t(elem, ord)
  where ord = v_state.turn_index + 1;

  return jsonb_build_object(
    'roundNo', v_state.round_no,
    'phase', v_state.phase,
    'mainCategory', v_state.main_category,
    'secretCategory', case when v_ctx.player_id = v_state.spy_player_id then null else v_state.secret_category end,
    'isSpy', (v_ctx.player_id = v_state.spy_player_id),
    'spyPlayerId', v_state.spy_player_id,
    'secretOptions', v_state.secret_options,
    'players', v_players,
    'waitingOn', v_state.waiting_on,
    'turnOrder', v_state.turn_order,
    'turnIndex', v_state.turn_index,
    'currentTurnPlayerId', v_current_turn_id,
    'voteAttempt', v_state.vote_attempt,
    'votes', v_state.votes,
    'roundResult', v_state.round_result,
    'you', jsonb_build_object(
      'id', v_ctx.player_id,
      'name', v_ctx.player_name,
      'isHost', v_ctx.is_host
    )
  );
end;
$$;

create or replace function public.sc_continue(p_game_code text, p_player_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_state public.secret_category_games%rowtype;
  v_waiting jsonb;
  v_player_count integer;
begin
  perform public.cleanup_lobby_presence(p_game_code);

  select * into v_ctx from public.sc_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_state from public.secret_category_games where lobby_id = v_ctx.lobby_id;
  if not found then
    raise exception 'Game runtime not initialized.';
  end if;

  v_waiting := public.sc_remove_waiting(v_state.waiting_on, v_ctx.player_id);

  update public.secret_category_games
  set waiting_on = v_waiting
  where lobby_id = v_ctx.lobby_id;

  if jsonb_array_length(v_waiting) > 0 then
    return public.sc_get_state(p_game_code, p_player_token);
  end if;

  if v_state.phase = 'rules' then
    update public.secret_category_games
    set phase = 'role_reveal',
        waiting_on = public.sc_active_player_ids(v_ctx.lobby_id)
    where lobby_id = v_ctx.lobby_id;
  elsif v_state.phase = 'role_reveal' then
    update public.secret_category_games
    set phase = 'turn_clues',
        turn_index = 0,
        waiting_on = public.sc_active_player_ids(v_ctx.lobby_id)
    where lobby_id = v_ctx.lobby_id;
  elsif v_state.phase = 'turn_clues' then
    select jsonb_array_length(v_state.turn_order) into v_player_count;
    if v_state.turn_index + 1 >= v_player_count then
      update public.secret_category_games
      set phase = 'discussion',
          waiting_on = public.sc_active_player_ids(v_ctx.lobby_id)
      where lobby_id = v_ctx.lobby_id;
    else
      update public.secret_category_games
      set turn_index = v_state.turn_index + 1,
          waiting_on = public.sc_active_player_ids(v_ctx.lobby_id)
      where lobby_id = v_ctx.lobby_id;
    end if;
  elsif v_state.phase = 'discussion' then
    update public.secret_category_games
    set phase = 'vote',
        votes = '{}'::jsonb,
        vote_attempt = 1,
        waiting_on = public.sc_active_player_ids(v_ctx.lobby_id)
    where lobby_id = v_ctx.lobby_id;
  elsif v_state.phase = 'result' then
    -- no-op; next round is explicit
    null;
  end if;

  return public.sc_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.sc_submit_vote(p_game_code text, p_player_token text, p_target_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_state public.secret_category_games%rowtype;
  v_waiting jsonb;
  v_votes jsonb;
  v_total integer;
  v_top_target text;
  v_top_count integer;
begin
  perform public.cleanup_lobby_presence(p_game_code);

  select * into v_ctx from public.sc_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_state from public.secret_category_games where lobby_id = v_ctx.lobby_id;
  if not found or v_state.phase <> 'vote' then
    raise exception 'Voting is not active.';
  end if;

  if not exists (
    select 1 from public.lobby_players p
    where p.lobby_id = v_ctx.lobby_id
      and p.id = p_target_player_id
  ) then
    raise exception 'Invalid vote target.';
  end if;

  v_votes := coalesce(v_state.votes, '{}'::jsonb) || jsonb_build_object(v_ctx.player_id::text, p_target_player_id::text);
  v_waiting := public.sc_remove_waiting(v_state.waiting_on, v_ctx.player_id);

  update public.secret_category_games
  set votes = v_votes,
      waiting_on = v_waiting
  where lobby_id = v_ctx.lobby_id;

  if jsonb_array_length(v_waiting) > 0 then
    return public.sc_get_state(p_game_code, p_player_token);
  end if;

  select count(*) into v_total
  from public.lobby_players p
  where p.lobby_id = v_ctx.lobby_id;

  select target, cnt
  into v_top_target, v_top_count
  from (
    select value::text as target, count(*) as cnt
    from jsonb_each_text(v_votes)
    group by value
    order by cnt desc
    limit 1
  ) s;

  if v_top_count > (v_total / 2) then
    if (v_top_target)::uuid = v_state.spy_player_id then
      update public.secret_category_games
      set phase = 'spy_guess',
          round_result = 'spy_found',
          waiting_on = jsonb_build_array(v_state.spy_player_id::text)
      where lobby_id = v_ctx.lobby_id;
    else
      update public.secret_category_games
      set phase = 'result',
          round_result = 'spy_not_found',
          waiting_on = public.sc_active_player_ids(v_ctx.lobby_id)
      where lobby_id = v_ctx.lobby_id;
    end if;
  else
    update public.secret_category_games
    set votes = '{}'::jsonb,
        vote_attempt = v_state.vote_attempt + 1,
        waiting_on = public.sc_active_player_ids(v_ctx.lobby_id)
    where lobby_id = v_ctx.lobby_id;
  end if;

  return public.sc_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.sc_spy_guess(p_game_code text, p_player_token text, p_guess text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_state public.secret_category_games%rowtype;
begin
  perform public.cleanup_lobby_presence(p_game_code);

  select * into v_ctx from public.sc_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_state from public.secret_category_games where lobby_id = v_ctx.lobby_id;
  if not found or v_state.phase <> 'spy_guess' then
    raise exception 'Spy guess is not active.';
  end if;

  if v_ctx.player_id <> v_state.spy_player_id then
    raise exception 'Only the spy can guess.';
  end if;

  update public.secret_category_games
  set phase = 'result',
      round_result = case
        when lower(trim(p_guess)) = lower(v_state.secret_category) then 'spy_guessed_correct'
        else 'spy_guessed_wrong'
      end,
      waiting_on = public.sc_active_player_ids(v_ctx.lobby_id)
  where lobby_id = v_ctx.lobby_id;

  return public.sc_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.sc_next_round(p_game_code text, p_player_token text)
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
    raise exception 'Only host can start next round.';
  end if;

  select * into v_state from public.secret_category_games where lobby_id = v_ctx.lobby_id;
  if not found then
    raise exception 'Game runtime not initialized.';
  end if;

  if v_state.phase <> 'result' then
    raise exception 'Round must be finished first.';
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
  set round_no = v_state.round_no + 1,
      phase = 'rules',
      main_category = v_main,
      secret_category = v_secret,
      secret_options = v_options,
      spy_player_id = v_spy_id,
      turn_order = v_turn_order,
      turn_index = 0,
      waiting_on = public.sc_active_player_ids(v_ctx.lobby_id),
      votes = '{}'::jsonb,
      vote_attempt = 1,
      round_result = 'pending'
  where lobby_id = v_ctx.lobby_id;

  return public.sc_get_state(p_game_code, p_player_token);
end;
$$;

grant execute on function public.sc_player_context(text, text) to anon, authenticated;
grant execute on function public.sc_pick_round_data() to anon, authenticated;
grant execute on function public.sc_active_player_ids(uuid) to anon, authenticated;
grant execute on function public.sc_init_game(text, text) to anon, authenticated;
grant execute on function public.sc_remove_waiting(jsonb, uuid) to anon, authenticated;
grant execute on function public.sc_get_state(text, text) to anon, authenticated;
grant execute on function public.sc_continue(text, text) to anon, authenticated;
grant execute on function public.sc_submit_vote(text, text, uuid) to anon, authenticated;
grant execute on function public.sc_spy_guess(text, text, text) to anon, authenticated;
grant execute on function public.sc_next_round(text, text) to anon, authenticated;

