-- Draw WF runtime (isolated, additive)

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

  select * into v_lobby
  from public.game_lobbies
  where game_code = upper(trim(p_game_code))
    and host_secret = p_host_secret
    and status = 'lobby';

  if not found then
    raise exception 'Unable to start game.';
  end if;

  v_min_players := case
    when v_lobby.game_slug in ('draw-wf') then 1
    when v_lobby.game_slug in ('wormy-worm') then 2
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

create table if not exists public.draw_wf_games (
  lobby_id uuid primary key references public.game_lobbies(id) on delete cascade,
  phase text not null default 'rules' check (phase in ('rules','draw_intro','draw_live','guess_intro','guess_live','round_result')),
  waiting_on jsonb not null default '[]'::jsonb,
  player_order jsonb not null default '[]'::jsonb,
  turn_index integer not null default 0,
  round_number integer not null default 0,
  current_round_id uuid,
  current_streak integer not null default 0,
  longest_streak integer not null default 0,
  word_pool jsonb not null default '[]'::jsonb,
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_error text
);

create table if not exists public.draw_wf_rounds (
  id uuid primary key default gen_random_uuid(),
  lobby_id uuid not null references public.game_lobbies(id) on delete cascade,
  round_number integer not null,
  drawer_player_id uuid not null references public.lobby_players(id) on delete cascade,
  word text not null,
  word_mask text not null,
  letter_bank jsonb not null default '[]'::jsonb,
  replay_payload jsonb,
  guesser_ids jsonb not null default '[]'::jsonb,
  draw_deadline_at timestamptz,
  guess_deadline_at timestamptz,
  all_correct boolean,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create table if not exists public.draw_wf_guesses (
  round_id uuid not null references public.draw_wf_rounds(id) on delete cascade,
  player_id uuid not null references public.lobby_players(id) on delete cascade,
  guess_value text not null,
  is_correct boolean not null,
  is_blocking boolean not null default true,
  guessed_at timestamptz not null default now(),
  primary key (round_id, player_id)
);

create index if not exists draw_wf_rounds_lobby_idx on public.draw_wf_rounds (lobby_id, round_number);
create index if not exists draw_wf_guesses_round_idx on public.draw_wf_guesses (round_id);

drop trigger if exists set_draw_wf_games_updated_at on public.draw_wf_games;
create trigger set_draw_wf_games_updated_at
before update on public.draw_wf_games
for each row execute function public.set_updated_at();

alter table public.draw_wf_games enable row level security;
alter table public.draw_wf_rounds enable row level security;
alter table public.draw_wf_guesses enable row level security;
revoke all on table public.draw_wf_games from anon, authenticated;
revoke all on table public.draw_wf_rounds from anon, authenticated;
revoke all on table public.draw_wf_guesses from anon, authenticated;

create or replace function public.dwf_player_context(p_game_code text, p_player_token text)
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

create or replace function public.dwf_active_player_ids(p_lobby_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(p.id::text) order by p.created_at), '[]'::jsonb)
  from public.lobby_players p
  where p.lobby_id = p_lobby_id;
$$;

create or replace function public.dwf_remove_waiting(p_waiting jsonb, p_player_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(value) filter (where value <> to_jsonb(p_player_id::text)), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_waiting, '[]'::jsonb));
$$;

create or replace function public.dwf_word_mask(p_word text)
returns text
language sql
security definer
set search_path = public
as $$
  select trim(replace(repeat('_ ', greatest(length(coalesce(p_word,'')), 1)), '  ', ' '));
$$;

