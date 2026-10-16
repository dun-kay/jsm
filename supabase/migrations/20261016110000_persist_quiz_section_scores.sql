alter table public.quiz_sessions
  add column if not exists section_scores jsonb not null default '{"literate":0,"numerate":0,"bf":0,"general":0}'::jsonb;

create or replace function public.quiz_update_progress(
  p_id uuid, p_question smallint, p_score smallint, p_state text, p_section_scores jsonb
) returns public.quiz_sessions language plpgsql security definer set search_path = public as $$
declare row_out public.quiz_sessions;
begin
  update public.quiz_sessions set current_question=p_question, score=p_score, state=p_state,
    section_scores=coalesce(p_section_scores,section_scores), updated_at=now()
  where id=p_id and paid=false returning * into row_out;
  return row_out;
end $$;
revoke all on function public.quiz_update_progress(uuid,smallint,smallint,text,jsonb) from public;
grant execute on function public.quiz_update_progress(uuid,smallint,smallint,text,jsonb) to anon;
