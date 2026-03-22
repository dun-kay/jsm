-- Access fix:
-- Allow new session consumption on replay within the same game code.
-- Previous unique(browser_token, game_code) prevented replay session charging.

alter table if exists public.access_session_consumptions
  drop constraint if exists access_session_consumptions_browser_token_game_code_key;

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
  v_window_resets_at := coalesce(v_row.window_started_at, now()) + interval '4 hours';

  if v_row.paid_unlock_expires_at is not null and v_row.paid_unlock_expires_at > now() then
    insert into public.access_session_consumptions(browser_token, game_code)
    values (p_browser_token, p_game_code);

    return query
    select
      true,
      'paid_unlock_active'::text,
      true,
      v_row.paid_unlock_expires_at,
      2,
      false,
      v_window_resets_at;
    return;
  end if;

  if v_row.window_started_at is null then
    update public.access_state
      set
        window_started_at = now(),
        free_sessions_used = 1
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
      0 + case when v_row.share_bonus_claimed then 1 else 0 end,
      not v_row.share_bonus_claimed,
      v_row.window_started_at + interval '4 hours';
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
      0 + case when v_row.share_bonus_claimed then 1 else 0 end,
      not v_row.share_bonus_claimed,
      v_row.window_started_at + interval '4 hours';
    return;
  end if;

  if v_row.share_bonus_claimed and v_row.free_sessions_used < 2 then
    update public.access_state
      set free_sessions_used = 2
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
      0,
      false,
      v_row.window_started_at + interval '4 hours';
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
    v_row.window_started_at + interval '4 hours';
end;
$$;