create or replace function public.dwf_pick_word(p_pool jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_word text;
begin
  if jsonb_typeof(p_pool) <> 'array' or jsonb_array_length(p_pool) = 0 then
    return 'CAT';
  end if;

  select upper(trim(value::text)) into v_word
  from jsonb_array_elements_text(p_pool)
  where char_length(trim(value::text)) between 3 and 6
  order by random()
  limit 1;

  return coalesce(v_word, 'CAT');
end;
$$;

create or replace function public.dwf_letter_bank(p_word text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_word text := upper(coalesce(trim(p_word), 'CAT'));
  v_letters text[] := regexp_split_to_array(v_word, '');
  v_vowels text[] := array['A','E','I','O','U'];
  v_cons text[] := array['B','C','D','F','G','H','J','K','L','M','N','P','Q','R','S','T','V','W','X','Y','Z'];
  v_out text[] := array[]::text[];
  v_item text;
begin
  foreach v_item in array v_letters loop
    if v_item <> '' then
      v_out := array_append(v_out, v_item);
    end if;
  end loop;

  v_out := array_append(v_out, v_vowels[1 + floor(random() * array_length(v_vowels,1))::integer]);
  v_out := array_append(v_out, v_cons[1 + floor(random() * array_length(v_cons,1))::integer]);

  return (select jsonb_agg(x) from (select unnest(v_out) as x order by random()) s);
end;
$$;

create or replace function public.dwf_start_round(p_lobby_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.draw_wf_games%rowtype;
  v_order jsonb;
  v_count integer;
  v_drawer_idx integer;
  v_drawer_id uuid;
  v_round integer;
  v_word text;
  v_round_id uuid;
  v_guessers jsonb;
begin
  select * into v_game
  from public.draw_wf_games
  where lobby_id = p_lobby_id
  for update;

  if not found then
    return;
  end if;

  v_order := public.rd_player_order(p_lobby_id);
  v_count := public.rd_player_count(v_order);

  if v_count <= 0 then
    update public.draw_wf_games
    set phase = 'rules', waiting_on = '[]'::jsonb, last_error = 'No active players.'
    where lobby_id = p_lobby_id;
    return;
  end if;

  v_drawer_idx := mod(v_game.turn_index, v_count);
  v_drawer_id := public.rd_player_at(v_order, v_drawer_idx);
  v_round := v_game.round_number + 1;
  v_word := public.dwf_pick_word(v_game.word_pool);

  select coalesce(jsonb_agg(value), '[]'::jsonb)
  into v_guessers
  from jsonb_array_elements(v_order)
  where value <> to_jsonb(v_drawer_id::text);

  insert into public.draw_wf_rounds (
    lobby_id, round_number, drawer_player_id, word, word_mask, letter_bank, guesser_ids
  ) values (
    p_lobby_id, v_round, v_drawer_id, v_word, public.dwf_word_mask(v_word), public.dwf_letter_bank(v_word), coalesce(v_guessers,'[]'::jsonb)
  ) returning id into v_round_id;

  update public.draw_wf_games
  set player_order = v_order,
      phase = 'draw_intro',
      round_number = v_round,
      current_round_id = v_round_id,
      waiting_on = jsonb_build_array(v_drawer_id::text),
      last_activity_at = now(),
      last_error = null
  where lobby_id = p_lobby_id;
end;
$$;

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

  update public.draw_wf_rounds
  set all_correct = v_all_correct,
      closed_at = now()
  where id = v_round.id;

  update public.draw_wf_games
  set phase = 'round_result',
      waiting_on = jsonb_build_array(v_round.drawer_player_id::text),
      current_streak = v_curr,
      longest_streak = v_long,
      last_activity_at = now(),
      last_error = null
  where lobby_id = p_lobby_id;
end;
$$;

create or replace function public.dwf_get_state(p_game_code text, p_player_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.draw_wf_games%rowtype;
  v_round public.draw_wf_rounds%rowtype;
  v_players jsonb;
  v_guess record;
  v_reveal_word text;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.dwf_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_game from public.draw_wf_games where lobby_id = v_ctx.lobby_id;
  if not found then
    return public.dwf_init_game(p_game_code, p_player_token, null);
  end if;

  if v_game.last_activity_at < now() - interval '14 days' then
    raise exception 'This Draw WF room expired. Start a new game.';
  end if;

  if v_game.phase = 'guess_live' and v_game.current_round_id is not null then
    select * into v_round from public.draw_wf_rounds where id = v_game.current_round_id;
    if found and v_round.guess_deadline_at is not null and now() >= v_round.guess_deadline_at and v_round.closed_at is null then
      perform public.dwf_resolve_round(v_ctx.lobby_id);
      select * into v_game from public.draw_wf_games where lobby_id = v_ctx.lobby_id;
    end if;
  end if;

  if v_game.current_round_id is not null then
    select * into v_round from public.draw_wf_rounds where id = v_game.current_round_id;
  end if;

  with ordered as (
    select ordinality - 1 as idx, value::text as player_id_text
    from jsonb_array_elements_text(coalesce(v_game.player_order, '[]'::jsonb)) with ordinality
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id,
      'name', p.display_name,
      'isHost', p.is_host,
      'turnOrder', o.idx,
      'status', 'active',
      'isDrawer', (p.id = v_round.drawer_player_id)
    ) order by o.idx), '[]'::jsonb)
  into v_players
  from ordered o
  join public.lobby_players p
    on p.lobby_id = v_ctx.lobby_id
   and p.id::text = o.player_id_text;

  select g.guess_value, g.is_correct into v_guess
  from public.draw_wf_guesses g
  where g.round_id = v_round.id and g.player_id = v_ctx.player_id;

  if v_game.phase in ('draw_intro','draw_live') and v_ctx.player_id = v_round.drawer_player_id then
    v_reveal_word := v_round.word;
  elsif v_game.phase = 'round_result' then
    v_reveal_word := v_round.word;
  else
    v_reveal_word := null;
  end if;

  return jsonb_build_object(
    'phase', v_game.phase,
    'roundNumber', v_game.round_number,
    'roundId', coalesce(v_game.current_round_id::text, ''),
    'drawerPlayerId', v_round.drawer_player_id,
    'drawerName', (select p.display_name from public.lobby_players p where p.id = v_round.drawer_player_id),
    'wordLength', char_length(coalesce(v_round.word,'')),
    'wordMask', coalesce(v_round.word_mask, '_'),
    'drawDeadlineAt', v_round.draw_deadline_at,
    'guessDeadlineAt', v_round.guess_deadline_at,
    'revealWord', v_reveal_word,
    'letterBank', coalesce(v_round.letter_bank, '[]'::jsonb),
    'replayPayload', v_round.replay_payload,
    'waitingOn', coalesce(v_game.waiting_on, '[]'::jsonb),
    'streak', v_game.current_streak,
    'longestStreak', v_game.longest_streak,
    'allCorrect', v_round.all_correct,
    'yourGuess', coalesce(v_guess.guess_value, null),
    'yourGuessCorrect', v_guess.is_correct,
    'players', v_players,
    'lastError', v_game.last_error,
    'you', jsonb_build_object('id', v_ctx.player_id, 'name', v_ctx.player_name, 'isHost', v_ctx.is_host)
  );
end;
$$;

create or replace function public.dwf_init_game(p_game_code text, p_player_token text, p_word_pool jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_pool jsonb;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.dwf_player_context(p_game_code, p_player_token);
  if not found then raise exception 'Session expired.'; end if;

  if v_ctx.game_slug <> 'draw-wf' then
    raise exception 'Game mismatch.';
  end if;

  if v_ctx.lobby_status <> 'started' then
    raise exception 'Game has not started.';
  end if;

  if exists (select 1 from public.draw_wf_games g where g.lobby_id = v_ctx.lobby_id) then
    return public.dwf_get_state(p_game_code, p_player_token);
  end if;

  v_pool := coalesce(p_word_pool, '[]'::jsonb);
  if jsonb_typeof(v_pool) <> 'array' then
    v_pool := '[]'::jsonb;
  end if;

  insert into public.draw_wf_games (
    lobby_id, phase, waiting_on, player_order, turn_index, round_number,
    current_round_id, current_streak, longest_streak, word_pool, last_activity_at, last_error
  ) values (
    v_ctx.lobby_id,
    'rules',
    public.dwf_active_player_ids(v_ctx.lobby_id),
    public.rd_player_order(v_ctx.lobby_id),
    0,
    0,
    null,
    0,
    0,
    v_pool,
    now(),
    null
  );

  return public.dwf_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.dwf_continue(p_game_code text, p_player_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.draw_wf_games%rowtype;
  v_round public.draw_wf_rounds%rowtype;
  v_waiting jsonb;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.dwf_player_context(p_game_code, p_player_token);
  if not found then raise exception 'Session expired.'; end if;

  select * into v_game from public.draw_wf_games where lobby_id = v_ctx.lobby_id for update;
  if not found then raise exception 'Game runtime not initialized.'; end if;

  if v_game.phase = 'rules' then
    if not (coalesce(v_game.waiting_on,'[]'::jsonb) @> jsonb_build_array(v_ctx.player_id::text)) then
      return public.dwf_get_state(p_game_code, p_player_token);
    end if;

    v_waiting := public.dwf_remove_waiting(v_game.waiting_on, v_ctx.player_id);
    update public.draw_wf_games
    set waiting_on = v_waiting,
        last_activity_at = now()
    where lobby_id = v_ctx.lobby_id;

    if jsonb_array_length(v_waiting) = 0 then
      perform public.dwf_start_round(v_ctx.lobby_id);
    end if;

    return public.dwf_get_state(p_game_code, p_player_token);
  end if;

  select * into v_round from public.draw_wf_rounds where id = v_game.current_round_id for update;

  if v_game.phase = 'draw_intro' then
    if v_ctx.player_id <> v_round.drawer_player_id then
      return public.dwf_get_state(p_game_code, p_player_token);
    end if;

    update public.draw_wf_games
    set phase = 'draw_live',
        waiting_on = jsonb_build_array(v_round.drawer_player_id::text),
        last_activity_at = now(),
        last_error = null
    where lobby_id = v_ctx.lobby_id;

    update public.draw_wf_rounds
    set draw_deadline_at = now() + interval '7 seconds'
    where id = v_round.id;

    return public.dwf_get_state(p_game_code, p_player_token);
  end if;

  if v_game.phase = 'guess_intro' then
    if not (coalesce(v_game.waiting_on,'[]'::jsonb) @> jsonb_build_array(v_ctx.player_id::text)) then
      return public.dwf_get_state(p_game_code, p_player_token);
    end if;

    v_waiting := public.dwf_remove_waiting(v_game.waiting_on, v_ctx.player_id);
    update public.draw_wf_games
    set waiting_on = v_waiting,
        last_activity_at = now()
    where lobby_id = v_ctx.lobby_id;

    if jsonb_array_length(v_waiting) = 0 then
      update public.draw_wf_games
      set phase = 'guess_live',
          waiting_on = coalesce(v_round.guesser_ids, '[]'::jsonb),
          last_activity_at = now(),
          last_error = null
      where lobby_id = v_ctx.lobby_id;

      update public.draw_wf_rounds
      set guess_deadline_at = now() + interval '7 seconds'
      where id = v_round.id;
    end if;

    return public.dwf_get_state(p_game_code, p_player_token);
  end if;

  if v_game.phase = 'round_result' then
    if not (coalesce(v_game.waiting_on,'[]'::jsonb) @> jsonb_build_array(v_ctx.player_id::text)) then
      return public.dwf_get_state(p_game_code, p_player_token);
    end if;

    update public.draw_wf_games
    set turn_index = v_game.turn_index + 1,
        last_activity_at = now(),
        last_error = null
    where lobby_id = v_ctx.lobby_id;

    perform public.dwf_start_round(v_ctx.lobby_id);
    return public.dwf_get_state(p_game_code, p_player_token);
  end if;

  return public.dwf_get_state(p_game_code, p_player_token);
end;
$$;

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

  update public.draw_wf_rounds
  set replay_payload = p_replay_payload
  where id = v_round.id;

  update public.draw_wf_games
  set phase = 'guess_intro',
      waiting_on = coalesce(v_round.guesser_ids, '[]'::jsonb),
      last_activity_at = now(),
      last_error = null
  where lobby_id = v_ctx.lobby_id;

  if jsonb_array_length(coalesce(v_round.guesser_ids, '[]'::jsonb)) = 0 then
    perform public.dwf_resolve_round(v_ctx.lobby_id);
  end if;

  return public.dwf_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.dwf_submit_guess(p_game_code text, p_player_token text, p_guess text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.draw_wf_games%rowtype;
  v_round public.draw_wf_rounds%rowtype;
  v_guess text;
  v_blocking boolean;
  v_waiting jsonb;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.dwf_player_context(p_game_code, p_player_token);
  if not found then raise exception 'Session expired.'; end if;

  select * into v_game from public.draw_wf_games where lobby_id = v_ctx.lobby_id for update;
  if not found or v_game.phase <> 'guess_live' then
    raise exception 'Guessing is not active.';
  end if;

  select * into v_round from public.draw_wf_rounds where id = v_game.current_round_id for update;

  v_guess := upper(trim(coalesce(p_guess,'')));
  v_blocking := (coalesce(v_round.guesser_ids, '[]'::jsonb) @> jsonb_build_array(v_ctx.player_id::text));

  insert into public.draw_wf_guesses (round_id, player_id, guess_value, is_correct, is_blocking)
  values (v_round.id, v_ctx.player_id, v_guess, (v_guess = upper(v_round.word)), v_blocking)
  on conflict (round_id, player_id)
  do update set
    guess_value = excluded.guess_value,
    is_correct = excluded.is_correct,
    is_blocking = excluded.is_blocking,
    guessed_at = now();

  if v_blocking then
    v_waiting := public.dwf_remove_waiting(v_game.waiting_on, v_ctx.player_id);
    update public.draw_wf_games
    set waiting_on = v_waiting,
        last_activity_at = now()
    where lobby_id = v_ctx.lobby_id;

    if jsonb_array_length(v_waiting) = 0 or (v_round.guess_deadline_at is not null and now() >= v_round.guess_deadline_at) then
      perform public.dwf_resolve_round(v_ctx.lobby_id);
    end if;
  end if;

  return public.dwf_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.dwf_play_again(p_game_code text, p_player_token text, p_word_pool jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.draw_wf_games%rowtype;
  v_pool jsonb;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.dwf_player_context(p_game_code, p_player_token);
  if not found then raise exception 'Session expired.'; end if;
  if v_ctx.is_host is false then raise exception 'Only host can play again.'; end if;

  select * into v_game from public.draw_wf_games where lobby_id = v_ctx.lobby_id for update;
  if not found then raise exception 'Game runtime not initialized.'; end if;

  v_pool := coalesce(p_word_pool, v_game.word_pool);
  if jsonb_typeof(v_pool) <> 'array' then
    v_pool := v_game.word_pool;
  end if;

  delete from public.draw_wf_guesses where round_id in (select id from public.draw_wf_rounds where lobby_id = v_ctx.lobby_id);
  delete from public.draw_wf_rounds where lobby_id = v_ctx.lobby_id;

  update public.draw_wf_games
  set phase = 'rules',
      waiting_on = public.dwf_active_player_ids(v_ctx.lobby_id),
      player_order = public.rd_player_order(v_ctx.lobby_id),
      turn_index = 0,
      round_number = 0,
      current_round_id = null,
      current_streak = 0,
      longest_streak = 0,
      word_pool = v_pool,
      last_activity_at = now(),
      last_error = null
  where lobby_id = v_ctx.lobby_id;

  return public.dwf_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.get_draw_wf_stats(p_from date default null)
returns table(
  sessions bigint,
  avg_players_per_session numeric,
  total_rounds bigint,
  total_guesses bigint,
  guess_success_rate numeric,
  avg_room_streak numeric,
  longest_room_streak integer,
  rounds_per_session numeric,
  paid_round_purchases bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from date := coalesce(p_from, current_date - interval '30 days');
begin
  return query
  with game_rows as (
    select g.*,
      coalesce(jsonb_array_length(g.player_order),0) as player_count
    from public.draw_wf_games g
    where g.created_at::date >= v_from
  ),
  round_rows as (
    select r.* from public.draw_wf_rounds r
    where r.created_at::date >= v_from
  ),
  guess_rows as (
    select gg.* from public.draw_wf_guesses gg
    join round_rows rr on rr.id = gg.round_id
    where gg.is_blocking = true
  )
  select
    coalesce((select count(*) from game_rows),0)::bigint,
    coalesce((select avg(player_count)::numeric from game_rows),0),
    coalesce((select count(*) from round_rows),0)::bigint,
    coalesce((select count(*) from guess_rows),0)::bigint,
    coalesce((select avg(case when is_correct then 1.0 else 0.0 end)::numeric from guess_rows),0),
    coalesce((select avg(current_streak)::numeric from game_rows),0),
    coalesce((select max(longest_streak) from game_rows),0)::integer,
    coalesce((select (count(*)::numeric / nullif((select count(*) from game_rows),0)) from round_rows),0),
    0::bigint;
end;
$$;

grant execute on function public.dwf_player_context(text, text) to anon, authenticated;
grant execute on function public.dwf_active_player_ids(uuid) to anon, authenticated;
grant execute on function public.dwf_remove_waiting(jsonb, uuid) to anon, authenticated;
grant execute on function public.dwf_word_mask(text) to anon, authenticated;
grant execute on function public.dwf_pick_word(jsonb) to anon, authenticated;
grant execute on function public.dwf_letter_bank(text) to anon, authenticated;
grant execute on function public.dwf_start_round(uuid) to anon, authenticated;
grant execute on function public.dwf_resolve_round(uuid) to anon, authenticated;
grant execute on function public.dwf_get_state(text, text) to anon, authenticated;
grant execute on function public.dwf_init_game(text, text, jsonb) to anon, authenticated;
grant execute on function public.dwf_continue(text, text) to anon, authenticated;
grant execute on function public.dwf_submit_drawing(text, text, jsonb) to anon, authenticated;
grant execute on function public.dwf_submit_guess(text, text, text) to anon, authenticated;
grant execute on function public.dwf_play_again(text, text, jsonb) to anon, authenticated;
grant execute on function public.get_draw_wf_stats(date) to anon, authenticated;
