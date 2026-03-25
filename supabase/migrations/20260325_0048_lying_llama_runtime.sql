-- Lying Llama runtime (v1)

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

create table if not exists public.lying_llama_games (
  lobby_id uuid primary key references public.game_lobbies(id) on delete cascade,
  phase text not null default 'rules' check (
    phase in (
      'rules',
      'deal_reveal',
      'turn_prompt',
      'charlatan_prompt',
      'charlatan_call',
      'charlatan_battle',
      'charlatan_vote',
      'penalty_prompt',
      'penalty_confirm',
      'turn_result',
      'result'
    )
  ),
  waiting_on jsonb not null default '[]'::jsonb,
  active_asker_id uuid references public.lobby_players(id) on delete set null,
  active_target_id uuid references public.lobby_players(id) on delete set null,
  selected_animal text,
  charlatan_prompt text,
  battle_prompt text,
  battle_votes jsonb not null default '{}'::jsonb,
  penalty_animal text,
  last_outcome_type text,
  last_outcome_text text,
  last_winner_id uuid references public.lobby_players(id) on delete set null,
  last_loser_id uuid references public.lobby_players(id) on delete set null,
  last_card_won text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_lying_llama_games_updated_at on public.lying_llama_games;
create trigger set_lying_llama_games_updated_at
before update on public.lying_llama_games
for each row execute function public.set_updated_at();

create table if not exists public.lying_llama_player_state (
  lobby_id uuid not null references public.game_lobbies(id) on delete cascade,
  player_id uuid not null references public.lobby_players(id) on delete cascade,
  turn_order integer not null,
  stack jsonb not null default '[]'::jsonb,
  collected_cards jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (lobby_id, player_id)
);

drop trigger if exists set_lying_llama_player_state_updated_at on public.lying_llama_player_state;
create trigger set_lying_llama_player_state_updated_at
before update on public.lying_llama_player_state
for each row execute function public.set_updated_at();

create unique index if not exists lying_llama_player_state_order_uidx
  on public.lying_llama_player_state(lobby_id, turn_order);

alter table public.lying_llama_games enable row level security;
alter table public.lying_llama_player_state enable row level security;
revoke all on table public.lying_llama_games from anon, authenticated;
revoke all on table public.lying_llama_player_state from anon, authenticated;

create or replace function public.ll_player_context(p_game_code text, p_player_token text)
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

create or replace function public.ll_remove_waiting(p_waiting jsonb, p_player_id uuid)
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

create or replace function public.ll_waiting_pair(p_one uuid, p_two uuid)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_array(p_one::text, p_two::text);
$$;

create or replace function public.ll_build_player_stack()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_animals text[] := array['Crazy Llama', 'Poison Dart Frog', 'Mountain Gorilla'];
  v_ordered text[];
  v_char_idx integer;
  v_stack jsonb := '[]'::jsonb;
  i integer;
begin
  select array_agg(s.animal)
  into v_ordered
  from (
    select unnest(v_animals) as animal
    order by random()
  ) s;

  v_char_idx := floor(random() * 3)::integer + 1;

  for i in 1..array_length(v_ordered, 1) loop
    v_stack := v_stack || jsonb_build_array(
      jsonb_build_object(
        'animal', v_ordered[i],
        'isCharlatan', i = v_char_idx
      )
    );
  end loop;

  return v_stack;
end;
$$;

create or replace function public.ll_cards_remaining(p_lobby_id uuid, p_player_id uuid)
returns integer
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_array_length(ps.stack), 0)
  from public.lying_llama_player_state ps
  where ps.lobby_id = p_lobby_id
    and ps.player_id = p_player_id
  limit 1;
$$;

create or replace function public.ll_collected_count(p_lobby_id uuid, p_player_id uuid)
returns integer
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_array_length(ps.collected_cards), 0)
  from public.lying_llama_player_state ps
  where ps.lobby_id = p_lobby_id
    and ps.player_id = p_player_id
  limit 1;
$$;

