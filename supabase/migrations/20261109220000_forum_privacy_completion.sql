-- Source-only preparation. Apply with production preflight in a separately authorized release.
begin;

do $$ begin
 if to_regprocedure('public.social_users_blocked(uuid,uuid)') is null
  or to_regprocedure('public.is_account_erasure_write(uuid)') is null then
  raise exception 'Existing block and due-erasure mechanisms are required.';
 end if;
 perform author_user_id,body from public.visit_experience_replies limit 0;
 perform actor_user_id,body from public.visit_experience_history limit 0;
end $$;

-- Preserve deployed reader/writer bodies, signatures, ACLs and moderation views.
-- Filter rows before pagination/counting, including Today preview and deep links.
do $patch$
declare d text; relation text; marker text;
begin
 d:=pg_get_functiondef('public.forum_read(jsonb)'::regprocedure);
 if strpos(d,'forum personal block visibility')=0 then
  if strpos(d,'v_user uuid:=public.forum_actor()')=0 or strpos(d,'latest_preview')=0
   or strpos(d,'from public.forum_topics t')=0 or strpos(d,'from public.forum_replies r')=0
   or strpos(d,'from public.forum_chat c')=0 then raise exception 'Forum reader changed; review privacy patch.'; end if;
  foreach relation in array array['forum_topics t','forum_replies r','forum_replies ur','forum_chat c'] loop
   d:=replace(d,'from public.'||relation,
    'from (select * from public.'||split_part(relation,' ',1)||' where not public.social_users_blocked(v_user,author_id)) '||split_part(relation,' ',2));
  end loop;
  d:=replace(d,'mode text:=','/* forum personal block visibility */ mode text:=');
  execute d;
 end if;
 d:=pg_get_functiondef('public.forum_write(jsonb)'::regprocedure);
 if strpos(d,'forum personal block target')=0 then
  marker:='if op in (''follow'',''seen'') then';
  if strpos(d,marker)=0 then raise exception 'Forum writer changed; review privacy patch.'; end if;
  d:=replace(d,marker,$branch$
  -- forum personal block target: existing actor/restriction checks remain in force.
  if op in ('reply','bookmark','follow','seen') and exists(
   select 1 from public.forum_topics where id=target::uuid and public.social_users_blocked(v_user,author_id)
  ) then raise exception 'Topic not found.' using errcode='P0002'; end if;
  if op in ('follow','seen') then$branch$);
  execute d;
 end if;
 d:=pg_get_functiondef('public.forum_notify_reply()'::regprocedure);
 if strpos(d,'social_users_blocked')=0 then
  marker:='where recipient.id<>new.author_id';
  if strpos(d,marker)=0 then raise exception 'Forum notifications changed; review privacy patch.'; end if;
  execute replace(d,marker,marker||' and not public.social_users_blocked(recipient.id,new.author_id) and not public.social_users_blocked(recipient.id,topic.author_id)');
 end if;
end $patch$;

create or replace function public.forum_after_personal_block() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 -- Only the two users' follows and inbox entries are affected. Saved records
 -- remain private and become readable again if the users unblock each other.
 insert into forum_subscriptions(user_id,topic_id,enabled)
 select pair.actor,t.id,false from forum_topics t
 cross join (values(new.blocker_user_id,new.blocked_user_id),(new.blocked_user_id,new.blocker_user_id)) pair(actor,other_user)
 where t.author_id=pair.other_user and public.forum_is_following(pair.actor,t.id)
 on conflict(user_id,topic_id) do update set enabled=false,updated_at=now();
 delete from app_notifications n where n.notification_type='forum_reply'
 and n.recipient_user_id in (new.blocker_user_id,new.blocked_user_id)
 and (exists(select 1 from forum_topics t where t.id=n.forum_topic_id
  and public.social_users_blocked(n.recipient_user_id,t.author_id))
  or exists(select 1 from forum_replies r where n.event_key='forum-reply:'||r.id::text
   and public.social_users_blocked(n.recipient_user_id,r.author_id)));
 return new;
