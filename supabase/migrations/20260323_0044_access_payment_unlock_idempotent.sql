-- Prevent double-extension when the same checkout is confirmed by multiple paths
-- (e.g. webhook + confirm-checkout fallback).

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
declare
  v_row public.access_state;
begin
  perform public.ensure_access_record(p_browser_token);

  select *
    into v_row
  from public.access_state
  where browser_token = p_browser_token
  for update;

  if coalesce(v_row.last_payment_reference, '') = coalesce(p_payment_reference, '') then
    return true;
  end if;

  update public.access_state
    set
      paid_unlock_expires_at = greatest(coalesce(paid_unlock_expires_at, now()), now()) + make_interval(hours => greatest(1, p_unlock_hours)),
      last_payment_reference = p_payment_reference
  where browser_token = p_browser_token;

  return true;
end;
$$;

revoke all on function public.access_apply_payment_unlock(uuid, text, integer) from public;
grant execute on function public.access_apply_payment_unlock(uuid, text, integer) to service_role;

