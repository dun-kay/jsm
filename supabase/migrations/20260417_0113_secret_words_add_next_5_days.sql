-- Queue next 5 Secret Words daily puzzles.

insert into public.secret_words_daily_puzzles (puzzle_date, letters, words)
values
  ('2026-04-22', 'POWERS', '["powers","power","swore","worse","sower","prose","poser","ropes","spore","pores","rows","rose","sore","rope","pore","pose","pros","owes","row","sow","owe","ore","roe","pro","per","we","ow","or","so","re"]'::jsonb),
  ('2026-04-21', 'SILVER', '["silver","sliver","livers","liver","lives","veils","riles","viler","rile","rise","sire","veil","vile","live","lire","isle","lies","lie","vie","ire","sir","is","re"]'::jsonb),
  ('2026-04-20', 'MARKET', '["market","remake","maker","taker","tamer","team","meat","mate","tear","rate","rake","make","mark","mare","take","kart","tram","term","arm","art","are","ear","eat","tea","tar","rat","am","at","me","re"]'::jsonb),
  ('2026-04-19', 'ORANGE', '["orange","onager","groan","organ","range","anger","goner","argon","gore","gone","rang","earn","near","rage","gear","one","ore","eon","era","are","ago","rag","ran","roe","an","go","no","on","or","re"]'::jsonb),
  ('2026-04-18', 'HEART', '["earth","heart","hater","rate","tear","tare","hear","heat","hate","hare","hart","her","hat","the","are","ear","eat","tea","tar","art","he","at","ah","ha","re"]'::jsonb)
on conflict (puzzle_date) do update
set
  letters = excluded.letters,
  words = excluded.words,
  updated_at = now();
