-- Existing environments may already have the original eight-question constraints.
alter table public.quiz_sessions
  drop constraint if exists quiz_sessions_current_question_check,
  drop constraint if exists quiz_sessions_score_check;

alter table public.quiz_sessions
  add constraint quiz_sessions_current_question_check check (current_question between 0 and 9),
  add constraint quiz_sessions_score_check check (score between -2 and 18);
