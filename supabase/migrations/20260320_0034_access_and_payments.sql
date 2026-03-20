-- Access + payment foundation (browser-token based, no accounts, no IP logic).

create table if not exists public.access_state (
  browser_token uuid primary key,
  window_started_at timestamptz,
  free_sessions_used integer not null default 0 check (free_sessions_used between 0 and 2),
  share_bonus_claimed boolean not null default false,
  paid_unlock_expires_at timestamptz,
  courtesy_unlock_last_granted_at timestamptz,
  last_payment_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_access_state_updated_at on public.access_state;
create trigger trg_access_state_updated_at
before update on public.access_state
for each row
execute function public.set_updated_at();

create table if not exists public.access_payments (
  id uuid primary key default gen_random_uuid(),
  browser_token uuid not null references public.access_state(browser_token) on delete cascade,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  status text not null check (status in ('pending', 'paid', 'failed', 'expired')),
  amount_cents integer not null default 100,
  currency text not null default 'aud',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_access_payments_updated_at on public.access_payments;
create trigger trg_access_payments_updated_at
before update on public.access_payments
for each row
execute function public.set_updated_at();

create table if not exists public.access_session_consumptions (
  id uuid primary key default gen_random_uuid(),
  browser_token uuid not null references public.access_state(browser_token) on delete cascade,
  game_code text not null,
  consumed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (browser_token, game_code)
);

create index if not exists idx_access_session_consumptions_browser on public.access_session_consumptions(browser_token);

alter table public.access_state enable row level security;
alter table public.access_payments enable row level security;
alter table public.access_session_consumptions enable row level security;

drop policy if exists access_state_no_direct on public.access_state;
create policy access_state_no_direct on public.access_state
for all
using (false)
with check (false);

drop policy if exists access_payments_no_direct on public.access_payments;
create policy access_payments_no_direct on public.access_payments
for all
using (false)
with check (false);

drop policy if exists access_session_consumptions_no_direct on public.access_session_consumptions;
create policy access_session_consumptions_no_direct on public.access_session_consumptions
for all
using (false)
with check (false);

create or replace function public.ensure_access_record(
  p_browser_token uuid
)
returns public.access_state
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.access_state;
begin
  insert into public.access_state(browser_token)
  values (p_browser_token)
  on conflict (browser_token) do nothing;

  select *
    into v_row
  from public.access_state
  where browser_token = p_browser_token;

  return v_row;
end;
$$;

create or replace function public.normalize_access_window(
  p_browser_token uuid
)
returns public.access_state
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.access_state;
begin
  v_row := public.ensure_access_record(p_browser_token);

  if v_row.window_started_at is not null and v_row.window_started_at + interval '4 hours' <= now() then
    update public.access_state
      set
        window_started_at = null,
        free_sessions_used = 0,
        share_bonus_claimed = false
    where browser_token = p_browser_token;

    select *
      into v_row
    from public.access_state
    where browser_token = p_browser_token;
  end if;

  return v_row;
end;
$$;

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
    v_free_left := 2;
  else
    if v_row.window_started_at is null then
      v_free_left := 1;
    else
      v_free_left := greatest(0, 1 - v_row.free_sessions_used);
      if v_row.share_bonus_claimed and v_row.free_sessions_used < 2 then
        v_free_left := v_free_left + 1;
      end if;
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
  v_consumed_exists boolean;
begin
  v_row := public.normalize_access_window(p_browser_token);
  v_window_resets_at := coalesce(v_row.window_started_at, now()) + interval '4 hours';

  select exists (
    select 1
    from public.access_session_consumptions ascx
    where ascx.browser_token = p_browser_token
      and ascx.game_code = p_game_code
  ) into v_consumed_exists;

  if v_consumed_exists then
    return query
    select
      true,
      'already_consumed'::text,
      (v_row.paid_unlock_expires_at is not null and v_row.paid_unlock_expires_at > now()),
      v_row.paid_unlock_expires_at,
      greatest(0, 2 - v_row.free_sessions_used),
      (not v_row.share_bonus_claimed and coalesce(v_row.paid_unlock_expires_at, '-infinity'::timestamptz) <= now()),
      v_window_resets_at;
    return;
  end if;

  if v_row.paid_unlock_expires_at is not null and v_row.paid_unlock_expires_at > now() then
    insert into public.access_session_consumptions(browser_token, game_code)
    values (p_browser_token, p_game_code)
    on conflict (browser_token, game_code) do nothing;

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
    values (p_browser_token, p_game_code)
    on conflict (browser_token, game_code) do nothing;

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
    values (p_browser_token, p_game_code)
    on conflict (browser_token, game_code) do nothing;

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
    values (p_browser_token, p_game_code)
    on conflict (browser_token, game_code) do nothing;

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
begin
  v_row := public.normalize_access_window(p_browser_token);

  if v_row.paid_unlock_expires_at is not null and v_row.paid_unlock_expires_at > now() then
    return query
    select
      false,
      'paid_unlock_active'::text,
      false,
      2,
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

  if v_row.share_bonus_claimed then
    return query
    select
      false,
      'already_claimed'::text,
      false,
      greatest(0, 2 - v_row.free_sessions_used),
      v_row.window_started_at + interval '4 hours';
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
    true,
    greatest(0, 2 - v_row.free_sessions_used),
    v_row.window_started_at + interval '4 hours';
end;
$$;

create or replace function public.access_apply_payment_unlock(
  p_browser_token uuid,
  p_payment_reference text,
  p_unlock_hours integer default 4
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.ensure_access_record(p_browser_token);

  update public.access_state
    set
      paid_unlock_expires_at = greatest(coalesce(paid_unlock_expires_at, now()), now()) + make_interval(hours => greatest(1, p_unlock_hours)),
      last_payment_reference = p_payment_reference
  where browser_token = p_browser_token;

  return true;
end;
$$;

create or replace function public.maybe_grant_courtesy_unlock(
  p_browser_token uuid,
  p_reason text
)
returns table(
  granted boolean,
  reason text,
  paid_unlock_expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.access_state;
  v_reason text := lower(coalesce(p_reason, ''));
begin
  v_row := public.ensure_access_record(p_browser_token);

  if v_reason not in ('i_paid_but_didnt_unlock', 'payment_failed', 'i_was_charged_twice', 'checkout_closed') then
    return query
    select false, 'reason_not_eligible'::text, v_row.paid_unlock_expires_at;
    return;
  end if;

  if v_row.courtesy_unlock_last_granted_at is not null and v_row.courtesy_unlock_last_granted_at + interval '14 days' > now() then
    return query
    select false, 'courtesy_recently_used'::text, v_row.paid_unlock_expires_at;
    return;
  end if;

  update public.access_state
    set
      paid_unlock_expires_at = greatest(coalesce(paid_unlock_expires_at, now()), now()) + interval '4 hours',
      courtesy_unlock_last_granted_at = now()
  where browser_token = p_browser_token;

  select *
    into v_row
  from public.access_state
  where browser_token = p_browser_token;

  return query
  select true, 'courtesy_granted'::text, v_row.paid_unlock_expires_at;
end;
$$;

grant execute on function public.get_access_state(uuid) to anon, authenticated;
grant execute on function public.consume_session(uuid, text) to anon, authenticated;
grant execute on function public.claim_share_bonus(uuid) to anon, authenticated;
grant execute on function public.maybe_grant_courtesy_unlock(uuid, text) to anon, authenticated;

revoke all on function public.access_apply_payment_unlock(uuid, text, integer) from public;
grant execute on function public.access_apply_payment_unlock(uuid, text, integer) to service_role;
