-- Murder Club runtime v2
-- Theme + evidence loop aligned with latest game flow mock.

create table if not exists public.murder_club_v2_games (
  lobby_id uuid primary key references public.game_lobbies(id) on delete cascade,
  phase text not null default 'rules' check (
    phase in (
      'rules',
      'role_reveal',
      'round_ready',
      'evidence_reveal',
      'suspect_vote',
      'suspect_result',
      'evidence_vote',
      'evidence_result',
      'result'
    )
  ),
  waiting_on jsonb not null default '[]'::jsonb,
  round_number integer not null default 1,
  target_score integer not null default 3,
  investigator_score integer not null default 0,
  conspirator_score integer not null default 0,
  theme_id text not null default 'holiday-murder',
  evidence_index integer not null default 0,
  suspect_player_id uuid references public.lobby_players(id) on delete set null,
  suspect_vote_result text check (suspect_vote_result in ('selected', 'hung')),
  evidence_vote_result text check (evidence_vote_result in ('admitted', 'rejected', 'hung')),
  suspect_votes jsonb not null default '{}'::jsonb,
  evidence_cards jsonb not null default '{}'::jsonb,
  evidence_votes jsonb not null default '{}'::jsonb,
  conspirator_ids jsonb not null default '[]'::jsonb,
  last_line text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_murder_club_v2_games_updated_at on public.murder_club_v2_games;
create trigger set_murder_club_v2_games_updated_at
before update on public.murder_club_v2_games
for each row execute function public.set_updated_at();

create table if not exists public.murder_club_v2_player_state (
  lobby_id uuid not null references public.game_lobbies(id) on delete cascade,
  player_id uuid not null references public.lobby_players(id) on delete cascade,
  turn_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (lobby_id, player_id)
);

drop trigger if exists set_murder_club_v2_player_state_updated_at on public.murder_club_v2_player_state;
create trigger set_murder_club_v2_player_state_updated_at
before update on public.murder_club_v2_player_state
for each row execute function public.set_updated_at();

create unique index if not exists murder_club_v2_player_state_order_uidx
  on public.murder_club_v2_player_state(lobby_id, turn_order);

alter table public.murder_club_v2_games enable row level security;
alter table public.murder_club_v2_player_state enable row level security;
revoke all on table public.murder_club_v2_games from anon, authenticated;
revoke all on table public.murder_club_v2_player_state from anon, authenticated;

create or replace function public.mc2_player_context(p_game_code text, p_player_token text)
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

create or replace function public.mc2_conspirator_count_for_players(p_player_count integer)
returns integer
language sql
immutable
as $$
  select case
    when p_player_count between 4 and 5 then 1
    when p_player_count between 6 and 8 then 2
    when p_player_count between 9 and 12 then 3
    else 4
  end;
$$;

create or replace function public.mc2_assign_conspirators(p_lobby_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_count integer;
  v_conspirator_count integer;
begin
  select count(*) into v_player_count
  from public.lobby_players p
  where p.lobby_id = p_lobby_id;

  v_conspirator_count := public.mc2_conspirator_count_for_players(v_player_count);

  return (
    select coalesce(jsonb_agg(s.id), '[]'::jsonb)
    from (
      select p.id
      from public.lobby_players p
      where p.lobby_id = p_lobby_id
      order by random()
      limit v_conspirator_count
    ) s
  );
end;
$$;

create or replace function public.mc2_remove_waiting(p_waiting jsonb, p_player_id uuid)
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

create or replace function public.mc2_deal_evidence_cards(
  p_lobby_id uuid,
  p_suspect_player_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cards jsonb := '{}'::jsonb;
  v_row record;
  v_card text;
begin
  for v_row in
    select p.id
    from public.lobby_players p
    where p.lobby_id = p_lobby_id
      and (p_suspect_player_id is null or p.id <> p_suspect_player_id)
    order by random()
  loop
    v_card := case when random() < 0.5 then 'admit' else 'reject' end;
    v_cards := jsonb_set(v_cards, array[v_row.id::text], to_jsonb(v_card), true);
  end loop;
  return v_cards;
end;
$$;

create or replace function public.mc2_get_state(p_game_code text, p_player_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.murder_club_v2_games%rowtype;
  v_players jsonb;
  v_suspect_counts jsonb;
  v_evidence_counts jsonb;
  v_role text;
begin
  perform public.cleanup_lobby_presence(p_game_code);

  select * into v_ctx from public.mc2_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_game
  from public.murder_club_v2_games
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
        'turnOrder', ps.turn_order
      )
      order by ps.turn_order
    ),
    '[]'::jsonb
  )
  into v_players
  from public.lobby_players p
  join public.murder_club_v2_player_state ps
    on ps.lobby_id = p.lobby_id
   and ps.player_id = p.id
  where p.lobby_id = v_ctx.lobby_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'playerId', p.id,
        'count', coalesce(v.cnt, 0)
      )
    ),
    '[]'::jsonb
  )
  into v_suspect_counts
  from public.lobby_players p
  left join (
    select value::uuid as target_id, count(*)::integer as cnt
    from jsonb_each_text(coalesce(v_game.suspect_votes, '{}'::jsonb))
    group by value::uuid
  ) v
    on v.target_id = p.id
  where p.lobby_id = v_ctx.lobby_id;

  select jsonb_build_object(
    'admit', count(*) filter (where lower(value) = 'admit'),
    'reject', count(*) filter (where lower(value) = 'reject')
  )
  into v_evidence_counts
  from jsonb_each_text(coalesce(v_game.evidence_votes, '{}'::jsonb));

  v_role := case
    when exists (
      select 1
      from jsonb_array_elements_text(coalesce(v_game.conspirator_ids, '[]'::jsonb)) t(value)
      where t.value = v_ctx.player_id::text
    ) then 'conspirator'
    else 'investigator'
  end;

  return jsonb_build_object(
    'phase', v_game.phase,
    'roundNumber', v_game.round_number,
    'targetScore', v_game.target_score,
    'investigatorScore', v_game.investigator_score,
    'conspiratorScore', v_game.conspirator_score,
    'themeId', v_game.theme_id,
    'evidenceIndex', v_game.evidence_index,
    'suspectPlayerId', v_game.suspect_player_id,
    'suspectVoteResult', v_game.suspect_vote_result,
    'evidenceVoteResult', v_game.evidence_vote_result,
    'players', v_players,
    'suspectCounts', v_suspect_counts,
    'evidenceCounts', coalesce(v_evidence_counts, jsonb_build_object('admit', 0, 'reject', 0)),
    'waitingOn', coalesce(v_game.waiting_on, '[]'::jsonb),
    'lastLine', v_game.last_line,
    'lastError', v_game.last_error,
    'you', jsonb_build_object(
      'id', v_ctx.player_id,
      'name', v_ctx.player_name,
      'isHost', v_ctx.is_host,
      'role', v_role,
      'evidenceCard', coalesce(v_game.evidence_cards ->> v_ctx.player_id::text, null),
      'isUnderSuspicion', v_game.suspect_player_id = v_ctx.player_id,
      'conspiratorIds', coalesce(v_game.conspirator_ids, '[]'::jsonb)
    )
  );
