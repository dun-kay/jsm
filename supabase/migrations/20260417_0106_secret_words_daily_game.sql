-- Secret Words daily puzzle storage + stats.

create table if not exists public.secret_words_daily_puzzles (
  puzzle_date date primary key,
  letters text not null,
  words jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint secret_words_daily_puzzles_letters_chk
    check (letters ~ '^[A-Z]{5,6}$'),
  constraint secret_words_daily_puzzles_words_array_chk
    check (jsonb_typeof(words) = 'array' and jsonb_array_length(words) > 0)
);

drop trigger if exists set_secret_words_daily_puzzles_updated_at on public.secret_words_daily_puzzles;
create trigger set_secret_words_daily_puzzles_updated_at
before update on public.secret_words_daily_puzzles
for each row execute function public.set_updated_at();

create table if not exists public.secret_words_daily_completions (
  id bigserial primary key,
  puzzle_date date not null references public.secret_words_daily_puzzles(puzzle_date) on delete cascade,
  local_player_id text not null,
  guess_count integer not null,
  created_at timestamptz not null default now(),
  constraint secret_words_daily_completions_player_chk
    check (char_length(local_player_id) between 8 and 128),
  constraint secret_words_daily_completions_guess_count_chk
    check (guess_count > 0),
  constraint secret_words_daily_completions_unique_player_day
    unique (puzzle_date, local_player_id)
);

create index if not exists secret_words_daily_completions_puzzle_date_idx
  on public.secret_words_daily_completions(puzzle_date);

alter table public.secret_words_daily_puzzles enable row level security;
alter table public.secret_words_daily_completions enable row level security;

revoke all on table public.secret_words_daily_puzzles from anon, authenticated;
revoke all on table public.secret_words_daily_completions from anon, authenticated;

insert into public.secret_words_daily_puzzles (puzzle_date, letters, words)
values
  ('2026-04-17', 'SILENT', '["listen","silent","inlets","tinsel","enlist","tiles","lines","list","line","lens","sent","site","ties","tine","nets","lets","ten","net","is","it","in"]'::jsonb),
  ('2026-04-16', 'CRANE', '["crane","caner","nacre","cane","care","race","acre","near","earn","can","car","ran","arc","are","ear","era","an","ar","re"]'::jsonb),
  ('2026-04-15', 'GARDEN', '["garden","danger","ranged","gander","grand","grade","range","anger","raged","dare","dear","gear","rage","near","read","rend","and","are","an","ad"]'::jsonb),
  ('2026-04-14', 'SPARE', '["spare","spear","pares","parse","reaps","pears","sear","pear","pare","rape","ears","eras","apes","spa","rap","are","as","re","pa"]'::jsonb),
  ('2026-04-13', 'PLANET', '["planet","platen","petal","panel","plate","pleat","leant","leap","lane","late","lean","tale","peat","neat","plan","ant","tan","at","an"]'::jsonb),
  ('2026-04-12', 'MUSIC', '["music","scum","mics","muse","sum","sic","mic","is","us","mu","mi","si"]'::jsonb),
  ('2026-04-11', 'STREAM', '["stream","master","tamers","maters","teams","stare","tears","rates","steam","meats","seam","same","seat","team","mate","rate","arm","as","at","am"]'::jsonb),
  ('2026-04-10', 'CLOUD', '["cloud","could","loud","clod","cold","cod","old","duo","col","do","od"]'::jsonb),
  ('2026-04-09', 'BRIGHT', '["bright","birth","right","girth","grit","high","big","bit","rib","rig","hit","it","hi"]'::jsonb),
  ('2026-04-08', 'STONE', '["stone","tones","onset","notes","ones","tone","note","nest","sent","tons","eons","one","son","to","so","on","no"]'::jsonb),
  ('2026-04-07', 'MELON', '["melon","lemon","lone","omen","mole","noel","elm","one","men","eon","on","no","me"]'::jsonb)
on conflict (puzzle_date) do update
set
  letters = excluded.letters,
  words = excluded.words,
  updated_at = now();

create or replace function public.sw_get_puzzles_window(
  p_from date default ((timezone('America/Los_Angeles', now()))::date - 30),
  p_to date default (timezone('America/Los_Angeles', now()))::date
)
returns table(
  puzzle_date date,
  letters text,
  words jsonb
)
language sql
security definer
stable
set search_path = public
as $$
  select p.puzzle_date, p.letters, p.words
  from public.secret_words_daily_puzzles p
  where p.puzzle_date between coalesce(p_from, p.puzzle_date) and coalesce(p_to, p.puzzle_date)
  order by p.puzzle_date desc;
$$;

create or replace function public.sw_record_completion(
  p_puzzle_date date,
  p_local_player_id text,
  p_guess_count integer
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

  if p_guess_count is null or p_guess_count <= 0 then
    raise exception 'Guess count must be positive.';
  end if;

  if not exists (
    select 1
    from public.secret_words_daily_puzzles p
    where p.puzzle_date = p_puzzle_date
  ) then
    raise exception 'Puzzle not found for date %.', p_puzzle_date;
  end if;

  insert into public.secret_words_daily_completions (puzzle_date, local_player_id, guess_count)
  values (p_puzzle_date, trim(p_local_player_id), p_guess_count)
  on conflict (puzzle_date, local_player_id) do update
  set guess_count = least(public.secret_words_daily_completions.guess_count, excluded.guess_count);

  return true;
end;
$$;

create or replace function public.sw_get_average_guesses(p_puzzle_date date)
returns numeric(10,2)
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(round(avg(c.guess_count)::numeric, 2), 0::numeric)
  from public.secret_words_daily_completions c
  where c.puzzle_date = p_puzzle_date;
$$;

revoke all on function public.sw_get_puzzles_window(date, date) from public;
revoke all on function public.sw_record_completion(date, text, integer) from public;
revoke all on function public.sw_get_average_guesses(date) from public;

grant execute on function public.sw_get_puzzles_window(date, date) to anon, authenticated;
grant execute on function public.sw_record_completion(date, text, integer) to anon, authenticated;
grant execute on function public.sw_get_average_guesses(date) to anon, authenticated;
