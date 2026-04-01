-- Wormy Worm runtime

create table if not exists public.wormy_worm_games (
  lobby_id uuid primary key references public.game_lobbies(id) on delete cascade,
  phase text not null default 'rules' check (phase in ('rules', 'penalty_mode', 'penalty_custom', 'penalty_ready', 'draw_reveal', 'draw_result', 'result')),
  waiting_on jsonb not null default '[]'::jsonb,
  player_order jsonb not null default '[]'::jsonb,
  turn_index integer not null default 0,
  round_number integer not null default 1,
  penalty_mode text check (penalty_mode in ('auto', 'own')),
  penalty_text text,
  auto_penalties jsonb not null default '[]'::jsonb,
  draw_plan jsonb not null default '{}'::jsonb,
  revealed_draws jsonb not null default '{}'::jsonb,
  scores jsonb not null default '{}'::jsonb,
  current_drawer_id uuid references public.lobby_players(id) on delete set null,
  current_draw_count integer,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_wormy_worm_games_updated_at on public.wormy_worm_games;
create trigger set_wormy_worm_games_updated_at
before update on public.wormy_worm_games
for each row execute function public.set_updated_at();

alter table public.wormy_worm_games enable row level security;
revoke all on table public.wormy_worm_games from anon, authenticated;

create or replace function public.ww_player_context(p_game_code text, p_player_token text)
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

create or replace function public.ww_active_player_ids(p_lobby_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(p.id::text) order by p.created_at), '[]'::jsonb)
  from public.lobby_players p
  where p.lobby_id = p_lobby_id;
$$;

create or replace function public.ww_remove_waiting(p_waiting jsonb, p_player_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(value) filter (where value <> to_jsonb(p_player_id::text)), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_waiting, '[]'::jsonb));
$$;

create or replace function public.ww_weighted_draw()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_roll numeric;
begin
  v_roll := random() * 100;
  if v_roll < 35 then
    return 1;
  elsif v_roll < 65 then
    return 2;
  elsif v_roll < 83 then
    return 3;
  elsif v_roll < 94 then
    return 4;
  else
    return 5;
  end if;
end;
$$;