end;
$$;

create or replace function public.mc2_init_game(p_game_code text, p_player_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_player_count integer;
begin
  perform public.cleanup_lobby_presence(p_game_code);

  select * into v_ctx from public.mc2_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  if v_ctx.game_slug <> 'murder-club' then
    raise exception 'Game mismatch.';
  end if;

  if v_ctx.lobby_status <> 'started' then
    raise exception 'Game has not started.';
  end if;

  insert into public.murder_club_v2_player_state (lobby_id, player_id, turn_order)
  select p.lobby_id, p.id, row_number() over (order by p.created_at)
  from public.lobby_players p
  where p.lobby_id = v_ctx.lobby_id
  on conflict (lobby_id, player_id) do nothing;

  select count(*) into v_player_count
  from public.lobby_players p
  where p.lobby_id = v_ctx.lobby_id;

  if v_player_count < 4 then
    raise exception 'At least 4 players are required.';
  end if;

  insert into public.murder_club_v2_games (
    lobby_id,
    phase,
    waiting_on,
    round_number,
    target_score,
    investigator_score,
    conspirator_score,
    theme_id,
    evidence_index,
    suspect_player_id,
    suspect_vote_result,
    evidence_vote_result,
    suspect_votes,
    evidence_cards,
    evidence_votes,
    conspirator_ids,
    last_line,
    last_error
  )
  values (
    v_ctx.lobby_id,
    'rules',
    public.cc_active_player_ids(v_ctx.lobby_id),
    1,
    3,
    0,
    0,
    'holiday-murder',
    0,
    null,
    null,
    null,
    '{}'::jsonb,
    '{}'::jsonb,
    '{}'::jsonb,
    public.mc2_assign_conspirators(v_ctx.lobby_id),
    null,
    null
  )
  on conflict (lobby_id) do nothing;

  return public.mc2_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.mc2_set_theme(
  p_game_code text,
  p_player_token text,
  p_theme_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.murder_club_v2_games%rowtype;
begin
  select * into v_ctx from public.mc2_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  if v_ctx.is_host is false then
    raise exception 'Only host can change theme.';
  end if;

  select * into v_game
  from public.murder_club_v2_games
  where lobby_id = v_ctx.lobby_id;

  if not found then
    raise exception 'Game runtime not initialized.';
  end if;

  if v_game.phase not in ('rules', 'role_reveal') then
    raise exception 'Theme can only be changed before rounds begin.';
  end if;

  update public.murder_club_v2_games
  set theme_id = lower(trim(p_theme_id)),
      last_error = null
  where lobby_id = v_ctx.lobby_id;

  return public.mc2_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.mc2_continue(p_game_code text, p_player_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.murder_club_v2_games%rowtype;
  v_waiting jsonb;
begin
  select * into v_ctx from public.mc2_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_game
  from public.murder_club_v2_games
  where lobby_id = v_ctx.lobby_id;

  if not found then
    raise exception 'Game runtime not initialized.';
  end if;

  if v_game.phase in ('rules', 'role_reveal', 'round_ready', 'evidence_reveal', 'suspect_result', 'evidence_result') then
    v_waiting := public.mc2_remove_waiting(v_game.waiting_on, v_ctx.player_id);

    update public.murder_club_v2_games
    set waiting_on = v_waiting
    where lobby_id = v_ctx.lobby_id;

    if jsonb_array_length(v_waiting) = 0 then
      if v_game.phase = 'rules' then
        update public.murder_club_v2_games
        set phase = 'role_reveal',
            waiting_on = public.cc_active_player_ids(v_ctx.lobby_id)
        where lobby_id = v_ctx.lobby_id;
      elsif v_game.phase = 'role_reveal' then
        update public.murder_club_v2_games
        set phase = 'round_ready',
            waiting_on = public.cc_active_player_ids(v_ctx.lobby_id)
        where lobby_id = v_ctx.lobby_id;
      elsif v_game.phase = 'round_ready' then
        update public.murder_club_v2_games
        set phase = 'evidence_reveal',
            waiting_on = public.cc_active_player_ids(v_ctx.lobby_id),
            suspect_player_id = null,
            suspect_vote_result = null,
            evidence_vote_result = null,
            suspect_votes = '{}'::jsonb,
            evidence_cards = '{}'::jsonb,
            evidence_votes = '{}'::jsonb
        where lobby_id = v_ctx.lobby_id;
      elsif v_game.phase = 'evidence_reveal' then
        update public.murder_club_v2_games
        set phase = 'suspect_vote',
            waiting_on = '[]'::jsonb,
            suspect_player_id = null,
            suspect_vote_result = null,
            suspect_votes = '{}'::jsonb
        where lobby_id = v_ctx.lobby_id;
      elsif v_game.phase = 'suspect_result' then
        if v_game.suspect_vote_result = 'hung' then
          update public.murder_club_v2_games
          set phase = 'suspect_vote',
              waiting_on = '[]'::jsonb,
              suspect_player_id = null,
              suspect_vote_result = null,
              suspect_votes = '{}'::jsonb
          where lobby_id = v_ctx.lobby_id;
        else
          update public.murder_club_v2_games
          set phase = 'evidence_vote',
              waiting_on = (
                select coalesce(jsonb_agg(p.id::text), '[]'::jsonb)
                from public.lobby_players p
                where p.lobby_id = v_ctx.lobby_id
                  and p.id <> v_game.suspect_player_id
              ),
              evidence_cards = public.mc2_deal_evidence_cards(v_ctx.lobby_id, v_game.suspect_player_id),
              evidence_votes = '{}'::jsonb,
              evidence_vote_result = null
          where lobby_id = v_ctx.lobby_id;
        end if;
      elsif v_game.phase = 'evidence_result' then
        if v_game.investigator_score >= v_game.target_score or v_game.conspirator_score >= v_game.target_score then
          update public.murder_club_v2_games
          set phase = 'result',
              waiting_on = '[]'::jsonb
          where lobby_id = v_ctx.lobby_id;
        else
          update public.murder_club_v2_games
          set phase = 'round_ready',
              waiting_on = public.cc_active_player_ids(v_ctx.lobby_id),
              round_number = v_game.round_number + 1,
              evidence_index = v_game.evidence_index + 1,
              suspect_player_id = null,
              suspect_vote_result = null,
              evidence_vote_result = null,
              suspect_votes = '{}'::jsonb,
              evidence_cards = '{}'::jsonb,
              evidence_votes = '{}'::jsonb,
              last_line = null,
              last_error = null
          where lobby_id = v_ctx.lobby_id;
        end if;
      end if;
    end if;
  else
    raise exception 'Continue is not available in this phase.';
  end if;

  return public.mc2_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.mc2_cast_suspect_vote(
  p_game_code text,
  p_player_token text,
  p_target_player_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.murder_club_v2_games%rowtype;
  v_vote_count integer;
  v_player_count integer;
  v_top_count integer;
  v_top_target uuid;
  v_top_ties integer;
begin
  select * into v_ctx from public.mc2_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_game
  from public.murder_club_v2_games
  where lobby_id = v_ctx.lobby_id;

  if not found or v_game.phase <> 'suspect_vote' then
    raise exception 'Suspect vote is not active.';
  end if;

  if not exists (
    select 1
    from public.lobby_players p
    where p.lobby_id = v_ctx.lobby_id
      and p.id = p_target_player_id
  ) then
    raise exception 'Invalid suspect target.';
  end if;

  update public.murder_club_v2_games
  set suspect_votes = jsonb_set(coalesce(suspect_votes, '{}'::jsonb), array[v_ctx.player_id::text], to_jsonb(p_target_player_id::text), true),
      last_error = null
  where lobby_id = v_ctx.lobby_id;

  select * into v_game
  from public.murder_club_v2_games
  where lobby_id = v_ctx.lobby_id;

  select count(*) into v_vote_count
  from jsonb_each_text(coalesce(v_game.suspect_votes, '{}'::jsonb));

  select count(*) into v_player_count
  from public.lobby_players p
  where p.lobby_id = v_ctx.lobby_id;

  if v_vote_count >= v_player_count then
    with tally as (
      select value::uuid as target_id, count(*)::integer as cnt
      from jsonb_each_text(coalesce(v_game.suspect_votes, '{}'::jsonb))
      group by value::uuid
    )
    select t.cnt, t.target_id
    into v_top_count, v_top_target
    from tally t
    order by t.cnt desc, t.target_id
    limit 1;

    with tally as (
      select value::uuid as target_id, count(*)::integer as cnt
      from jsonb_each_text(coalesce(v_game.suspect_votes, '{}'::jsonb))
      group by value::uuid
    )
    select count(*)
    into v_top_ties
    from tally t
    where t.cnt = v_top_count;

    if coalesce(v_top_ties, 0) > 1 then
      update public.murder_club_v2_games
      set phase = 'suspect_result',
          suspect_player_id = null,
          suspect_vote_result = 'hung',
          waiting_on = public.cc_active_player_ids(v_ctx.lobby_id),
          last_line = 'There was a tie in the suspect vote. Discuss and re-vote to reach a majority.'
      where lobby_id = v_ctx.lobby_id;
    else
      update public.murder_club_v2_games
      set phase = 'suspect_result',
          suspect_player_id = v_top_target,
          suspect_vote_result = 'selected',
          waiting_on = public.cc_active_player_ids(v_ctx.lobby_id),
          last_line = null
      where lobby_id = v_ctx.lobby_id;
    end if;
  end if;

  return public.mc2_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.mc2_cast_evidence_vote(
  p_game_code text,
  p_player_token text,
  p_vote text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.murder_club_v2_games%rowtype;
  v_vote text;
  v_card text;
  v_total_eligible integer;
  v_vote_count integer;
  v_admit integer;
  v_reject integer;
begin
  select * into v_ctx from public.mc2_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_game
  from public.murder_club_v2_games
  where lobby_id = v_ctx.lobby_id;

  if not found or v_game.phase <> 'evidence_vote' then
    raise exception 'Evidence vote is not active.';
  end if;

  if v_game.suspect_player_id = v_ctx.player_id then
    raise exception 'Suspended player cannot vote evidence.';
  end if;

  v_vote := lower(trim(p_vote));
  if v_vote not in ('admit', 'reject') then
    raise exception 'Invalid vote.';
  end if;

  v_card := coalesce(v_game.evidence_cards ->> v_ctx.player_id::text, '');
  if v_card = '' then
    raise exception 'No vote card assigned.';
  end if;
  if v_card <> v_vote then
    raise exception 'You can only cast the card assigned to you.';
  end if;

  update public.murder_club_v2_games
  set evidence_votes = jsonb_set(coalesce(evidence_votes, '{}'::jsonb), array[v_ctx.player_id::text], to_jsonb(v_vote), true),
      last_error = null
  where lobby_id = v_ctx.lobby_id;

  select * into v_game
  from public.murder_club_v2_games
  where lobby_id = v_ctx.lobby_id;

  select count(*) into v_total_eligible
  from public.lobby_players p
  where p.lobby_id = v_ctx.lobby_id
    and p.id <> v_game.suspect_player_id;

  select count(*) into v_vote_count
  from jsonb_each_text(coalesce(v_game.evidence_votes, '{}'::jsonb));

  if v_vote_count >= v_total_eligible then
    select
      count(*) filter (where lower(value) = 'admit'),
      count(*) filter (where lower(value) = 'reject')
    into v_admit, v_reject
    from jsonb_each_text(coalesce(v_game.evidence_votes, '{}'::jsonb));

    if v_admit > v_reject then
      update public.murder_club_v2_games
      set phase = 'evidence_result',
          evidence_vote_result = 'admitted',
          investigator_score = investigator_score + 1,
          waiting_on = public.cc_active_player_ids(v_ctx.lobby_id),
          last_line = 'The evidence will be added to the case file.'
      where lobby_id = v_ctx.lobby_id;
    elsif v_reject > v_admit then
      update public.murder_club_v2_games
      set phase = 'evidence_result',
          evidence_vote_result = 'rejected',
          conspirator_score = conspirator_score + 1,
          waiting_on = public.cc_active_player_ids(v_ctx.lobby_id),
          last_line = 'The evidence will not be added to the case file.'
      where lobby_id = v_ctx.lobby_id;
    else
      update public.murder_club_v2_games
      set phase = 'evidence_result',
          evidence_vote_result = 'hung',
          waiting_on = public.cc_active_player_ids(v_ctx.lobby_id),
          last_line = 'There was a tie in the evidence vote. Discuss and re-vote.'
      where lobby_id = v_ctx.lobby_id;
    end if;
  end if;

  return public.mc2_get_state(p_game_code, p_player_token);
end;
$$;

create or replace function public.mc2_play_again(
  p_game_code text,
  p_player_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
begin
  select * into v_ctx from public.mc2_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  if v_ctx.is_host is false then
    raise exception 'Only host can play again.';
  end if;

  update public.murder_club_v2_games
  set phase = 'rules',
      waiting_on = public.cc_active_player_ids(v_ctx.lobby_id),
      round_number = 1,
      investigator_score = 0,
      conspirator_score = 0,
      evidence_index = 0,
      suspect_player_id = null,
      suspect_vote_result = null,
      evidence_vote_result = null,
      suspect_votes = '{}'::jsonb,
      evidence_cards = '{}'::jsonb,
      evidence_votes = '{}'::jsonb,
      conspirator_ids = public.mc2_assign_conspirators(v_ctx.lobby_id),
      last_line = null,
      last_error = null
  where lobby_id = v_ctx.lobby_id;

  return public.mc2_get_state(p_game_code, p_player_token);
end;
$$;

grant execute on function public.mc2_player_context(text, text) to anon, authenticated;
grant execute on function public.mc2_conspirator_count_for_players(integer) to anon, authenticated;
grant execute on function public.mc2_assign_conspirators(uuid) to anon, authenticated;
grant execute on function public.mc2_remove_waiting(jsonb, uuid) to anon, authenticated;
grant execute on function public.mc2_deal_evidence_cards(uuid, uuid) to anon, authenticated;
grant execute on function public.mc2_get_state(text, text) to anon, authenticated;
grant execute on function public.mc2_init_game(text, text) to anon, authenticated;
grant execute on function public.mc2_set_theme(text, text, text) to anon, authenticated;
grant execute on function public.mc2_continue(text, text) to anon, authenticated;
grant execute on function public.mc2_cast_suspect_vote(text, text, uuid) to anon, authenticated;
grant execute on function public.mc2_cast_evidence_vote(text, text, text) to anon, authenticated;
grant execute on function public.mc2_play_again(text, text) to anon, authenticated;