create or replace function public.ll_next_active_player(p_lobby_id uuid, p_after_order integer)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player uuid;
begin
  select ps.player_id into v_player
  from public.lying_llama_player_state ps
  where ps.lobby_id = p_lobby_id
    and ps.turn_order > p_after_order
    and jsonb_array_length(ps.stack) > 0
  order by ps.turn_order
  limit 1;

  if v_player is not null then
    return v_player;
  end if;

  select ps.player_id into v_player
  from public.lying_llama_player_state ps
  where ps.lobby_id = p_lobby_id
    and ps.turn_order <= p_after_order
    and jsonb_array_length(ps.stack) > 0
  order by ps.turn_order
  limit 1;

  return v_player;
end;
$$;

create or replace function public.ll_top_card(p_lobby_id uuid, p_player_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select ps.stack -> 0
  from public.lying_llama_player_state ps
  where ps.lobby_id = p_lobby_id
    and ps.player_id = p_player_id
  limit 1;
$$;

create or replace function public.ll_transfer_top_card(p_lobby_id uuid, p_from_player uuid, p_to_player uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stack jsonb;
  v_card jsonb;
  v_remaining jsonb;
begin
  select ps.stack
  into v_stack
  from public.lying_llama_player_state ps
  where ps.lobby_id = p_lobby_id
    and ps.player_id = p_from_player
  for update;

  if v_stack is null or jsonb_array_length(v_stack) = 0 then
    return null;
  end if;

  v_card := v_stack -> 0;
  select coalesce(jsonb_agg(e.value order by e.ord), '[]'::jsonb)
  into v_remaining
  from jsonb_array_elements(v_stack) with ordinality as e(value, ord)
  where e.ord > 1;

  update public.lying_llama_player_state
  set stack = v_remaining
  where lobby_id = p_lobby_id
    and player_id = p_from_player;

  update public.lying_llama_player_state
  set collected_cards = coalesce(collected_cards, '[]'::jsonb) || jsonb_build_array(v_card)
  where lobby_id = p_lobby_id
    and player_id = p_to_player;

  return v_card;
end;
$$;

create or replace function public.ll_penalty_text(p_animal text)
returns text
language sql
immutable
as $$
  select case
    when p_animal = 'Crazy Llama' then 'Make a weird llama noise.'
    when p_animal = 'Poison Dart Frog' then 'Crouch low and make a tiny frog noise.'
    when p_animal = 'Mountain Gorilla' then 'Beat your chest and make a gorilla noise.'
    else 'Do your penalty.'
  end;
$$;

create or replace function public.ll_random_charlatan_prompt()
returns text
language sql
security definer
set search_path = public
as $$
  select p.prompt
  from (
    values
      ('Hop on one leg while you answer.'),
      ('Touch your nose while you answer.'),
      ('Blink twice before you answer.'),
      ('Say it in a robot voice.'),
      ('Put one hand on your head while you answer.'),
      ('Answer while smiling.'),
      ('Shrug while you answer.'),
      ('Tap your shoulder before you answer.'),
      ('Answer in a whisper.'),
      ('Tilt your head while you answer.')
  ) as p(prompt)
  order by random()
  limit 1;
$$;

create or replace function public.ll_random_battle_prompt()
returns text
language sql
security definer
set search_path = public
as $$
  select p.prompt
  from (
    values
      ('First person to touch red gets this card.'),
      ('First person to stand up gets this card.'),
      ('First person to clap 3 times gets this card.'),
      ('First person to touch their head gets this card.'),
      ('First person to point at the ceiling gets this card.'),
      ('First person to touch the floor gets this card.'),
      ('First person to say "llama" gets this card.')
  ) as p(prompt)
  order by random()
  limit 1;
$$;

create or replace function public.ll_advance_turn(p_lobby_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.lying_llama_games%rowtype;
  v_active_count integer;
  v_current_order integer;
  v_next_asker uuid;
  v_next_target uuid;
begin
  select * into v_game
  from public.lying_llama_games
  where lobby_id = p_lobby_id
  for update;

  if not found then
    return;
  end if;

  select count(*) into v_active_count
  from public.lying_llama_player_state ps
  where ps.lobby_id = p_lobby_id
    and jsonb_array_length(ps.stack) > 0;

  if v_active_count < 2 then
    update public.lying_llama_games
    set phase = 'result',
        waiting_on = '[]'::jsonb,
        active_asker_id = null,
        active_target_id = null,
        selected_animal = null,
        charlatan_prompt = null,
        battle_prompt = null,
        battle_votes = '{}'::jsonb,
        penalty_animal = null
    where lobby_id = p_lobby_id;
    return;
  end if;

  select ps.turn_order into v_current_order
  from public.lying_llama_player_state ps
  where ps.lobby_id = p_lobby_id
    and ps.player_id = v_game.active_asker_id
  limit 1;

  if v_current_order is null then
    v_current_order := 0;
  end if;

  v_next_asker := public.ll_next_active_player(p_lobby_id, v_current_order);
  if v_next_asker is null then
    update public.lying_llama_games
    set phase = 'result',
        waiting_on = '[]'::jsonb,
        active_asker_id = null,
        active_target_id = null
    where lobby_id = p_lobby_id;
    return;
  end if;

  select ps.turn_order into v_current_order
  from public.lying_llama_player_state ps
  where ps.lobby_id = p_lobby_id
    and ps.player_id = v_next_asker
  limit 1;

  v_next_target := public.ll_next_active_player(p_lobby_id, v_current_order);
  if v_next_target is null or v_next_target = v_next_asker then
    update public.lying_llama_games
    set phase = 'result',
        waiting_on = '[]'::jsonb,
        active_asker_id = null,
        active_target_id = null
    where lobby_id = p_lobby_id;
    return;
  end if;

  update public.lying_llama_games
  set phase = 'turn_prompt',
      waiting_on = '[]'::jsonb,
      active_asker_id = v_next_asker,
      active_target_id = v_next_target,
      selected_animal = null,
      charlatan_prompt = null,
      battle_prompt = null,
      battle_votes = '{}'::jsonb,
      penalty_animal = null,
      last_error = null
  where lobby_id = p_lobby_id;
end;
$$;

create or replace function public.ll_get_state(p_game_code text, p_player_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.lying_llama_games%rowtype;
  v_players jsonb;
  v_you_stack jsonb;
  v_scores jsonb;
  v_winner_ids jsonb;
begin
  perform public.cleanup_lobby_presence(p_game_code);

  select * into v_ctx from public.ll_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_game
  from public.lying_llama_games
  where lobby_id = v_ctx.lobby_id;

  if not found then
    raise exception 'Game runtime not initialized.';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'name', p.display_name,
        'isHost', p.is_host,
        'turnOrder', ps.turn_order,
        'cardsRemaining', coalesce(jsonb_array_length(ps.stack), 0),
        'collectedCount', coalesce(jsonb_array_length(ps.collected_cards), 0),
        'isOut', coalesce(jsonb_array_length(ps.stack), 0) = 0
      )
      order by ps.turn_order
    ),
    '[]'::jsonb
  )
  into v_players
  from public.lobby_players p
  join public.lying_llama_player_state ps
    on ps.lobby_id = p.lobby_id
   and ps.player_id = p.id
  where p.lobby_id = v_ctx.lobby_id;

  select coalesce(ps.stack, '[]'::jsonb)
  into v_you_stack
  from public.lying_llama_player_state ps
  where ps.lobby_id = v_ctx.lobby_id
    and ps.player_id = v_ctx.player_id
  limit 1;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'playerId', p.id,
        'name', p.display_name,
        'collectedCount', coalesce(jsonb_array_length(ps.collected_cards), 0)
      )
      order by ps.turn_order
    ),
    '[]'::jsonb
  )
  into v_scores
  from public.lobby_players p
  join public.lying_llama_player_state ps
    on ps.lobby_id = p.lobby_id
   and ps.player_id = p.id
  where p.lobby_id = v_ctx.lobby_id;

  with score_rows as (
    select p.id as player_id,
           coalesce(jsonb_array_length(ps.collected_cards), 0) as score
    from public.lobby_players p
    join public.lying_llama_player_state ps
      on ps.lobby_id = p.lobby_id
     and ps.player_id = p.id
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
    'players', v_players,
    'scores', v_scores,
    'winnerIds', v_winner_ids,
    'activeAskerId', v_game.active_asker_id,
    'activeTargetId', v_game.active_target_id,
    'selectedAnimal', v_game.selected_animal,
    'charlatanPrompt', v_game.charlatan_prompt,
    'battlePrompt', v_game.battle_prompt,
    'battleVotes', coalesce(v_game.battle_votes, '{}'::jsonb),
    'penaltyAnimal', v_game.penalty_animal,
    'penaltyText', case when v_game.penalty_animal is null then null else public.ll_penalty_text(v_game.penalty_animal) end,
    'waitingOn', coalesce(v_game.waiting_on, '[]'::jsonb),
    'lastOutcomeType', v_game.last_outcome_type,
    'lastOutcomeText', v_game.last_outcome_text,
    'lastWinnerId', v_game.last_winner_id,
    'lastLoserId', v_game.last_loser_id,
    'lastCardWon', v_game.last_card_won,
    'lastError', v_game.last_error,
    'you', jsonb_build_object(
      'id', v_ctx.player_id,
      'name', v_ctx.player_name,
      'isHost', v_ctx.is_host,
      'stack', v_you_stack,
      'cardsRemaining', coalesce(jsonb_array_length(v_you_stack), 0),
      'collectedCount', public.ll_collected_count(v_ctx.lobby_id, v_ctx.player_id)
    )
  );
