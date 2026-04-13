-- Draw WF: letter bank extras by word length + true shuffled output order

create or replace function public.dwf_letter_bank(p_word text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_word text := upper(coalesce(trim(p_word), 'CAT'));
  v_len integer := greatest(char_length(upper(coalesce(trim(p_word), 'CAT'))), 0);
  v_letters text[] := regexp_split_to_array(v_word, '');
  v_vowels text[] := array['A','E','I','O','U'];
  v_cons text[] := array['B','C','D','F','G','H','J','K','L','M','N','P','Q','R','S','T','V','W','X','Y','Z'];
  v_out text[] := array[]::text[];
  v_item text;
  v_extra_vowels integer := 1;
  v_extra_cons integer := 1;
  i integer;
begin
  foreach v_item in array v_letters loop
    if v_item <> '' then
      v_out := array_append(v_out, v_item);
    end if;
  end loop;

  case v_len
    when 6 then
      v_extra_vowels := 1;
      v_extra_cons := 1;
    when 5 then
      v_extra_vowels := 2;
      v_extra_cons := 1;
    when 4 then
      v_extra_vowels := 2;
      v_extra_cons := 2;
    when 3 then
      v_extra_vowels := 3;
      v_extra_cons := 2;
    else
      v_extra_vowels := 1;
      v_extra_cons := 1;
  end case;

  for i in 1..v_extra_vowels loop
    v_out := array_append(v_out, v_vowels[1 + floor(random() * array_length(v_vowels,1))::integer]);
  end loop;

  for i in 1..v_extra_cons loop
    v_out := array_append(v_out, v_cons[1 + floor(random() * array_length(v_cons,1))::integer]);
  end loop;

  return (
    select coalesce(jsonb_agg(letter), '[]'::jsonb)
    from (
      select letter
      from unnest(v_out) as letter
      order by random()
    ) shuffled
  );
end;
$$;

grant execute on function public.dwf_letter_bank(text) to anon, authenticated;
