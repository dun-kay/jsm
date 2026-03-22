-- Murder Club v2 role split:
-- - Even player count: exact 50/50 split (Murderers vs Investigators)
-- - Odd player count: split the even subset 50/50, then random extra player to either side.

create or replace function public.mc2_assign_conspirators(p_lobby_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_count integer;
  v_conspirator_count integer;
begin
  select count(*) into v_player_count
  from public.lobby_players p
  where p.lobby_id = p_lobby_id;

  if v_player_count < 4 then
    return '[]'::jsonb;
  end if;

  v_conspirator_count := floor(v_player_count / 2.0)::integer;

  -- For odd sizes, randomly assign the extra player to either team.
  if (v_player_count % 2) = 1 and random() < 0.5 then
    v_conspirator_count := v_conspirator_count + 1;
  end if;

  return (
    select coalesce(jsonb_agg(s.id), '[]'::jsonb)
    from (
      select p.id
      from public.lobby_players p
      where p.lobby_id = p_lobby_id
      order by random()
      limit v_conspirator_count
    ) s
  );
end;
$$;

grant execute on function public.mc2_assign_conspirators(uuid) to anon, authenticated;
