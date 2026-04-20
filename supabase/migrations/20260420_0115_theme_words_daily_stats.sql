-- Theme Words daily completion stats.

create table if not exists public.theme_words_daily_puzzles (
  puzzle_date date primary key,
  letters text not null,
  words jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint theme_words_daily_puzzles_letters_chk
    check (letters ~ '^[A-Z]{5,6}$'),
  constraint theme_words_daily_puzzles_words_array_chk
    check (jsonb_typeof(words) = 'array' and jsonb_array_length(words) > 0)
);

drop trigger if exists set_theme_words_daily_puzzles_updated_at on public.theme_words_daily_puzzles;
create trigger set_theme_words_daily_puzzles_updated_at
before update on public.theme_words_daily_puzzles
for each row execute function public.set_updated_at();

create table if not exists public.theme_words_daily_completions (
  id bigserial primary key,
  puzzle_date date not null references public.theme_words_daily_puzzles(puzzle_date) on delete cascade,
  local_player_id text not null,
  elapsed_seconds integer not null,
  created_at timestamptz not null default now(),
  constraint theme_words_daily_completions_player_chk
    check (char_length(local_player_id) between 8 and 128),
  constraint theme_words_daily_completions_elapsed_chk
    check (elapsed_seconds > 0),
  constraint theme_words_daily_completions_unique_player_day
    unique (puzzle_date, local_player_id)
);

create index if not exists theme_words_daily_completions_puzzle_date_idx
  on public.theme_words_daily_completions(puzzle_date);

alter table public.theme_words_daily_puzzles enable row level security;
alter table public.theme_words_daily_completions enable row level security;

revoke all on table public.theme_words_daily_puzzles from anon, authenticated;
revoke all on table public.theme_words_daily_completions from anon, authenticated;

insert into public.theme_words_daily_puzzles (puzzle_date, letters, words)
values
  ('2026-04-20', 'AGIMRY', '["army","grim","gary","air","ram","rig","ray","rag","aim","mig"]'::jsonb)
on conflict (puzzle_date) do update
set
  letters = excluded.letters,
  words = excluded.words,
  updated_at = now();

create or replace function public.tw_record_completion(
  p_puzzle_date date,
  p_local_player_id text,
  p_elapsed_seconds integer
)
returns boolean
language plpgsql
security definer
volatile
set search_path = public
as $$
begin
  if p_puzzle_date is null then
    raise exception 'Missing puzzle date.';
  end if;

  if p_local_player_id is null or char_length(trim(p_local_player_id)) < 8 then
    raise exception 'Invalid player id.';
  end if;

  if p_elapsed_seconds is null or p_elapsed_seconds <= 0 then
    raise exception 'Elapsed seconds must be positive.';
  end if;

  if not exists (
    select 1
    from public.theme_words_daily_puzzles p
    where p.puzzle_date = p_puzzle_date
  ) then
    raise exception 'Puzzle not found for date %.', p_puzzle_date;
  end if;

  insert into public.theme_words_daily_completions (puzzle_date, local_player_id, elapsed_seconds)
  values (p_puzzle_date, trim(p_local_player_id), p_elapsed_seconds)
  on conflict (puzzle_date, local_player_id) do update
  set elapsed_seconds = least(public.theme_words_daily_completions.elapsed_seconds, excluded.elapsed_seconds);

  return true;
end;
$$;

create or replace function public.tw_get_average_time_seconds(p_puzzle_date date)
returns numeric(10,2)
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(round(avg(c.elapsed_seconds)::numeric, 2), 0::numeric)
  from public.theme_words_daily_completions c
  where c.puzzle_date = p_puzzle_date;
$$;

revoke all on function public.tw_record_completion(date, text, integer) from public;
revoke all on function public.tw_get_average_time_seconds(date) from public;

grant execute on function public.tw_record_completion(date, text, integer) to anon, authenticated;
grant execute on function public.tw_get_average_time_seconds(date) to anon, authenticated;
