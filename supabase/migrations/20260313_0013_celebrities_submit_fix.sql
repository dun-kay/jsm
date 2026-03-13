-- Hotfix: fix cc_submit_celebrities invalid FROM-clause reference.

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
  v_name_two text;
  v_player_count integer;
  v_submitted_count integer;
  v_bot text;
  v_added integer := 0;
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
  v_name_two := left(trim(p_celebrity_two), 20);

  if v_name_one = '' or v_name_two = '' then
    raise exception 'Enter two celebrities.';
  end if;

  if public.cc_name_too_close(public.cc_name_norm(v_name_one), public.cc_name_norm(v_name_two)) then
    raise exception 'Use two different celebrities.';
  end if;

  insert into public.celebrities_entries (lobby_id, player_id, slot, celeb_name, is_bot)
  values (v_ctx.lobby_id, v_ctx.player_id, 1, v_name_one, false)
  on conflict (lobby_id, player_id, slot) where is_bot = false
  do update set celeb_name = excluded.celeb_name, updated_at = now();

  insert into public.celebrities_entries (lobby_id, player_id, slot, celeb_name, is_bot)
  values (v_ctx.lobby_id, v_ctx.player_id, 2, v_name_two, false)
  on conflict (lobby_id, player_id, slot) where is_bot = false
  do update set celeb_name = excluded.celeb_name, updated_at = now();

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
  where c >= 2;

  if v_submitted_count = v_player_count then
    update public.celebrities_player_state ps
    set celebrity_name = pick.celeb_name
    from (
      select picked.player_id, picked.celeb_name
      from (
        select
          e.player_id,
          e.celeb_name,
          row_number() over (partition by e.player_id order by random()) as rn
        from public.celebrities_entries e
        where e.lobby_id = v_ctx.lobby_id
          and e.is_bot = false
      ) picked
      where picked.rn = 1
    ) pick
    where ps.lobby_id = v_ctx.lobby_id
      and ps.player_id = pick.player_id;

    delete from public.celebrities_entries e
    where e.lobby_id = v_ctx.lobby_id
      and e.is_bot = true;

    foreach v_bot in array v_bot_pool loop
      exit when v_added >= 2;
      if not exists (
        select 1
        from public.celebrities_entries e
        where e.lobby_id = v_ctx.lobby_id
          and public.cc_name_too_close(public.cc_name_norm(e.celeb_name), public.cc_name_norm(v_bot))
      ) then
        insert into public.celebrities_entries (lobby_id, player_id, slot, celeb_name, is_bot)
        values (v_ctx.lobby_id, null, null, v_bot, true);
        v_added := v_added + 1;
      end if;
    end loop;

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
