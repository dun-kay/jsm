revoke execute on function public.user_has_episode_access(uuid) from public, anon;
revoke execute on function public.get_episode_paid_content(uuid) from public, anon;
revoke execute on function public.set_marketing_consent(boolean) from public, anon;

grant execute on function public.user_has_episode_access(uuid) to authenticated;
grant execute on function public.get_episode_paid_content(uuid) to authenticated;
grant execute on function public.set_marketing_consent(boolean) to authenticated;
