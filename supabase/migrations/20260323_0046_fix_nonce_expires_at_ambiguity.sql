-- Fix ambiguous column reference in nonce cleanup query.

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

  delete from public.access_request_nonces arn
  where arn.browser_token = p_browser_token
    and (arn.consumed_at is not null or arn.expires_at <= now() - interval '5 minutes');

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

