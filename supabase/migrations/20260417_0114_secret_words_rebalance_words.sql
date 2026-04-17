-- Rebalance Secret Words daily puzzle rankings and fill missing short words.
-- Keeps letter pools the same, updates ordered word lists for existing queued days.

insert into public.secret_words_daily_puzzles (puzzle_date, letters, words)
values
  ('2026-04-22', 'POWERS', '["rose","sore","prose","poser","pores","spore","ropes","sower","worse","swore","power","powers","rope","pore","pose","rows","owes","woes","wore","pros","sow","row","ore","roe","owe","woe","pro","per","we","ow","or","so","re"]'::jsonb),
  ('2026-04-21', 'SILVER', '["live","lives","liver","sliver","silver","livers","vile","veil","viler","veils","rile","riles","rise","sire","isle","lies","lire","evil","vies","lie","vie","sir","ire","is","re"]'::jsonb),
  ('2026-04-20', 'MARKET', '["rate","tare","tear","tamer","taker","maker","remake","market","mate","meat","team","tame","take","rake","make","mark","mare","tram","term","ream","kart","art","are","ear","eat","tea","tar","rat","arm","met","mat","ark","am","at","me","re"]'::jsonb),
  ('2026-04-19', 'ORANGE', '["rag","rage","rang","range","anger","groan","organ","orange","onager","goner","argon","gear","earn","near","gore","gone","age","nag","ran","are","era","ear","ore","roe","one","eon","ego","oar","nor","an","go","no","on","or","re"]'::jsonb),
  ('2026-04-18', 'HEART', '["hear","heart","earth","hater","heat","hate","hare","tear","tare","rate","hart","her","the","hat","art","rat","tar","are","ear","eat","tea","he","at","ah","ha","re"]'::jsonb),
  ('2026-04-17', 'SILENT', '["line","lines","listen","silent","enlist","inlets","tinsel","tile","tiles","tine","ties","site","list","lint","slit","nest","nets","sent","lest","lets","lie","lit","sit","set","tie","ten","net","sin","ins","nil","nit","let","is","it","in"]'::jsonb),
  ('2026-04-16', 'CRANE', '["ear","earn","near","care","race","acre","cane","crane","caner","nacre","era","are","ran","car","can","arc","ace","an","ar","re"]'::jsonb),
  ('2026-04-15', 'GARDEN', '["rage","raged","range","anger","garden","danger","ranged","gander","grade","grand","gear","dear","dare","read","rend","near","aged","rag","ran","red","end","den","and","are","era","ear","age","an","ad","re"]'::jsonb),
  ('2026-04-14', 'SPARE', '["pear","pears","spare","spear","pares","parse","reaps","pare","rape","sear","ears","eras","apes","ape","par","rap","sap","spa","are","ear","era","as","pa","re"]'::jsonb),
  ('2026-04-13', 'PLANET', '["late","plate","pleat","platen","planet","petal","panel","leant","lane","lean","tale","teal","neat","peat","pale","leap","plan","ant","tan","tap","pan","pen","pet","apt","let","ale","lea","eat","tea","at","an"]'::jsonb),
  ('2026-04-12', 'MUSIC', '["sum","muse","music","scum","mics","mic","sic","ism","is","us","mu","mi","si"]'::jsonb),
  ('2026-04-11', 'STREAM', '["team","teams","steam","stream","master","tamers","maters","meats","mate","meat","tame","seam","same","seat","stare","tears","rates","tear","tare","rate","star","arm","art","are","ear","eat","tea","tar","rat","set","sat","mat","met","am","as","at","me","re"]'::jsonb),
  ('2026-04-10', 'CLOUD', '["loud","cloud","could","cold","clod","cod","col","old","duo","doc","do","od"]'::jsonb),
  ('2026-04-09', 'BRIGHT', '["rig","grit","girth","right","birth","bright","brig","high","hit","big","bit","rib","it","hi"]'::jsonb),
  ('2026-04-08', 'STONE', '["note","notes","stone","tones","onset","tone","ones","nest","sent","eons","nose","son","one","ten","net","set","toe","ton","not","eon","to","so","on","no"]'::jsonb),
  ('2026-04-07', 'MELON', '["one","omen","lone","lemon","melon","mole","noel","men","elm","eon","ole","on","no","me"]'::jsonb)
on conflict (puzzle_date) do update
set
  letters = excluded.letters,
  words = excluded.words,
  updated_at = now();
