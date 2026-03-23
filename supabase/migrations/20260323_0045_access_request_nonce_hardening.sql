-- One-time nonce hardening for sensitive access/payment edge-function calls.

create table if not exists public.access_request_nonces (
  id uuid primary key default gen_random_uuid(),
  browser_token uuid not null references public.access_state(browser_token) on delete cascade,
  purpose text not null check (purpose in ('start_checkout', 'confirm_checkout')),
  nonce_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_access_request_nonces_purpose_hash
  on public.access_request_nonces(purpose, nonce_hash);
create index if not exists idx_access_request_nonces_browser
  on public.access_request_nonces(browser_token);
create index if not exists idx_access_request_nonces_expires
  on public.access_request_nonces(expires_at);

alter table public.access_request_nonces enable row level security;

drop policy if exists access_request_nonces_no_direct on public.access_request_nonces;
create policy access_request_nonces_no_direct on public.access_request_nonces
for all
using (false)
with check (false);

create or replace function public.create_access_request_nonce_guarded(
  p_browser_token uuid,
  p_purpose text
)
returns table(
  nonce text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guard record;
  v_nonce text;
  v_expires timestamptz;
begin
  if p_purpose not in ('start_checkout', 'confirm_checkout') then
    raise exception 'Invalid nonce purpose.';
  end if;

  select *
    into v_guard
  from public.check_access_rate_limit(
    p_browser_token,
    ('issue_nonce_' || p_purpose)::text,
    40,
    60,
    120
  );

  if coalesce(v_guard.allowed, false) is false then
    raise exception 'Rate limited. Try again in % seconds.', coalesce(v_guard.retry_after_seconds, 120);
  end if;

  perform public.ensure_access_record(p_browser_token);

  delete from public.access_request_nonces
  where browser_token = p_browser_token
    and (consumed_at is not null or expires_at <= now() - interval '5 minutes');

  v_nonce := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_expires := now() + interval '2 minutes';

  insert into public.access_request_nonces(browser_token, purpose, nonce_hash, expires_at)
  values (
    p_browser_token,
    p_purpose,
    encode(digest(v_nonce, 'sha256'), 'hex'),
    v_expires
  );

  return query
  select v_nonce, v_expires;
end;
$$;

create or replace function public.consume_access_request_nonce(
  p_browser_token uuid,
  p_purpose text,
  p_nonce text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
  v_id uuid;
begin
  if p_purpose not in ('start_checkout', 'confirm_checkout') then
    return false;
  end if;
  if p_nonce is null or length(trim(p_nonce)) < 16 then
    return false;
  end if;

  v_hash := encode(digest(trim(p_nonce), 'sha256'), 'hex');

  update public.access_request_nonces
  set consumed_at = now()
  where browser_token = p_browser_token
    and purpose = p_purpose
    and nonce_hash = v_hash
    and consumed_at is null
    and expires_at > now()
  returning id into v_id;

  return v_id is not null;
end;
$$;

grant execute on function public.create_access_request_nonce_guarded(uuid, text) to anon, authenticated;
revoke all on function public.consume_access_request_nonce(uuid, text, text) from public;
grant execute on function public.consume_access_request_nonce(uuid, text, text) to service_role;

