-- RLS decides which anonymous writes are valid; these grants allow PostgREST
-- and the server-side Checkout/webhook functions to reach the table at all.
grant insert on table public.quiz_sessions to anon;
grant select, update on table public.quiz_sessions to service_role;
