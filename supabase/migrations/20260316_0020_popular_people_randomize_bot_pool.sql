-- Popular People: randomize the 2 extra names chosen from the bot pool.
-- Fixes repeated first-two names from deterministic array iteration.

create or replace function public.cc_submit_celebrities(
  p_game_code text,
  p_player_token text,
  p_celebrity_one text,
  p_celebrity_two text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_game public.celebrities_games%rowtype;
  v_name_one text;
  v_player_count integer;
  v_submitted_count integer;
  v_conflict_name text;
  v_bot_pool text[] := array[
    'Harry Potter', 'Peter Parker', 'Daffy Duck', 'Beyonce', 'Taylor Swift',
    'LeBron James', 'Elon Musk', 'Oprah Winfrey', 'Lionel Messi', 'Barbie',
    'Mickey Mouse', 'Batman', 'Shrek', 'SpongeBob', 'Darth Vader',
    'Hermione Granger', 'Spider-Man', 'Ariana Grande', 'Mr Bean', 'Wonder Woman'
  ];
begin
  perform public.cleanup_lobby_presence(p_game_code);

  select * into v_ctx from public.cc_player_context(p_game_code, p_player_token);
  if not found then
    raise exception 'Session expired.';
  end if;

  select * into v_game
  from public.celebrities_games
  where lobby_id = v_ctx.lobby_id;

  if not found or v_game.phase <> 'input' then
    raise exception 'Celebrity entry is not active.';
  end if;

  v_name_one := left(trim(p_celebrity_one), 20);

  if v_name_one = '' then
    raise exception 'Enter a celebrity.';
  end if;

  select e.celeb_name
  into v_conflict_name
  from public.celebrities_entries e
  where e.lobby_id = v_ctx.lobby_id
    and e.player_id <> v_ctx.player_id
    and public.cc_name_too_close(public.cc_name_norm(e.celeb_name), public.cc_name_norm(v_name_one))
  limit 1;

  if v_conflict_name is not null then
    raise exception 'Someone already used a similar celebrity: "%". Pick another.', v_conflict_name;
  end if;

  insert into public.celebrities_entries (lobby_id, player_id, slot, celeb_name, is_bot)
  values (v_ctx.lobby_id, v_ctx.player_id, 1, v_name_one, false)
  on conflict (lobby_id, player_id, slot) where is_bot = false
  do update set celeb_name = excluded.celeb_name, updated_at = now();

  delete from public.celebrities_entries
  where lobby_id = v_ctx.lobby_id
    and player_id = v_ctx.player_id
    and is_bot = false
    and slot = 2;

  select count(*) into v_player_count
  from public.lobby_players p
  where p.lobby_id = v_ctx.lobby_id;

  with per_player as (
    select e.player_id, count(*) as c
    from public.celebrities_entries e
    where e.lobby_id = v_ctx.lobby_id
      and e.is_bot = false
    group by e.player_id
  )
  select count(*) into v_submitted_count
  from per_player
  where c >= 1;

  if v_submitted_count = v_player_count then
    update public.celebrities_player_state ps
    set celebrity_name = e.celeb_name
    from public.celebrities_entries e
    where ps.lobby_id = v_ctx.lobby_id
      and e.lobby_id = ps.lobby_id
      and e.player_id = ps.player_id
      and e.is_bot = false
      and e.slot = 1;

    delete from public.celebrities_entries e
    where e.lobby_id = v_ctx.lobby_id
      and e.is_bot = true;

    insert into public.celebrities_entries (lobby_id, player_id, slot, celeb_name, is_bot)
    select v_ctx.lobby_id, null, null, candidate.celeb_name, true
    from (
      select b.celeb_name
      from unnest(v_bot_pool) as b(celeb_name)
      where not exists (
        select 1
        from public.celebrities_entries e
        where e.lobby_id = v_ctx.lobby_id
          and public.cc_name_too_close(public.cc_name_norm(e.celeb_name), public.cc_name_norm(b.celeb_name))
      )
      order by random()
      limit 2
    ) as candidate;

    update public.celebrities_games
    set phase = 'reveal',
        reveal_round = 1,
        reveal_ends_at = now() + interval '30 seconds',
        waiting_on = public.cc_active_player_ids(v_ctx.lobby_id),
        last_error = null
    where lobby_id = v_ctx.lobby_id;
  end if;

  return public.cc_get_state(p_game_code, p_player_token);
end;
$$;

grant execute on function public.cc_submit_celebrities(text, text, text, text) to anon, authenticated;
