-- Access hardening: DB-level per-browser-token rate limits and guarded RPC wrappers.

create table if not exists public.access_rate_limits (
  browser_token uuid not null,
  action_key text not null,
  window_started_at timestamptz not null,
  hit_count integer not null default 0,
  blocked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (browser_token, action_key)
);

drop trigger if exists trg_access_rate_limits_updated_at on public.access_rate_limits;
create trigger trg_access_rate_limits_updated_at
before update on public.access_rate_limits
for each row
execute function public.set_updated_at();

create index if not exists idx_access_rate_limits_blocked_until on public.access_rate_limits(blocked_until);
create index if not exists idx_access_rate_limits_updated_at on public.access_rate_limits(updated_at);

alter table public.access_rate_limits enable row level security;

drop policy if exists access_rate_limits_no_direct on public.access_rate_limits;
create policy access_rate_limits_no_direct on public.access_rate_limits
for all
using (false)
with check (false);

create or replace function public.check_access_rate_limit(
  p_browser_token uuid,
  p_action_key text,
  p_limit integer,
  p_window_seconds integer,
  p_block_seconds integer default 120
)
returns table(
  allowed boolean,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.access_rate_limits;
  v_now timestamptz := now();
  v_retry integer := 0;
begin
  if p_limit < 1 or p_window_seconds < 1 then
    return query select false, 60;
    return;
  end if;

  insert into public.access_rate_limits(
    browser_token,
    action_key,
    window_started_at,
    hit_count,
    blocked_until
  )
  values (
    p_browser_token,
    p_action_key,
    v_now,
    0,
    null
  )
  on conflict (browser_token, action_key) do nothing;

  select *
    into v_row
  from public.access_rate_limits
  where browser_token = p_browser_token
    and action_key = p_action_key
  for update;

  if v_row.blocked_until is not null and v_row.blocked_until > v_now then
    v_retry := greatest(1, ceil(extract(epoch from (v_row.blocked_until - v_now)))::integer);
    return query select false, v_retry;
    return;
  end if;

  if v_row.window_started_at + make_interval(secs => p_window_seconds) <= v_now then
    update public.access_rate_limits
      set
        window_started_at = v_now,
        hit_count = 1,
        blocked_until = null
    where browser_token = p_browser_token
      and action_key = p_action_key;

    return query select true, 0;
    return;
  end if;

  if v_row.hit_count + 1 > p_limit then
    update public.access_rate_limits
      set
        hit_count = v_row.hit_count + 1,
        blocked_until = v_now + make_interval(secs => greatest(30, p_block_seconds))
    where browser_token = p_browser_token
      and action_key = p_action_key;

    v_retry := greatest(30, p_block_seconds);
    return query select false, v_retry;
    return;
  end if;

  update public.access_rate_limits
    set hit_count = v_row.hit_count + 1
  where browser_token = p_browser_token
    and action_key = p_action_key;

  return query select true, 0;
end;
$$;

create or replace function public.get_access_state_guarded(
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
  v_guard record;
begin
  select *
    into v_guard
  from public.check_access_rate_limit(
    p_browser_token,
    'get_access_state',
    60,
    60,
    60
  );

  if coalesce(v_guard.allowed, false) is false then
    raise exception 'Rate limited. Try again in % seconds.', coalesce(v_guard.retry_after_seconds, 60);
  end if;

  return query
  select *
  from public.get_access_state(p_browser_token);
end;
$$;

create or replace function public.consume_session_guarded(
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
  v_guard record;
begin
  select *
    into v_guard
  from public.check_access_rate_limit(
    p_browser_token,
    'consume_session',
    20,
    60,
    120
  );

  if coalesce(v_guard.allowed, false) is false then
    raise exception 'Rate limited. Try again in % seconds.', coalesce(v_guard.retry_after_seconds, 120);
  end if;

  return query
  select *
  from public.consume_session(p_browser_token, p_game_code);
end;
$$;

create or replace function public.claim_share_bonus_guarded(
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
  v_guard record;
begin
  select *
    into v_guard
  from public.check_access_rate_limit(
    p_browser_token,
    'claim_share_bonus',
    8,
    60,
    120
  );

  if coalesce(v_guard.allowed, false) is false then
    raise exception 'Rate limited. Try again in % seconds.', coalesce(v_guard.retry_after_seconds, 120);
  end if;

  return query
  select *
  from public.claim_share_bonus(p_browser_token);
end;
$$;

create or replace function public.cleanup_access_security_data()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer := 0;
begin
  delete from public.access_rate_limits
  where updated_at < now() - interval '7 days';

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

grant execute on function public.check_access_rate_limit(uuid, text, integer, integer, integer) to anon, authenticated, service_role;
grant execute on function public.get_access_state_guarded(uuid) to anon, authenticated;
grant execute on function public.consume_session_guarded(uuid, text) to anon, authenticated;
grant execute on function public.claim_share_bonus_guarded(uuid) to anon, authenticated;
grant execute on function public.cleanup_access_security_data() to service_role;