end;
$$;

create or replace function public.ll_init_game(p_game_code text, p_player_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_first_asker uuid;
  v_first_target uuid;
  v_first_order integer;
begin
  perform public.cleanup_lobby_presence(p_game_code);

  select * into v_ctx from public.ll_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  if v_ctx.game_slug <> 'lying-llama' then
    raise exception 'Game mismatch.';
  end if;

  if v_ctx.lobby_status <> 'started' then
    raise exception 'Game has not started.';
  end if;

  insert into public.lying_llama_player_state (lobby_id, player_id, turn_order, stack, collected_cards)
  select
    p.lobby_id,
    p.id,
    row_number() over (order by p.created_at),
    public.ll_build_player_stack(),
    '[]'::jsonb
  from public.lobby_players p
  where p.lobby_id = v_ctx.lobby_id
  on conflict (lobby_id, player_id) do nothing;

  select ps.player_id, ps.turn_order
  into v_first_asker, v_first_order
  from public.lying_llama_player_state ps
  where ps.lobby_id = v_ctx.lobby_id
  order by ps.turn_order
  limit 1;

  v_first_target := public.ll_next_active_player(v_ctx.lobby_id, coalesce(v_first_order, 0));

  insert into public.lying_llama_games (
    lobby_id,
    phase,
    waiting_on,
    active_asker_id,
    active_target_id
  )
  values (
    v_ctx.lobby_id,
    'rules',
    public.cc_active_player_ids(v_ctx.lobby_id),
    v_first_asker,
    v_first_target
  )
  on conflict (lobby_id) do nothing;

  return public.ll_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.ll_continue(p_game_code text, p_player_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.lying_llama_games%rowtype;
  v_waiting jsonb;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.ll_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_game from public.lying_llama_games where lobby_id = v_ctx.lobby_id;
  if not found then
    raise exception 'Game runtime not initialized.';
  end if;

  if v_game.phase in ('rules', 'deal_reveal', 'charlatan_battle', 'turn_result') then
    if not exists (
      select 1
      from jsonb_array_elements_text(coalesce(v_game.waiting_on, '[]'::jsonb)) as w(value)
      where w.value = v_ctx.player_id::text
    ) then
      raise exception 'Waiting for another player.';
    end if;

    v_waiting := public.ll_remove_waiting(v_game.waiting_on, v_ctx.player_id);
    update public.lying_llama_games
    set waiting_on = v_waiting
    where lobby_id = v_ctx.lobby_id;

    if jsonb_array_length(v_waiting) = 0 then
      if v_game.phase = 'rules' then
        update public.lying_llama_games
        set phase = 'deal_reveal',
            waiting_on = public.cc_active_player_ids(v_ctx.lobby_id),
            last_error = null
        where lobby_id = v_ctx.lobby_id;
      elsif v_game.phase = 'deal_reveal' then
        update public.lying_llama_games
        set phase = 'turn_prompt',
            waiting_on = '[]'::jsonb,
            last_error = null
        where lobby_id = v_ctx.lobby_id;
      elsif v_game.phase = 'charlatan_battle' then
        update public.lying_llama_games
        set phase = 'charlatan_vote',
            waiting_on = public.ll_waiting_pair(v_game.active_asker_id, v_game.active_target_id),
            battle_votes = '{}'::jsonb,
            last_error = null
        where lobby_id = v_ctx.lobby_id;
      elsif v_game.phase = 'turn_result' then
        perform public.ll_advance_turn(v_ctx.lobby_id);
      end if;
    end if;
  elsif v_game.phase = 'charlatan_prompt' then
    if v_ctx.player_id <> v_game.active_target_id then
      raise exception 'Only the target can continue.';
    end if;
    update public.lying_llama_games
    set phase = 'charlatan_call',
        waiting_on = jsonb_build_array(v_game.active_asker_id::text),
        last_error = null
    where lobby_id = v_ctx.lobby_id;
  elsif v_game.phase = 'penalty_prompt' then
    if v_ctx.player_id <> v_game.active_asker_id then
      raise exception 'Only the guesser can continue.';
    end if;
    update public.lying_llama_games
    set phase = 'penalty_confirm',
        waiting_on = jsonb_build_array(v_game.active_target_id::text),
        last_error = null
    where lobby_id = v_ctx.lobby_id;
  else
    raise exception 'Continue is not available right now.';
  end if;

  return public.ll_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.ll_pick_animal(p_game_code text, p_player_token text, p_animal text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.lying_llama_games%rowtype;
  v_top jsonb;
  v_animal text;
  v_is_charlatan boolean;
  v_is_correct boolean;
  v_card jsonb;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.ll_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_game from public.lying_llama_games where lobby_id = v_ctx.lobby_id;
  if not found or v_game.phase <> 'turn_prompt' then
    raise exception 'Turn prompt is not active.';
  end if;
  if v_game.active_asker_id <> v_ctx.player_id then
    raise exception 'It is not your turn.';
  end if;

  if p_animal not in ('Crazy Llama', 'Poison Dart Frog', 'Mountain Gorilla') then
    raise exception 'Invalid animal guess.';
  end if;

  v_top := public.ll_top_card(v_ctx.lobby_id, v_game.active_target_id);
  if v_top is null then
    perform public.ll_advance_turn(v_ctx.lobby_id);
    return public.ll_get_state(p_game_code, p_player_token);
  end if;

  v_animal := coalesce(v_top ->> 'animal', '');
  v_is_charlatan := coalesce((v_top ->> 'isCharlatan')::boolean, false);

  if v_is_charlatan then
    update public.lying_llama_games
    set phase = 'charlatan_prompt',
        selected_animal = p_animal,
        charlatan_prompt = public.ll_random_charlatan_prompt(),
        waiting_on = jsonb_build_array(v_game.active_target_id::text),
        battle_prompt = null,
        battle_votes = '{}'::jsonb,
        penalty_animal = null,
        last_error = null
    where lobby_id = v_ctx.lobby_id;
  else
    v_is_correct := lower(trim(p_animal)) = lower(trim(v_animal));
    if v_is_correct then
      v_card := public.ll_transfer_top_card(v_ctx.lobby_id, v_game.active_target_id, v_game.active_asker_id);
      update public.lying_llama_games
      set phase = 'turn_result',
          waiting_on = public.cc_active_player_ids(v_ctx.lobby_id),
          selected_animal = p_animal,
          last_outcome_type = 'correct_guess',
          last_outcome_text = 'Correct guess. Card won.',
          last_winner_id = v_game.active_asker_id,
          last_loser_id = v_game.active_target_id,
          last_card_won = coalesce(v_card ->> 'animal', v_animal),
          last_error = null
      where lobby_id = v_ctx.lobby_id;
    else
      update public.lying_llama_games
      set phase = 'penalty_prompt',
          waiting_on = jsonb_build_array(v_game.active_asker_id::text),
          selected_animal = p_animal,
          penalty_animal = p_animal,
          last_outcome_type = 'wrong_guess',
          last_outcome_text = 'Wrong guess. Do the penalty.',
          last_winner_id = null,
          last_loser_id = v_game.active_asker_id,
          last_card_won = null,
          last_error = null
      where lobby_id = v_ctx.lobby_id;
    end if;
  end if;

  return public.ll_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.ll_charlatan_decision(p_game_code text, p_player_token text, p_call_charlatan boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.lying_llama_games%rowtype;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.ll_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_game from public.lying_llama_games where lobby_id = v_ctx.lobby_id;
  if not found or v_game.phase <> 'charlatan_call' then
    raise exception 'Charlatan call is not active.';
  end if;
  if v_ctx.player_id <> v_game.active_asker_id then
    raise exception 'Only the asker can choose.';
  end if;

  if p_call_charlatan then
    update public.lying_llama_games
    set phase = 'charlatan_battle',
        waiting_on = public.ll_waiting_pair(v_game.active_asker_id, v_game.active_target_id),
        battle_prompt = public.ll_random_battle_prompt(),
        battle_votes = '{}'::jsonb,
        last_outcome_type = 'charlatan_called',
        last_outcome_text = 'Charlatan called. Battle time.',
        last_error = null
    where lobby_id = v_ctx.lobby_id;
  else
    update public.lying_llama_games
    set phase = 'turn_result',
        waiting_on = public.cc_active_player_ids(v_ctx.lobby_id),
        last_outcome_type = 'charlatan_escaped',
        last_outcome_text = 'Charlatan was not called. No card won.',
        last_winner_id = v_game.active_target_id,
        last_loser_id = v_game.active_asker_id,
        last_card_won = null,
        last_error = null
    where lobby_id = v_ctx.lobby_id;
  end if;

  return public.ll_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.ll_confirm_penalty(p_game_code text, p_player_token text, p_accepted boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.lying_llama_games%rowtype;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.ll_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_game from public.lying_llama_games where lobby_id = v_ctx.lobby_id;
  if not found or v_game.phase <> 'penalty_confirm' then
    raise exception 'Penalty confirmation is not active.';
  end if;
  if v_ctx.player_id <> v_game.active_target_id then
    raise exception 'Only the target can confirm the penalty.';
  end if;

  if p_accepted then
    update public.lying_llama_games
    set phase = 'turn_result',
        waiting_on = public.cc_active_player_ids(v_ctx.lobby_id),
        last_outcome_type = 'wrong_guess_penalty_done',
        last_outcome_text = 'Wrong guess penalty accepted.',
        last_winner_id = null,
        last_loser_id = v_game.active_asker_id,
        last_card_won = null,
        last_error = null
    where lobby_id = v_ctx.lobby_id;
  else
    update public.lying_llama_games
    set phase = 'penalty_prompt',
        waiting_on = jsonb_build_array(v_game.active_asker_id::text),
        last_error = 'Do it again.'
    where lobby_id = v_ctx.lobby_id;
  end if;

  return public.ll_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.ll_vote_battle_winner(p_game_code text, p_player_token text, p_winner_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.lying_llama_games%rowtype;
  v_votes jsonb;
  v_asker_vote text;
  v_target_vote text;
  v_card jsonb;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.ll_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_game from public.lying_llama_games where lobby_id = v_ctx.lobby_id;
  if not found or v_game.phase <> 'charlatan_vote' then
    raise exception 'Charlatan vote is not active.';
  end if;
  if v_ctx.player_id not in (v_game.active_asker_id, v_game.active_target_id) then
    raise exception 'Only battle players can vote.';
  end if;
  if p_winner_player_id not in (v_game.active_asker_id, v_game.active_target_id) then
    raise exception 'Invalid winner selection.';
  end if;

  v_votes := jsonb_set(coalesce(v_game.battle_votes, '{}'::jsonb), array[v_ctx.player_id::text], to_jsonb(p_winner_player_id::text), true);

  update public.lying_llama_games
  set battle_votes = v_votes,
      waiting_on = public.ll_remove_waiting(v_game.waiting_on, v_ctx.player_id),
      last_error = null
  where lobby_id = v_ctx.lobby_id;

  select * into v_game from public.lying_llama_games where lobby_id = v_ctx.lobby_id;

  v_asker_vote := coalesce(v_game.battle_votes ->> v_game.active_asker_id::text, '');
  v_target_vote := coalesce(v_game.battle_votes ->> v_game.active_target_id::text, '');

  if v_asker_vote = '' or v_target_vote = '' then
    return public.ll_get_state(p_game_code, p_player_token);
  end if;

  if v_asker_vote <> v_target_vote then
    update public.lying_llama_games
    set battle_votes = '{}'::jsonb,
        waiting_on = public.ll_waiting_pair(v_game.active_asker_id, v_game.active_target_id),
        last_error = 'Votes did not match. Vote again.'
    where lobby_id = v_ctx.lobby_id;
    return public.ll_get_state(p_game_code, p_player_token);
  end if;

  v_card := public.ll_transfer_top_card(v_ctx.lobby_id, v_game.active_target_id, v_asker_vote::uuid);

  update public.lying_llama_games
  set phase = 'turn_result',
      waiting_on = public.cc_active_player_ids(v_ctx.lobby_id),
      last_outcome_type = 'charlatan_caught',
      last_outcome_text = 'Charlatan battle resolved.',
      last_winner_id = v_asker_vote::uuid,
      last_loser_id = case when v_asker_vote::uuid = v_game.active_asker_id then v_game.active_target_id else v_game.active_asker_id end,
      last_card_won = coalesce(v_card ->> 'animal', null),
      battle_votes = '{}'::jsonb,
      last_error = null
  where lobby_id = v_ctx.lobby_id;

  return public.ll_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.ll_play_again(p_game_code text, p_player_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_first_asker uuid;
  v_first_target uuid;
  v_first_order integer;
begin
  perform public.cleanup_lobby_presence(p_game_code);
  select * into v_ctx from public.ll_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;
  if v_ctx.is_host is false then
    raise exception 'Only host can play again.';
  end if;

  update public.lying_llama_player_state
  set stack = public.ll_build_player_stack(),
      collected_cards = '[]'::jsonb
  where lobby_id = v_ctx.lobby_id;

  select ps.player_id, ps.turn_order
  into v_first_asker, v_first_order
  from public.lying_llama_player_state ps
  where ps.lobby_id = v_ctx.lobby_id
  order by ps.turn_order
  limit 1;

  v_first_target := public.ll_next_active_player(v_ctx.lobby_id, coalesce(v_first_order, 0));

  update public.lying_llama_games
  set phase = 'rules',
      waiting_on = public.cc_active_player_ids(v_ctx.lobby_id),
      active_asker_id = v_first_asker,
      active_target_id = v_first_target,
      selected_animal = null,
      charlatan_prompt = null,
      battle_prompt = null,
      battle_votes = '{}'::jsonb,
      penalty_animal = null,
      last_outcome_type = null,
      last_outcome_text = null,
      last_winner_id = null,
      last_loser_id = null,
      last_card_won = null,
      last_error = null
  where lobby_id = v_ctx.lobby_id;

  return public.ll_get_state(p_game_code, p_player_token);
end;
$$;

grant execute on function public.ll_player_context(text, text) to anon, authenticated;
grant execute on function public.ll_remove_waiting(jsonb, uuid) to anon, authenticated;
grant execute on function public.ll_waiting_pair(uuid, uuid) to anon, authenticated;
grant execute on function public.ll_build_player_stack() to anon, authenticated;
grant execute on function public.ll_cards_remaining(uuid, uuid) to anon, authenticated;
grant execute on function public.ll_collected_count(uuid, uuid) to anon, authenticated;
grant execute on function public.ll_next_active_player(uuid, integer) to anon, authenticated;
grant execute on function public.ll_top_card(uuid, uuid) to anon, authenticated;
grant execute on function public.ll_transfer_top_card(uuid, uuid, uuid) to anon, authenticated;
grant execute on function public.ll_penalty_text(text) to anon, authenticated;
grant execute on function public.ll_random_charlatan_prompt() to anon, authenticated;
grant execute on function public.ll_random_battle_prompt() to anon, authenticated;
grant execute on function public.ll_advance_turn(uuid) to anon, authenticated;
grant execute on function public.ll_get_state(text, text) to anon, authenticated;
grant execute on function public.ll_init_game(text, text) to anon, authenticated;
grant execute on function public.ll_continue(text, text) to anon, authenticated;
grant execute on function public.ll_pick_animal(text, text, text) to anon, authenticated;
grant execute on function public.ll_charlatan_decision(text, text, boolean) to anon, authenticated;
grant execute on function public.ll_confirm_penalty(text, text, boolean) to anon, authenticated;
grant execute on function public.ll_vote_battle_winner(text, text, uuid) to anon, authenticated;
grant execute on function public.ll_play_again(text, text) to anon, authenticated;
