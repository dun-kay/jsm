grant select (id, title, slug, description, cover_image, status)
on public.series to anon, authenticated;

grant select (id, series_id, season_number, title)
on public.seasons to anon, authenticated;

grant select (id, season_id, episode_number, title, slug, preview_html, published, published_at)
on public.episodes to anon, authenticated;

grant select (id, name, active)
on public.products to anon, authenticated;

grant select (product_id, episode_id)
on public.product_episodes to anon, authenticated;

drop policy if exists "Anyone can read active series catalog rows" on public.series;
create policy "Anyone can read active series catalog rows"
  on public.series for select
  to anon, authenticated
  using (status = 'active');

drop policy if exists "Anyone can read seasons for active series" on public.seasons;
create policy "Anyone can read seasons for active series"
  on public.seasons for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.series s
      where s.id = seasons.series_id
        and s.status = 'active'
    )
  );

drop policy if exists "Anyone can read published episode previews" on public.episodes;
create policy "Anyone can read published episode previews"
  on public.episodes for select
  to anon, authenticated
  using (
    published = true
    and exists (
      select 1
      from public.seasons se
      join public.series s on s.id = se.series_id
      where se.id = episodes.season_id
        and s.status = 'active'
    )
  );

drop policy if exists "Anyone can read active product names" on public.products;
create policy "Anyone can read active product names"
  on public.products for select
  to anon, authenticated
  using (active = true);

drop policy if exists "Anyone can read product episode mappings" on public.product_episodes;
create policy "Anyone can read product episode mappings"
  on public.product_episodes for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.products p
      where p.id = product_episodes.product_id
        and p.active = true
    )
    and exists (
      select 1
      from public.episodes e
      where e.id = product_episodes.episode_id
        and e.published = true
    )
  );
