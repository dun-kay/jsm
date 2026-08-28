update public.episodes
set preview_html = replace(
  preview_html,
  ' Someone had dragged an old sofa onto the beach. Someone else had acquired a shopping trolley. It was that sort of night.',
  ''
)
where id = '33333333-3333-4333-8333-333333333331';