create or replace function public.ww_pick_auto_penalty(p_penalties jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_penalties jsonb := coalesce(p_penalties, '[]'::jsonb);
  v_choice text;
begin
  if jsonb_typeof(v_penalties) <> 'array' or jsonb_array_length(v_penalties) = 0 then
    return 'Do a silly dance';
  end if;

  select value::text
  into v_choice
  from jsonb_array_elements_text(v_penalties)
  order by random()
  limit 1;

  return coalesce(v_choice, 'Do a silly dance');
end;
$$;

create or replace function public.ww_generate_draw_plan(p_player_order jsonb, p_draws_per_player integer default 3)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_count integer;
  v_attempt integer := 0;
  v_plan jsonb;
  v_totals jsonb;
  v_player_id text;
  v_draws jsonb;
  v_draw integer;
  v_total integer;
  v_min_total integer;
  v_min_count integer;
  v_loser_idx integer;
  v_idx integer;
begin
  v_player_count := public.rd_player_count(coalesce(p_player_order, '[]'::jsonb));
  if v_player_count < 2 then
    raise exception 'Wormy Worm requires at least 2 players.';
  end if;

  while v_attempt < 300 loop
    v_attempt := v_attempt + 1;
    v_plan := '{}'::jsonb;
    v_totals := '{}'::jsonb;

    for v_player_id in
      select value::text
      from jsonb_array_elements_text(p_player_order)
    loop
      v_draws := '[]'::jsonb;
      v_total := 0;
      for v_idx in 1..p_draws_per_player loop
        v_draw := public.ww_weighted_draw();
        v_draws := v_draws || to_jsonb(v_draw);
        v_total := v_total + v_draw;
      end loop;

      v_plan := jsonb_set(v_plan, array[v_player_id], v_draws, true);
      v_totals := jsonb_set(v_totals, array[v_player_id], to_jsonb(v_total), true);
    end loop;

    select min((value)::integer)
    into v_min_total
    from jsonb_each_text(v_totals);

    select count(*)
    into v_min_count
    from jsonb_each_text(v_totals)
    where (value)::integer = v_min_total;

    if v_min_count = 1 then
      return v_plan;
    end if;
  end loop;

  -- Fallback: force a single loser with the lowest total.
  v_plan := '{}'::jsonb;
  v_loser_idx := floor(random() * v_player_count)::integer;

  for v_player_id, v_idx in
    select value::text, ordinality - 1
    from jsonb_array_elements_text(p_player_order) with ordinality
  loop
    if v_idx = v_loser_idx then
      v_plan := jsonb_set(v_plan, array[v_player_id], '[1,1,1]'::jsonb, true);
    else
      v_draws := '[]'::jsonb;
      for v_total in 1..p_draws_per_player loop
        v_draw := 2 + floor(random() * 4)::integer;
        v_draws := v_draws || to_jsonb(v_draw);
      end loop;
      v_plan := jsonb_set(v_plan, array[v_player_id], v_draws, true);
    end if;
  end loop;

  return v_plan;
end;
$$;

create or replace function public.ww_prepare_turn(p_lobby_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.wormy_worm_games%rowtype;
  v_player_count integer;
  v_total_turns integer;
  v_drawer_idx integer;
  v_draw_round integer;
  v_drawer_id uuid;
  v_draw_count integer;
begin
  select * into v_game
  from public.wormy_worm_games
  where lobby_id = p_lobby_id
  for update;

  if not found then
    return;
  end if;

  v_player_count := public.rd_player_count(v_game.player_order);
  v_total_turns := v_player_count * 3;

  if v_player_count < 2 or v_game.turn_index >= v_total_turns then
    update public.wormy_worm_games
    set phase = 'result',
        waiting_on = '[]'::jsonb
    where lobby_id = p_lobby_id;
    return;
  end if;

  v_drawer_idx := mod(v_game.turn_index, v_player_count);
  v_draw_round := floor((v_game.turn_index)::numeric / v_player_count)::integer + 1;
  v_drawer_id := public.rd_player_at(v_game.player_order, v_drawer_idx);
  v_draw_count := coalesce((v_game.draw_plan -> v_drawer_id::text ->> (v_draw_round - 1))::integer, public.ww_weighted_draw());

  update public.wormy_worm_games
  set phase = 'draw_reveal',
      round_number = v_draw_round,
      current_drawer_id = v_drawer_id,
      current_draw_count = v_draw_count,
      waiting_on = jsonb_build_array(v_drawer_id::text),
      last_error = null
  where lobby_id = p_lobby_id;
end;
$$;

create or replace function public.ww_get_state(p_game_code text, p_player_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.wormy_worm_games%rowtype;
  v_players jsonb;
  v_scores jsonb;
  v_draws jsonb;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.ww_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_game
  from public.wormy_worm_games
  where lobby_id = v_ctx.lobby_id;

  if not found then
    return public.ww_init_game(p_game_code, p_player_token, null);
  end if;

  v_scores := coalesce(v_game.scores, '{}'::jsonb);
  v_draws := coalesce(v_game.revealed_draws, '{}'::jsonb);

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
        'wormsTotal', coalesce((v_scores ->> p.id::text)::integer, 0),
        'draws', coalesce(v_draws -> p.id::text, '[]'::jsonb)
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
    'currentDrawerId', v_game.current_drawer_id,
    'currentDrawCount', v_game.current_draw_count,
    'penaltyMode', v_game.penalty_mode,
    'penaltyText', v_game.penalty_text,
    'scores', v_scores,
    'waitingOn', coalesce(v_game.waiting_on, '[]'::jsonb),
    'players', v_players,
    'lastError', v_game.last_error,
    'you', jsonb_build_object(
      'id', v_ctx.player_id,
      'name', v_ctx.player_name,
      'isHost', v_ctx.is_host,
      'wormsTotal', coalesce((v_scores ->> v_ctx.player_id::text)::integer, 0)
    )
  );
end;
$$;

create or replace function public.ww_init_game(p_game_code text, p_player_token text, p_auto_penalties jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_order jsonb;
  v_penalties jsonb;
  v_draw_plan jsonb;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.ww_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  if v_ctx.game_slug <> 'wormy-worm' then
    raise exception 'Game mismatch.';
  end if;

  if v_ctx.lobby_status <> 'started' then
    raise exception 'Game has not started.';
  end if;

  if exists (select 1 from public.wormy_worm_games g where g.lobby_id = v_ctx.lobby_id) then
    return public.ww_get_state(p_game_code, p_player_token);
  end if;

  if v_ctx.is_host is false then
    raise exception 'Host must initialize this game first.';
  end if;

  v_order := public.rd_player_order(v_ctx.lobby_id);
  if public.rd_player_count(v_order) < 2 then
    raise exception 'Wormy Worm needs at least 2 players.';
  end if;

  v_penalties := coalesce(p_auto_penalties, '[]'::jsonb);
  if jsonb_typeof(v_penalties) <> 'array' then
    v_penalties := '[]'::jsonb;
  end if;
  v_draw_plan := public.ww_generate_draw_plan(v_order, 3);

  insert into public.wormy_worm_games (
    lobby_id, phase, waiting_on, player_order, turn_index, round_number,
    penalty_mode, penalty_text, auto_penalties, draw_plan, revealed_draws, scores,
    current_drawer_id, current_draw_count, last_error
  )
  values (
    v_ctx.lobby_id, 'rules', public.ww_active_player_ids(v_ctx.lobby_id), v_order, 0, 1,
    null, null, v_penalties, v_draw_plan, '{}'::jsonb, public.rd_zero_scores(v_order),
    null, null, null
  );

  return public.ww_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.ww_continue(p_game_code text, p_player_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.wormy_worm_games%rowtype;
  v_waiting jsonb;
  v_next_turn integer;
  v_score integer;
  v_scores jsonb;
  v_revealed jsonb;
  v_arr jsonb;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.ww_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_game
  from public.wormy_worm_games
  where lobby_id = v_ctx.lobby_id
  for update;

  if not found then
    raise exception 'Game runtime not initialized.';
  end if;

  if v_game.phase = 'rules' then
    if not (coalesce(v_game.waiting_on, '[]'::jsonb) @> jsonb_build_array(v_ctx.player_id::text)) then
      return public.ww_get_state(p_game_code, p_player_token);
    end if;

    v_waiting := public.ww_remove_waiting(v_game.waiting_on, v_ctx.player_id);
    update public.wormy_worm_games
    set waiting_on = v_waiting
    where lobby_id = v_ctx.lobby_id;

    if jsonb_array_length(v_waiting) = 0 then
      update public.wormy_worm_games
      set phase = 'penalty_mode',
          waiting_on = '[]'::jsonb,
          last_error = null
      where lobby_id = v_ctx.lobby_id;
    end if;

    return public.ww_get_state(p_game_code, p_player_token);
  end if;

  if v_game.phase = 'penalty_ready' then
    if v_ctx.is_host is false then
      return public.ww_get_state(p_game_code, p_player_token);
    end if;
    if not (coalesce(v_game.waiting_on, '[]'::jsonb) @> jsonb_build_array(v_ctx.player_id::text)) then
      return public.ww_get_state(p_game_code, p_player_token);
    end if;

    perform public.ww_prepare_turn(v_ctx.lobby_id);
    return public.ww_get_state(p_game_code, p_player_token);
  end if;

  if v_game.phase = 'draw_reveal' then
    if v_ctx.player_id <> v_game.current_drawer_id then
      return public.ww_get_state(p_game_code, p_player_token);
    end if;

    v_scores := coalesce(v_game.scores, '{}'::jsonb);
    v_score := coalesce((v_scores ->> v_ctx.player_id::text)::integer, 0) + coalesce(v_game.current_draw_count, 0);
    v_scores := jsonb_set(v_scores, array[v_ctx.player_id::text], to_jsonb(v_score), true);

    v_revealed := coalesce(v_game.revealed_draws, '{}'::jsonb);
    v_arr := coalesce(v_revealed -> v_ctx.player_id::text, '[]'::jsonb);
    if jsonb_typeof(v_arr) <> 'array' then
      v_arr := '[]'::jsonb;
    end if;
    v_arr := v_arr || to_jsonb(coalesce(v_game.current_draw_count, 0));
    v_revealed := jsonb_set(v_revealed, array[v_ctx.player_id::text], v_arr, true);

    update public.wormy_worm_games
    set phase = 'draw_result',
        scores = v_scores,
        revealed_draws = v_revealed,
        waiting_on = jsonb_build_array(v_ctx.player_id::text),
        last_error = null
    where lobby_id = v_ctx.lobby_id;

    return public.ww_get_state(p_game_code, p_player_token);
  end if;

  if v_game.phase = 'draw_result' then
    if v_ctx.player_id <> v_game.current_drawer_id then
      return public.ww_get_state(p_game_code, p_player_token);
    end if;

    v_next_turn := v_game.turn_index + 1;
    update public.wormy_worm_games
    set turn_index = v_next_turn
    where lobby_id = v_ctx.lobby_id;

    perform public.ww_prepare_turn(v_ctx.lobby_id);
    return public.ww_get_state(p_game_code, p_player_token);
  end if;

  return public.ww_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.ww_set_penalty_mode(p_game_code text, p_player_token text, p_mode text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.wormy_worm_games%rowtype;
  v_penalty text;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.ww_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;
  if v_ctx.is_host is false then
    raise exception 'Only host can set penalty mode.';
  end if;
  if p_mode not in ('auto', 'own') then
    raise exception 'Invalid penalty mode.';
  end if;

  select * into v_game
  from public.wormy_worm_games
  where lobby_id = v_ctx.lobby_id
  for update;

  if not found or v_game.phase <> 'penalty_mode' then
    raise exception 'Penalty mode selection is not active.';
  end if;

  if p_mode = 'auto' then
    v_penalty := public.ww_pick_auto_penalty(v_game.auto_penalties);
    update public.wormy_worm_games
    set penalty_mode = 'auto',
        penalty_text = v_penalty,
        phase = 'penalty_ready',
        waiting_on = jsonb_build_array(v_ctx.player_id::text),
        last_error = null
    where lobby_id = v_ctx.lobby_id;
  else
    update public.wormy_worm_games
    set penalty_mode = 'own',
        penalty_text = null,
        phase = 'penalty_custom',
        waiting_on = jsonb_build_array(v_ctx.player_id::text),
        last_error = null
    where lobby_id = v_ctx.lobby_id;
  end if;

  return public.ww_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.ww_set_custom_penalty(p_game_code text, p_player_token text, p_penalty_text text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.wormy_worm_games%rowtype;
  v_penalty text;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.ww_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;
  if v_ctx.is_host is false then
    raise exception 'Only host can set custom penalty.';
  end if;

  v_penalty := left(trim(coalesce(p_penalty_text, '')), 20);
  if char_length(v_penalty) = 0 then
    raise exception 'Penalty is required.';
  end if;

  select * into v_game
  from public.wormy_worm_games
  where lobby_id = v_ctx.lobby_id
  for update;

  if not found or v_game.phase <> 'penalty_custom' then
    raise exception 'Custom penalty input is not active.';
  end if;

  update public.wormy_worm_games
  set penalty_mode = 'own',
      penalty_text = v_penalty,
      phase = 'penalty_ready',
      waiting_on = jsonb_build_array(v_ctx.player_id::text),
      last_error = null
  where lobby_id = v_ctx.lobby_id;

  return public.ww_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.ww_reroll_penalty(p_game_code text, p_player_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.wormy_worm_games%rowtype;
  v_penalty text;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.ww_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;
  if v_ctx.is_host is false then
    raise exception 'Only host can re-spin penalty.';
  end if;

  select * into v_game
  from public.wormy_worm_games
  where lobby_id = v_ctx.lobby_id
  for update;

  if not found or v_game.phase <> 'penalty_ready' or v_game.penalty_mode <> 'auto' then
    raise exception 'Auto penalty re-spin is not active.';
  end if;

  v_penalty := public.ww_pick_auto_penalty(v_game.auto_penalties);

  update public.wormy_worm_games
  set penalty_text = v_penalty,
      waiting_on = jsonb_build_array(v_ctx.player_id::text),
      last_error = null
  where lobby_id = v_ctx.lobby_id;

  return public.ww_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.ww_play_again(p_game_code text, p_player_token text, p_auto_penalties jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.wormy_worm_games%rowtype;
  v_order jsonb;
  v_penalties jsonb;
  v_draw_plan jsonb;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.ww_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;
  if v_ctx.is_host is false then
    raise exception 'Only host can play again.';
  end if;

  select * into v_game
  from public.wormy_worm_games
  where lobby_id = v_ctx.lobby_id
  for update;

  if not found then
    raise exception 'Game runtime not initialized.';
  end if;

  v_order := public.rd_player_order(v_ctx.lobby_id);
  v_penalties := coalesce(p_auto_penalties, v_game.auto_penalties);
  if jsonb_typeof(v_penalties) <> 'array' then
    v_penalties := '[]'::jsonb;
  end if;
  v_draw_plan := public.ww_generate_draw_plan(v_order, 3);

  update public.wormy_worm_games
  set phase = 'rules',
      waiting_on = public.ww_active_player_ids(v_ctx.lobby_id),
      player_order = v_order,
      turn_index = 0,
      round_number = 1,
      penalty_mode = null,
      penalty_text = null,
      auto_penalties = v_penalties,
      draw_plan = v_draw_plan,
      revealed_draws = '{}'::jsonb,
      scores = public.rd_zero_scores(v_order),
      current_drawer_id = null,
      current_draw_count = null,
      last_error = null
  where lobby_id = v_ctx.lobby_id;

  return public.ww_get_state(p_game_code, p_player_token);
end;
$$;

grant execute on function public.ww_player_context(text, text) to anon, authenticated;
grant execute on function public.ww_active_player_ids(uuid) to anon, authenticated;
grant execute on function public.ww_remove_waiting(jsonb, uuid) to anon, authenticated;
grant execute on function public.ww_weighted_draw() to anon, authenticated;
grant execute on function public.ww_pick_auto_penalty(jsonb) to anon, authenticated;
grant execute on function public.ww_generate_draw_plan(jsonb, integer) to anon, authenticated;
grant execute on function public.ww_prepare_turn(uuid) to anon, authenticated;
grant execute on function public.ww_get_state(text, text) to anon, authenticated;
grant execute on function public.ww_init_game(text, text, jsonb) to anon, authenticated;
grant execute on function public.ww_continue(text, text) to anon, authenticated;
grant execute on function public.ww_set_penalty_mode(text, text, text) to anon, authenticated;
grant execute on function public.ww_set_custom_penalty(text, text, text) to anon, authenticated;
grant execute on function public.ww_reroll_penalty(text, text) to anon, authenticated;
grant execute on function public.ww_play_again(text, text, jsonb) to anon, authenticated;

