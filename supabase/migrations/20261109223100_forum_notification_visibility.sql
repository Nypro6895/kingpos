begin;
-- Cleanup/insert suppression alone cannot close two-transaction MVCC races.
-- Recheck canonical authors at every read/count, including late committed rows.
create or replace function public.forum_notification_blocked(n public.app_notifications) returns boolean
language sql stable security definer set search_path=public as $$
 select coalesce(n.notification_type='forum_reply',false) and (not exists(
  select 1 from public.app_notifications stored where stored.id=n.id
   and stored.recipient_user_id=n.recipient_user_id and stored.notification_type='forum_reply'
   and stored.forum_topic_id=n.forum_topic_id and stored.event_key=n.event_key
 ) or not exists(
  select 1 from public.forum_topics t join public.forum_replies r on r.topic_id=t.id
  where t.id=n.forum_topic_id and n.event_key='forum-reply:'||r.id::text
   and t.deleted_at is null and r.deleted_at is null
   and not public.social_users_blocked(n.recipient_user_id,t.author_id)
   and not public.social_users_blocked(n.recipient_user_id,r.author_id)
 ));
$$;
revoke all on function public.forum_notification_blocked(public.app_notifications) from public,anon,authenticated,service_role;
do $patch$ declare d text; at integer; marker text:='n.recipient_user_id=current_public_user_id()';begin
 d:=pg_get_functiondef('public.notification_visible_to_actor(public.app_notifications)'::regprocedure);
 if strpos(d,'forum_notification_blocked')=0 then
  at:=strpos(d,marker);
  if at=0 or strpos(substr(d,at+length(marker)),marker)>0 then raise exception 'Review shared notification visibility before adding Forum guard.';end if;
  execute overlay(d placing 'not public.forum_notification_blocked(n) and '||marker from at for length(marker));
 end if;
end $patch$;
drop policy if exists forum_notification_privacy on public.app_notifications;
create policy forum_notification_privacy on public.app_notifications as restrictive for select to authenticated
 using(notification_type<>'forum_reply' or public.notification_visible_to_actor(app_notifications));
notify pgrst,'reload schema';
commit;
