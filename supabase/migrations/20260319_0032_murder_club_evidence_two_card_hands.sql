-- Murder Club evidence update:
-- - two cards dealt per voter
-- - weighted deck: 65% reject, 35% admit
-- - vote can be either of the two dealt cards
-- - chosen votes are public in evidence_result

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
  v_card_one text;
  v_card_two text;
begin
  for v_row in
    select p.id
    from public.lobby_players p
    where p.lobby_id = p_lobby_id
      and (p_suspect_player_id is null or p.id <> p_suspect_player_id)
    order by random()
  loop
    -- 65% reject, 35% admit for each draw.
    v_card_one := case when random() < 0.65 then 'reject' else 'admit' end;
    v_card_two := case when random() < 0.65 then 'reject' else 'admit' end;
    v_cards := jsonb_set(
      v_cards,
      array[v_row.id::text],
      jsonb_build_array(v_card_one, v_card_two),
      true
    );
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
  v_evidence_public_votes jsonb;
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

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'playerId', p.id,
        'name', p.display_name,
        'cards', coalesce(v_game.evidence_cards -> p.id::text, '[]'::jsonb),
        'vote', case when v_game.evidence_votes ? p.id::text then v_game.evidence_votes ->> p.id::text else null end,
        'isUnderSuspicion', (v_game.suspect_player_id = p.id)
      )
      order by ps.turn_order
    ),
    '[]'::jsonb
  )
  into v_evidence_public_votes
  from public.lobby_players p
  join public.murder_club_v2_player_state ps
    on ps.lobby_id = p.lobby_id
   and ps.player_id = p.id
  where p.lobby_id = v_ctx.lobby_id;

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
    'evidencePublicVotes', v_evidence_public_votes,
    'waitingOn', coalesce(v_game.waiting_on, '[]'::jsonb),
    'lastLine', v_game.last_line,
    'lastError', v_game.last_error,
    'you', jsonb_build_object(
      'id', v_ctx.player_id,
      'name', v_ctx.player_name,
      'isHost', v_ctx.is_host,
      'role', v_role,
      'evidenceCards', coalesce(v_game.evidence_cards -> v_ctx.player_id::text, '[]'::jsonb),
      'isUnderSuspicion', v_game.suspect_player_id = v_ctx.player_id,
      'conspiratorIds', coalesce(v_game.conspirator_ids, '[]'::jsonb)
    )
  );
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
  v_total_eligible integer;
  v_vote_count integer;
  v_admit integer;
  v_reject integer;
  v_can_play boolean;
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

  select exists (
    select 1
    from jsonb_array_elements_text(coalesce(v_game.evidence_cards -> v_ctx.player_id::text, '[]'::jsonb)) c(value)
    where lower(c.value) = v_vote
  )
  into v_can_play;

  if not v_can_play then
    raise exception 'You can only cast one of your dealt cards.';
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

grant execute on function public.mc2_deal_evidence_cards(uuid, uuid) to anon, authenticated;
grant execute on function public.mc2_get_state(text, text) to anon, authenticated;
grant execute on function public.mc2_cast_evidence_vote(text, text, text) to anon, authenticated;
