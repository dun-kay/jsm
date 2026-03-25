-- Expand Lying Llama prompt pools to 50 weird tells and 30 mini challenges.

create or replace function public.ll_random_charlatan_prompt()
returns text
language sql
security definer
set search_path = public
as $$
  select p.prompt
  from (
    values
      ('Hop on one leg while you answer.'),
      ('Touch your nose while you answer.'),
      ('Blink twice before you answer.'),
      ('Say it in a robot voice.'),
      ('Put one hand on your head while you answer.'),
      ('Answer while smiling.'),
      ('Shrug while you answer.'),
      ('Tap your shoulder before you answer.'),
      ('Answer in a whisper.'),
      ('Tilt your head while you answer.'),
      ('Cover one eye while you answer.'),
      ('Hold your breath for one second before you answer.'),
      ('Point at your elbow while you answer.'),
      ('Wiggle your fingers while you answer.'),
      ('Answer with a dramatic gasp first.'),
      ('Say your answer in a tiny voice.'),
      ('Say your answer in a giant voice.'),
      ('Touch your chin while you answer.'),
      ('Touch your ear while you answer.'),
      ('Touch your shoulder while you answer.'),
      ('Tap your knee while you answer.'),
      ('Raise one eyebrow while you answer.'),
      ('Do a quick nod before you answer.'),
      ('Do a quick head shake before you answer.'),
      ('Say your answer like a sleepy llama.'),
      ('Say your answer like a superhero.'),
      ('Say your answer like a pirate.'),
      ('Say your answer like a news reporter.'),
      ('Say your answer like you are freezing.'),
      ('Say your answer like you are very excited.'),
      ('Make a tiny drumroll on your leg before you answer.'),
      ('Clap once before you answer.'),
      ('Spin in place once before you answer.'),
      ('Take one tiny hop before you answer.'),
      ('Make a silly face while you answer.'),
      ('Puff your cheeks while you answer.'),
      ('Keep your lips tucked in while you answer.'),
      ('Keep one hand on your heart while you answer.'),
      ('Point at the ceiling while you answer.'),
      ('Point at the floor while you answer.'),
      ('Cross your arms while you answer.'),
      ('Keep both hands behind your back while you answer.'),
      ('Pretend to zip your mouth, then answer.'),
      ('Pretend to sneeze, then answer.'),
      ('Do jazz hands while you answer.'),
      ('Pretend to be a statue, then answer.'),
      ('Wave with one hand while you answer.'),
      ('Use your silliest serious voice.'),
      ('Answer like you are in slow motion.'),
      ('Answer like you are in fast forward.')
  ) as p(prompt)
  order by random()
  limit 1;
$$;

create or replace function public.ll_random_battle_prompt()
returns text
language sql
security definer
set search_path = public
as $$
  select p.prompt
  from (
    values
      ('First person to touch red gets this card.'),
      ('First person to stand up gets this card.'),
      ('First person to clap 3 times gets this card.'),
      ('First person to touch their head gets this card.'),
      ('First person to point at the ceiling gets this card.'),
      ('First person to touch the floor gets this card.'),
      ('First person to say llama gets this card.'),
      ('First person to clap 10 times gets this card.'),
      ('First person to spell CAT out loud gets this card.'),
      ('First person to spell DOG out loud gets this card.'),
      ('First person to say SUN backwards gets this card.'),
      ('First person to say MAP backwards gets this card.'),
      ('First person to say TOP backwards gets this card.'),
      ('First person to do two tiny jumps gets this card.'),
      ('First person to tap both shoulders gets this card.'),
      ('First person to touch their nose gets this card.'),
      ('First person to touch one knee gets this card.'),
      ('First person to snap their fingers gets this card.'),
      ('First person to wave both hands gets this card.'),
      ('First person to spin once gets this card.'),
      ('First person to whisper banana gets this card.'),
      ('First person to whisper gorilla gets this card.'),
      ('First person to say frog in a robot voice gets this card.'),
      ('First person to say llama in a pirate voice gets this card.'),
      ('First person to make a heart with their hands gets this card.'),
      ('First person to touch something blue gets this card.'),
      ('First person to touch something green gets this card.'),
      ('First person to point at a shoe gets this card.'),
      ('First person to tap the table twice gets this card.'),
      ('First person to shout game on gets this card.')
  ) as p(prompt)
  order by random()
  limit 1;
$$;
