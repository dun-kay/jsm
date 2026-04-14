-- Wormy Worm: reduce DB write pressure from polling by using read-only player context in ww_get_state.

create or replace function public.ww_player_context_readonly(p_game_code text, p_player_token text)
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
declare
  v_lobby public.game_lobbies%rowtype;
  v_player public.lobby_players%rowtype;
begin
  select *
  into v_lobby
  from public.game_lobbies
  where game_code = upper(trim(p_game_code));

  if not found then
    return;
  end if;

  select p.*
  into v_player
  from public.lobby_players p
  where p.lobby_id = v_lobby.id
    and p.player_token = p_player_token;

  if not found then
    return;
  end if;

  if v_player.last_seen_at < now() - interval '20 minutes' then
    return;
  end if;

  return query
  select
    v_lobby.id,
    v_lobby.game_slug,
    v_lobby.status,
    v_player.id,
    v_player.display_name,
    v_player.is_host;
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

  select *
  into v_ctx
  from public.ww_player_context_readonly(p_game_code, p_player_token);

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
    'pullInProgress', coalesce(v_game.pull_in_progress, false),
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

grant execute on function public.ww_player_context_readonly(text, text) to anon, authenticated;