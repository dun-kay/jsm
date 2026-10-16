-- Minimal, anonymous quiz state. The UUID is the capability token; payment writes are server-only.
create table if not exists public.quiz_sessions (
  id uuid primary key,
  boyfriend_name text not null check (char_length(boyfriend_name) between 1 and 40),
  current_question smallint not null default 0 check (current_question between 0 and 9),
  score smallint not null default 0 check (score between -2 and 18),
  state text not null default 'quiz' check (state in ('quiz','complete','declined','accepted-failure')),
  paid boolean not null default false,
  stripe_checkout_session_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.quiz_sessions enable row level security;
create policy "anonymous quiz sessions may be created" on public.quiz_sessions for insert to anon with check (paid = false);
-- No table select/update policy: UUID RPCs below prevent REST list enumeration.

-- Avoid accepting forged paid or backwards state values through the generic REST update policy.
create or replace function public.quiz_update_progress(p_id uuid, p_question smallint, p_score smallint, p_state text)
returns public.quiz_sessions language plpgsql security definer set search_path = public as $$
declare row_out public.quiz_sessions;
begin
  update public.quiz_sessions set current_question=p_question, score=p_score, state=p_state, updated_at=now()
  where id=p_id and paid=false returning * into row_out;
  return row_out;
end $$;
revoke all on function public.quiz_update_progress(uuid,smallint,smallint,text) from public;
grant execute on function public.quiz_update_progress(uuid,smallint,smallint,text) to anon;

create or replace function public.quiz_get_session(p_id uuid)
returns public.quiz_sessions language sql security definer set search_path = public as $$
  select * from public.quiz_sessions where id = p_id limit 1;
$$;
revoke all on function public.quiz_get_session(uuid) from public;
grant execute on function public.quiz_get_session(uuid) to anon;