end $$;
revoke all on function public.forum_after_personal_block() from public,anon,authenticated,service_role;
drop trigger if exists forum_after_personal_block on public.user_blocks;
create trigger forum_after_personal_block after insert on public.user_blocks
 for each row execute function public.forum_after_personal_block();

-- Existing social blocks must also suppress previously queued Forum previews.
insert into public.forum_subscriptions(user_id,topic_id,enabled)
select distinct pair.actor,t.id,false from public.user_blocks b
cross join lateral (values(b.blocker_user_id,b.blocked_user_id),(b.blocked_user_id,b.blocker_user_id)) pair(actor,other_user)
join public.forum_topics t on t.author_id=pair.other_user
where public.forum_is_following(pair.actor,t.id)
on conflict(user_id,topic_id) do update set enabled=false,updated_at=now();
delete from public.app_notifications n where n.notification_type='forum_reply'
 and (exists(select 1 from public.forum_topics t where t.id=n.forum_topic_id
  and public.social_users_blocked(n.recipient_user_id,t.author_id))
  or exists(select 1 from public.forum_replies r where n.event_key='forum-reply:'||r.id::text
   and public.social_users_blocked(n.recipient_user_id,r.author_id)));

-- Run only inside the existing due-account erasure transaction. Keep contentless
-- parent rows so other users' replies and moderation references are not cascaded.
create or replace function public.erase_forum_personal_content(p_user_id uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
 if not public.is_account_erasure_write(p_user_id) then raise exception 'Due account erasure required.' using errcode='42501'; end if;
 delete from app_notifications n where n.notification_type='forum_reply'
 and (n.recipient_user_id=p_user_id
  or exists(select 1 from forum_topics t where t.id=n.forum_topic_id and t.author_id=p_user_id)
  or exists(select 1 from forum_replies r where n.event_key='forum-reply:'||r.id::text and r.author_id=p_user_id));
 update forum_topics set title='Deleted topic',body='[Deleted]',state=null,author_id=null,seed_persona_id=null,
  deleted_at=coalesce(deleted_at,now()),updated_at=now() where author_id=p_user_id;
 update forum_replies set body='[Deleted]',author_id=null,seed_persona_id=null,
  deleted_at=coalesce(deleted_at,now()),updated_at=now() where author_id=p_user_id;
 update forum_chat set body='[Deleted]',author_id=null,deleted_at=coalesce(deleted_at,now()) where author_id=p_user_id;
 delete from forum_bookmarks where user_id=p_user_id;
 delete from forum_subscriptions where user_id=p_user_id;
 delete from forum_rate_limits where user_id=p_user_id;
 -- Retain moderation case identity/timestamps/actions, not the deleting user's free text.
 update forum_reports set reason='[Deleted]',reporter_id=null where reporter_id=p_user_id;
 update forum_audit set reason='[Deleted]',details='{}',actor_id=null where actor_id=p_user_id;
 -- Newer personal reply/history surfaces were added after the original erasure.
 update visit_experience_replies set body='[Deleted]' where author_user_id=p_user_id;
 update visit_experience_history set body=null where actor_user_id=p_user_id;
end $$;
revoke all on function public.erase_forum_personal_content(uuid) from public,anon,authenticated,service_role;

do $patch$
declare d text; marker text:='delete from customer_verified_phones where user_id=p_user_id;';
begin
 d:=pg_get_functiondef('public.erase_account_personal_content(uuid,uuid)'::regprocedure);
 if strpos(d,'perform public.erase_forum_personal_content(p_user_id)')=0 then
  if strpos(d,marker)=0 then raise exception 'Account erasure changed; review Forum integration.'; end if;
  execute replace(d,marker,marker||E'\n perform public.erase_forum_personal_content(p_user_id);');
 end if;
end $patch$;
notify pgrst,'reload schema';
commit;
