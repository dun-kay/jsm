alter table public.quiz_sessions
  drop constraint if exists quiz_sessions_score_check;

alter table public.quiz_sessions
  add constraint quiz_sessions_score_check check (score between -2 and 18);
