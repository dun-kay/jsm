-- Access model update:
-- - 1 base free session per 4-hour window
-- - +2 additional sessions via share bonus (once per 4-hour window, non-stackable)

alter table if exists public.access_state
  drop constraint if exists access_state_free_sessions_used_check;

alter table if exists public.access_state
  add constraint access_state_free_sessions_used_check
  check (free_sessions_used between 0 and 3);

create or replace function public.get_access_state(
  p_browser_token uuid
)
returns table(
  browser_token uuid,
  paid_unlock_active boolean,
  paid_unlock_expires_at timestamptz,
  free_sessions_left integer,
  share_bonus_available boolean,
  window_resets_at timestamptz,
  window_seconds_left integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.access_state;
  v_window_started timestamptz;
  v_window_resets_at timestamptz;
  v_seconds_left integer;
  v_free_left integer;
begin
  v_row := public.normalize_access_window(p_browser_token);
  v_window_started := coalesce(v_row.window_started_at, now());
  v_window_resets_at := v_window_started + interval '4 hours';
  v_seconds_left := greatest(0, floor(extract(epoch from (v_window_resets_at - now())))::integer);

  if v_row.paid_unlock_expires_at is not null and v_row.paid_unlock_expires_at > now() then
    v_free_left := 3;
  else
    if v_row.window_started_at is null then
      v_free_left := 1;
    elsif v_row.share_bonus_claimed then
      v_free_left := greatest(0, 3 - v_row.free_sessions_used);
    else
      v_free_left := greatest(0, 1 - v_row.free_sessions_used);
    end if;
  end if;

  return query
  select
    v_row.browser_token,
    (v_row.paid_unlock_expires_at is not null and v_row.paid_unlock_expires_at > now()) as paid_unlock_active,
    v_row.paid_unlock_expires_at,
    v_free_left,
    (
      coalesce(v_row.paid_unlock_expires_at, '-infinity'::timestamptz) <= now()
      and (v_row.window_started_at is null or v_row.window_started_at + interval '4 hours' > now())
      and not v_row.share_bonus_claimed
    ) as share_bonus_available,
    v_window_resets_at,
    v_seconds_left;
end;
$$;

create or replace function public.consume_session(
  p_browser_token uuid,
  p_game_code text
)
returns table(
  allowed boolean,
  reason text,
  paid_unlock_active boolean,
  paid_unlock_expires_at timestamptz,
  free_sessions_left integer,
  share_bonus_available boolean,
  window_resets_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.access_state;
  v_window_resets_at timestamptz;
begin
  v_row := public.normalize_access_window(p_browser_token);

  if v_row.window_started_at is null then
    update public.access_state
    set window_started_at = now()
    where browser_token = p_browser_token;

    select *
      into v_row
    from public.access_state
    where browser_token = p_browser_token;
  end if;

  v_window_resets_at := v_row.window_started_at + interval '4 hours';

  if v_row.paid_unlock_expires_at is not null and v_row.paid_unlock_expires_at > now() then
    insert into public.access_session_consumptions(browser_token, game_code)
    values (p_browser_token, p_game_code);

    return query
    select
      true,
      'paid_unlock_active'::text,
      true,
      v_row.paid_unlock_expires_at,
      3,
      false,
      v_window_resets_at;
    return;
  end if;

  if v_row.free_sessions_used < 1 then
    update public.access_state
      set free_sessions_used = 1
    where browser_token = p_browser_token;

    insert into public.access_session_consumptions(browser_token, game_code)
    values (p_browser_token, p_game_code);

    select *
      into v_row
    from public.access_state
    where browser_token = p_browser_token;

    return query
    select
      true,
      'free_session_consumed'::text,
      false,
      null::timestamptz,
      case when v_row.share_bonus_claimed then greatest(0, 3 - v_row.free_sessions_used) else 0 end,
      not v_row.share_bonus_claimed,
      v_window_resets_at;
    return;
  end if;

  if v_row.share_bonus_claimed and v_row.free_sessions_used < 3 then
    update public.access_state
      set free_sessions_used = least(3, free_sessions_used + 1)
    where browser_token = p_browser_token;

    insert into public.access_session_consumptions(browser_token, game_code)
    values (p_browser_token, p_game_code);

    select *
      into v_row
    from public.access_state
    where browser_token = p_browser_token;

    return query
    select
      true,
      'share_bonus_consumed'::text,
      false,
      null::timestamptz,
      greatest(0, 3 - v_row.free_sessions_used),
      false,
      v_window_resets_at;
    return;
  end if;

  return query
  select
    false,
    'limit_reached'::text,
    false,
    null::timestamptz,
    0,
    not v_row.share_bonus_claimed,
    v_window_resets_at;
end;
$$;

create or replace function public.claim_share_bonus(
  p_browser_token uuid
)
returns table(
  granted boolean,
  reason text,
  share_bonus_available boolean,
  free_sessions_left integer,
  window_resets_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.access_state;
  v_window_resets_at timestamptz;
begin
  v_row := public.normalize_access_window(p_browser_token);

  if v_row.paid_unlock_expires_at is not null and v_row.paid_unlock_expires_at > now() then
    return query
    select
      false,
      'paid_unlock_active'::text,
      false,
      3,
      coalesce(v_row.window_started_at, now()) + interval '4 hours';
    return;
  end if;

  if v_row.window_started_at is null then
    update public.access_state
      set window_started_at = now()
    where browser_token = p_browser_token;

    select *
      into v_row
    from public.access_state
    where browser_token = p_browser_token;
  end if;

  v_window_resets_at := v_row.window_started_at + interval '4 hours';

  if v_row.share_bonus_claimed then
    return query
    select
      false,
      'already_claimed'::text,
      false,
      greatest(0, 3 - v_row.free_sessions_used),
      v_window_resets_at;
    return;
  end if;

  update public.access_state
    set share_bonus_claimed = true
  where browser_token = p_browser_token;

  select *
    into v_row
  from public.access_state
  where browser_token = p_browser_token;

  return query
  select
    true,
    'claimed'::text,
    false,
    greatest(0, 3 - v_row.free_sessions_used),
    v_window_resets_at;
end;
$$;
