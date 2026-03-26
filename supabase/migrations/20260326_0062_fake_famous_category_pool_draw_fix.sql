-- Fake Famous: support category-object quote pools during card draw.
-- This avoids "cannot get array length of a non-array" when quote_pool is
-- { categories: [...] } and deck already contains the sampled cards.

create or replace function public.rd_draw_card(p_quote_pool jsonb, p_deck jsonb)
returns table(card jsonb, next_deck jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deck jsonb := coalesce(p_deck, '[]'::jsonb);
  v_pool jsonb := coalesce(p_quote_pool, '[]'::jsonb);
begin
  if jsonb_typeof(v_deck) <> 'array' then
    v_deck := '[]'::jsonb;
  end if;

  -- Preferred path: use prepared game deck first.
  if jsonb_array_length(v_deck) > 0 then
    card := v_deck -> 0;
    select coalesce(jsonb_agg(e.value order by e.ord), '[]'::jsonb)
    into next_deck
    from jsonb_array_elements(v_deck) with ordinality as e(value, ord)
    where e.ord > 1;
    return next;
  end if;

  -- Fallback path if deck was empty: resolve quote pool into an array.
  if jsonb_typeof(v_pool) = 'object' and jsonb_typeof(v_pool -> 'categories') = 'array' then
    with all_quotes as (
      select q.value as quote
      from jsonb_array_elements(v_pool -> 'categories') c(value)
      cross join lateral jsonb_array_elements(coalesce(c.value -> 'quotes', '[]'::jsonb)) q(value)
    )
    select coalesce(jsonb_agg(quote), '[]'::jsonb)
    into v_pool
    from all_quotes;
  elsif jsonb_typeof(v_pool) <> 'array' then
    v_pool := '[]'::jsonb;
  end if;

  if jsonb_array_length(v_pool) = 0 then
    raise exception 'Quote pool is empty.';
  end if;

  v_deck := public.rd_shuffle_json(v_pool);
  card := v_deck -> 0;
  select coalesce(jsonb_agg(e.value order by e.ord), '[]'::jsonb)
  into next_deck
  from jsonb_array_elements(v_deck) with ordinality as e(value, ord)
  where e.ord > 1;

  return next;
end;
$$;

grant execute on function public.rd_draw_card(jsonb, jsonb) to anon, authenticated;
