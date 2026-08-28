create or replace function public.trim_edge_blank_story_blocks(input_html text)
returns text
language sql
immutable
as $$
  select btrim(
    regexp_replace(
      regexp_replace(
        coalesce(input_html, ''),
        '^\s*(<p>(\s|&nbsp;|&#160;|<br\s*/?>)*</p>\s*)+',
        '',
        'gi'
      ),
      '(\s*<p>(\s|&nbsp;|&#160;|<br\s*/?>)*</p>)+\s*$',
      '',
      'gi'
    )
  );
$$;

update public.episodes
set
  preview_html = public.trim_edge_blank_story_blocks(preview_html),
  paid_html = public.trim_edge_blank_story_blocks(paid_html)
where preview_html is not null
   or paid_html is not null;
