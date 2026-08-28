create table public.user_series_notifications (
  user_id uuid not null references auth.users(id) on delete cascade,
  series_id uuid not null references public.series(id) on delete cascade,
  notify_new_releases boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, series_id)
);

alter table public.user_series_notifications enable row level security;

revoke all on public.user_series_notifications from anon, authenticated;

create policy "Users can read their own series notifications"
  on public.user_series_notifications for select
  to authenticated
  using (user_id = auth.uid());

create policy "Users can create their own series notifications"
  on public.user_series_notifications for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "Users can update their own series notifications"
  on public.user_series_notifications for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on public.user_series_notifications to service_role;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger user_series_notifications_updated_at
  before update on public.user_series_notifications
  for each row execute function public.touch_updated_at();

create or replace function public.set_reader_preferences(
  marketing_consent_value boolean default null,
  series_slug_value text default null,
  notify_new_releases_value boolean default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_series_id uuid;
begin
  if marketing_consent_value is not null then
    update public.profiles
    set marketing_consent = marketing_consent_value
    where id = auth.uid();
  end if;

  if series_slug_value is not null and notify_new_releases_value is not null then
    select id into selected_series_id
    from public.series
    where slug = series_slug_value
      and status = 'active';

    if selected_series_id is null then
      raise exception 'Unknown series slug %', series_slug_value;
    end if;

    insert into public.user_series_notifications (user_id, series_id, notify_new_releases)
    values (auth.uid(), selected_series_id, notify_new_releases_value)
    on conflict (user_id, series_id) do update
    set notify_new_releases = excluded.notify_new_releases;
  end if;
end;
$$;

revoke execute on function public.set_reader_preferences(boolean, text, boolean) from public, anon;
grant execute on function public.set_reader_preferences(boolean, text, boolean) to authenticated;
