begin;

create table public.account_erasure_jobs (
 user_id uuid primary key references public.users(id),
 auth_user_id uuid,
 status text not null default 'pending' check(status in ('pending','processing','complete')),
 lease_token uuid, leased_until timestamptz, attempts integer not null default 0,
 next_attempt_at timestamptz not null default now(), last_error text,
 created_at timestamptz not null default now(), completed_at timestamptz,
 notification_email text, notified_at timestamptz
);
create table public.account_erasure_objects (
 user_id uuid not null references public.account_erasure_jobs(user_id) on delete cascade,
 bucket_id text not null, object_path text not null,
 disposition text not null check(disposition in ('purge','retain_business')),
 completed_at timestamptz,
 primary key(user_id,bucket_id,object_path)
);
create table public.account_deletion_receipts (
 token uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id),
 requested_at timestamptz not null, scheduled_for timestamptz not null,
 completed_at timestamptz, unique(user_id,requested_at)
);
alter table public.account_erasure_jobs enable row level security;
alter table public.account_erasure_objects enable row level security;
alter table public.account_deletion_receipts enable row level security;
revoke all on public.account_erasure_jobs,public.account_erasure_objects,public.account_deletion_receipts from public,anon,authenticated;
grant all on public.account_erasure_jobs,public.account_erasure_objects,public.account_deletion_receipts to service_role;

-- Content triggers normally prevent changing an author's identity or editing an
-- unavailable reply. Only the locked, due erasure job can write its tombstones.
create function public.is_account_erasure_write(p_user_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select nullif(current_setting('reylumi.account_erasure_user',true),'')=p_user_id::text
 and exists(select 1 from account_erasure_jobs j join users u on u.id=j.user_id
  where j.user_id=p_user_id and j.status<>'complete' and u.status in ('pending_deletion','deleted') and u.deletion_scheduled_for<=now())
$$;
revoke all on function public.is_account_erasure_write(uuid) from public,anon,authenticated,service_role;

do $patch$
declare name text; d text; at integer; needle text:=E'\nbegin\n';
begin
 foreach name in array array['abuse_guard_content','abuse_guard_image','post_safety_scan','validate_unified_post_comment','validate_comment_persona'] loop
  d:=replace(pg_get_functiondef(('public.'||name||'()')::regprocedure),E'\r\n',E'\n');
  at:=strpos(d,needle);
  if at=0 then raise exception 'Content trigger % changed; review erasure compatibility.',name; end if;
  d:=overlay(d placing needle||E' if TG_OP = ''UPDATE'' and public.is_account_erasure_write((to_jsonb(NEW)->>''author_user_id'')::uuid) then return NEW; end if;\n' from at for length(needle));
  execute d;
 end loop;
end $patch$;

create function public.get_my_account_deletion_receipt() returns uuid
language plpgsql security definer set search_path=public as $$
declare u public.users%rowtype; result uuid;
begin
 select * into u from users where id=current_public_user_id() for update;
 if u.status is distinct from 'pending_deletion' or u.deletion_requested_at is null then return null; end if;
 insert into account_deletion_receipts(user_id,requested_at,scheduled_for)
 values(u.id,u.deletion_requested_at,u.deletion_scheduled_for)
 on conflict(user_id,requested_at) do update set scheduled_for=excluded.scheduled_for returning token into result;
 return result;
end $$;
revoke all on function public.get_my_account_deletion_receipt() from public,anon;
grant execute on function public.get_my_account_deletion_receipt() to authenticated;

-- The unguessable receipt reveals status and dates only; no account identifiers.
create function public.get_account_deletion_receipt(p_token uuid) returns jsonb
language sql stable security definer set search_path=public as $$
 select jsonb_build_object('scheduledFor',r.scheduled_for,'completedAt',r.completed_at,'status',
  case when r.completed_at is not null then 'complete'
   when u.deletion_requested_at is distinct from r.requested_at then 'cancelled'
   when j.status='complete' then 'complete' when j.user_id is not null then 'processing' else 'scheduled' end)
 from account_deletion_receipts r join users u on u.id=r.user_id
 left join account_erasure_jobs j on j.user_id=r.user_id where r.token=p_token
$$;
revoke all on function public.get_account_deletion_receipt(uuid) from public;
grant execute on function public.get_account_deletion_receipt(uuid) to anon,authenticated,service_role;

create function public.prepare_account_erasure(p_user_id uuid,p_auth_id uuid,p_email text) returns void
language plpgsql security definer set search_path=public as $$
begin
 insert into account_erasure_jobs(user_id,auth_user_id,notification_email) values(p_user_id,p_auth_id,p_email)
 on conflict(user_id) do nothing;
 -- Include orphaned uploads and old avatars, not only current profile URLs.
 insert into account_erasure_objects(user_id,bucket_id,object_path,disposition)
 select p_user_id,o.bucket_id,o.name,
  case when o.bucket_id in ('salon-profile-media','pos-display-media','payroll-paystubs','support-evidence') then 'retain_business' else 'purge' end
 from storage.objects o where
  (p_auth_id is not null and (o.owner=p_auth_id or o.owner_id=p_auth_id::text))
  or (o.bucket_id in ('account-avatars','beauty-profile-media','lifecycle-exports') and split_part(o.name,'/',1)=p_user_id::text)
 on conflict do nothing;
 -- Personal content remains personal even if it was uploaded through a service.
 insert into account_erasure_objects(user_id,bucket_id,object_path,disposition)
 select p_user_id,paths.bucket,paths.path,'purge' from (
  select m.bucket,m.object_path path from beauty_post_media m join beauty_posts p on p.id=m.post_id where p.author_user_id=p_user_id
  union select 'salon-profile-media',media_path from salon_profile_looks where author_user_id=p_user_id
  union select 'salon-profile-media',media_path from salon_profile_updates where author_user_id=p_user_id
  union select 'salon-profile-media',public_profile_photo_path from staff where account_user_id=p_user_id or user_id=p_auth_id
  union select storage_bucket,storage_path from lifecycle_exports where requested_by_user_id=p_user_id or subject_user_id=p_user_id
 ) paths where paths.path is not null and paths.path<>''
 on conflict(user_id,bucket_id,object_path) do update set disposition='purge';
end $$;
revoke all on function public.prepare_account_erasure(uuid,uuid,text) from public,anon,authenticated,service_role;

create function public.erase_account_personal_content(p_user_id uuid,p_auth_id uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
 delete from beauty_post_media where post_id in(select id from beauty_posts where author_user_id=p_user_id);
 -- Reward/accounting references retain only a contentless internal tombstone.
 update beauty_posts set caption=null,visibility='self',moderation_status='withdrawn',deleted_at=coalesce(deleted_at,now()) where author_user_id=p_user_id;
 update beauty_profiles set bio=null,cover_media_path=null,visibility='self' where user_id=p_user_id;
 update salon_profile_looks set title='Deleted post',caption=null,emotional_description=null,why_love_it=null,mood=null,palette='{}',badge=null,media_path=null,booking_note=null,author_display_name='Deleted user',author_avatar_path=null,status='archived' where author_user_id=p_user_id;
 update salon_profile_updates set title='Deleted post',caption=null,summary=null,media_path=null,cta_label=null,author_display_name='Deleted user',author_avatar_path=null,status='archived' where author_user_id=p_user_id;
 update salon_profile_comments set body='[Deleted]',author_display_name='Deleted user',status='deleted',updated_at=now() where author_user_id=p_user_id;
 delete from app_notifications n using salon_profile_comments c
  where c.author_user_id=p_user_id and n.event_key='post_comment_created:'||c.id::text||':'||n.recipient_user_id::text;
 update salon_profile_reviews set body='[Deleted]',title=null,moderation_reason=null,moderation_status='withdrawn',updated_at=now() where author_user_id=p_user_id;
 update salon_profile_review_replies set body='[Deleted]',moderation_status='withdrawn',updated_at=now() where author_user_id=p_user_id;
 -- Public visit feedback is user content, not the retained POS transaction.
 delete from customer_visit_experiences where author_user_id=p_user_id;
 update post_safety_cases set content_snapshot='{}',matched_keywords='{}' where author_user_id=p_user_id;
 update salon_profile_media_assets a set status='deleted',deleted_at=now() where exists(
  select 1 from account_erasure_objects o where o.user_id=p_user_id and o.disposition='purge' and o.bucket_id=a.bucket and o.object_path=a.object_path);
 delete from lifecycle_exports where requested_by_user_id=p_user_id or subject_user_id=p_user_id;
 delete from user_blocks where blocker_user_id=p_user_id or blocked_user_id=p_user_id;
 delete from post_safety_hidden where user_id=p_user_id;
 delete from notification_preferences where user_id=p_user_id;
 delete from account_login_sessions where user_id=p_user_id;
 delete from account_trusted_devices where user_id=p_user_id;
 delete from account_recovery_codes where user_id=p_user_id;
 delete from account_security_preferences where user_id=p_user_id;
 delete from account_login_activity where user_id=p_user_id;
 delete from account_recovery_requests where user_id=p_user_id;
 -- POS idempotency receipts are not the accounting ledger. Remove their auth FK.
 delete from pos_owner_operations where user_id=p_auth_id;
 delete from customer_verified_phones where user_id=p_user_id;
end $$;
revoke all on function public.erase_account_personal_content(uuid,uuid) from public,anon,authenticated,service_role;

create function public.claim_account_erasure() returns jsonb
language plpgsql security definer set search_path=public as $$
declare job account_erasure_jobs%rowtype;
begin
 select * into job from account_erasure_jobs where status<>'complete' and next_attempt_at<=now()
  and (leased_until is null or leased_until<now()) order by created_at for update skip locked limit 1;
 if job.user_id is null then return null; end if;
 update account_erasure_jobs set status='processing',lease_token=gen_random_uuid(),leased_until=now()+interval '6 minutes',attempts=attempts+1
 where user_id=job.user_id returning * into job;
 return jsonb_build_object('userId',job.user_id,'authUserId',job.auth_user_id,'lease',job.lease_token);
end $$;

create function public.account_erasure_batch(p_user_id uuid,p_lease uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from account_erasure_jobs where user_id=p_user_id and lease_token=p_lease and leased_until>now() and status='processing') then raise exception 'Erasure lease expired.'; end if;
 return coalesce((select jsonb_agg(to_jsonb(o)) from (
  select bucket_id,object_path,disposition from account_erasure_objects where user_id=p_user_id and completed_at is null order by bucket_id,object_path limit 40
 ) o),'[]'::jsonb);
end $$;

create function public.finish_account_erasure_object(p_user_id uuid,p_lease uuid,p_bucket text,p_path text) returns void
language plpgsql security definer set search_path=public as $$
declare job account_erasure_jobs%rowtype; action text;
begin
 select * into job from account_erasure_jobs where user_id=p_user_id and lease_token=p_lease and leased_until>now() and status='processing' for update;
 if job.user_id is null then raise exception 'Erasure lease expired.'; end if;
 select disposition into action from account_erasure_objects where user_id=p_user_id and bucket_id=p_bucket and object_path=p_path;
 if action is null then raise exception 'Unknown erasure object.'; end if;
 if exists(select 1 from storage.objects o where o.bucket_id=p_bucket and o.name=p_path and
   (action='purge' or (job.auth_user_id is not null and (o.owner=job.auth_user_id or o.owner_id=job.auth_user_id::text)))) then
  raise exception 'Storage operation has not been confirmed.';
 end if;
 update account_erasure_objects set completed_at=now() where user_id=p_user_id and bucket_id=p_bucket and object_path=p_path;
end $$;

create function public.finish_account_erasure(p_user_id uuid,p_lease uuid,p_error text default null) returns void
language plpgsql security definer set search_path=public as $$
declare job account_erasure_jobs%rowtype;
begin
 select * into job from account_erasure_jobs where user_id=p_user_id and lease_token=p_lease and leased_until>now() and status='processing' for update;
 if job.user_id is null then raise exception 'Erasure lease expired.'; end if;
 if p_error is not null then
  update account_erasure_jobs set status='pending',lease_token=null,leased_until=null,last_error=left(p_error,100),next_attempt_at=now()+interval '15 minutes' where user_id=p_user_id;
  update users set deletion_finalization_failed_at=now(),deletion_finalization_error='Personal data erasure will be retried.' where id=p_user_id;
  return;
 end if;
 if exists(select 1 from account_erasure_objects where user_id=p_user_id and completed_at is null) then raise exception 'Storage erasure is incomplete.'; end if;
 if exists(select 1 from auth.users where id=job.auth_user_id) then raise exception 'Authentication erasure is incomplete.'; end if;
 if exists(select 1 from storage.objects where owner=job.auth_user_id or owner_id=job.auth_user_id::text) then raise exception 'Storage ownership remains.'; end if;
 update account_erasure_jobs set status='complete',lease_token=null,leased_until=null,last_error=null,completed_at=now(),auth_user_id=null where user_id=p_user_id;
 update users set deletion_finalized_at=now(),deletion_finalization_error=null,deletion_finalization_failed_at=null where id=p_user_id;
 update account_deletion_receipts set completed_at=now() where user_id=p_user_id and requested_at=(select deletion_requested_at from users where id=p_user_id);
 insert into account_lifecycle_events(user_id,event_type,metadata) values(p_user_id,'account_deletion_finalized',jsonb_build_object('finalized_at',now(),'storage_and_auth_erased',true));
 delete from account_erasure_objects where user_id=p_user_id;
end $$;

do $$ declare sig text; begin
 foreach sig in array array['claim_account_erasure()','account_erasure_batch(uuid,uuid)','finish_account_erasure_object(uuid,uuid,text,text)','finish_account_erasure(uuid,uuid,text)'] loop
  execute 'revoke all on function public.'||sig||' from public,anon,authenticated';
  execute 'grant execute on function public.'||sig||' to service_role';
 end loop;
end $$;

create or replace function public.finalize_account_deletion(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_started_event boolean;
  finalization_time timestamptz := now();
  unresolved_salon_count integer := 0;
  user_row public.users%rowtype;
begin
  if p_user_id is null then
    raise exception 'User id is required.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('account-finalize:' || p_user_id::text, 0));

  select *
  into user_row
  from public.users
  where id = p_user_id
  for update;

  if user_row.id is null then
    return jsonb_build_object(
      'ok', false,
      'changed', false,
      'reason', 'not_found',
      'user_id', p_user_id
    );
  end if;

  if user_row.status = 'deleted' and user_row.anonymized_at is not null then
    return jsonb_build_object(
      'ok', true,
      'changed', false,
      'status', user_row.status,
      'user_id', user_row.id
    );
  end if;

  if user_row.status <> 'pending_deletion' then
    return jsonb_build_object(
      'ok', true,
      'changed', false,
      'reason', 'not_pending_deletion',
      'status', user_row.status,
      'user_id', user_row.id
    );
  end if;

  if user_row.deletion_scheduled_for is null
    or user_row.deletion_scheduled_for > finalization_time
  then
    return jsonb_build_object(
      'ok', true,
      'changed', false,
      'reason', 'not_due',
      'scheduled_for', user_row.deletion_scheduled_for,
      'user_id', user_row.id
    );
  end if;

  unresolved_salon_count :=
    public.account_deletion_unresolved_owned_salon_count(user_row.id);

  if unresolved_salon_count > 0 then
    update public.users
    set deletion_finalization_attempts = deletion_finalization_attempts + 1,
        deletion_finalization_failed_at = finalization_time,
        deletion_finalization_error =
          'Ownership constraints unresolved for ' || unresolved_salon_count::text || ' salon(s).',
        updated_at = now()
    where id = user_row.id;

    insert into public.account_lifecycle_events (
      user_id,
      actor_user_id,
      event_type,
      metadata
    )
    values (
      user_row.id,
      null,
      'account_deletion_failed',
      jsonb_build_object(
        'failed_at', finalization_time,
        'reason', 'ownership_unresolved',
        'unresolved_salon_count', unresolved_salon_count
      )
    );

    return jsonb_build_object(
      'ok', false,
      'changed', false,
      'reason', 'ownership_unresolved',
      'unresolved_salon_count', unresolved_salon_count,
      'user_id', user_row.id
    );
  end if;

  select exists (
    select 1
    from public.account_lifecycle_events events
    where events.user_id = user_row.id
      and events.event_type = 'account_deletion_finalization_started'
  )
  into existing_started_event;

  update public.users
  set deletion_finalization_started_at = coalesce(
        deletion_finalization_started_at,
        finalization_time
      ),
      deletion_finalization_attempts = deletion_finalization_attempts + 1,
      deletion_finalization_failed_at = null,
      deletion_finalization_error = null,
      updated_at = now()
  where id = user_row.id;

  if not existing_started_event then
    insert into public.account_lifecycle_events (
      user_id,
      actor_user_id,
      event_type,
      metadata
    )
    values (
      user_row.id,
      null,
      'account_deletion_finalization_started',
      jsonb_build_object(
        'started_at', finalization_time,
        'scheduled_for', user_row.deletion_scheduled_for
      )
    );
  end if;

  perform set_config('reylumi.account_erasure_user',user_row.id::text,true);
  perform public.prepare_account_erasure(user_row.id,user_row.auth_user_id,user_row.email);
  perform public.erase_account_personal_content(user_row.id,user_row.auth_user_id);

  if user_row.auth_user_id is not null then
    insert into public.deleted_auth_identities (
      auth_user_id,
      user_id,
      deleted_at,
      metadata
    )
    values (
      user_row.auth_user_id,
      user_row.id,
      finalization_time,
      jsonb_build_object('source', 'account_deletion_finalizer')
    )
    on conflict (auth_user_id) do update
    set user_id = excluded.user_id,
        deleted_at = coalesce(public.deleted_auth_identities.deleted_at, excluded.deleted_at),
        metadata = public.deleted_auth_identities.metadata || excluded.metadata;
  end if;

  update public.account_memberships
  set status = 'removed',
      updated_at = now()
  where user_id = user_row.id
    and status = 'active';

  update public.salon_memberships
  set status = 'removed',
      updated_at = now()
  where user_id = user_row.id
    and status = 'active';

  update public.staff
  set account_user_id = null,
      user_id = null,
      public_bio = null,
      public_profile_photo_path = null,
      public_profile_visible = false,
      owner_public_enabled = false,
      salon_profile_content_posting_enabled = false,
      staff_public_consent_status = 'not_requested',
      updated_at = now()
  where account_user_id = user_row.id
     or user_id = user_row.auth_user_id;

  delete from public.salon_profile_look_saves
  where user_id = user_row.id;

  delete from public.salon_profile_follows
  where user_id = user_row.id;

  delete from public.account_favorite_customers
  where user_id = user_row.id;

  update public.beauty_profiles
  set bio = null,
      cover_media_path = null,
      visibility = 'self',
      updated_at = now()
  where user_id = user_row.id;

  update public.beauty_posts
  set visibility = 'self',
      updated_at = now()
  where author_user_id = user_row.id;

  delete from public.beauty_profile_follows
  where user_id = user_row.id
     or profile_id in (
       select id
       from public.beauty_profiles
       where user_id = user_row.id
     );

  delete from public.account_post_saves
  where user_id = user_row.id;

  delete from public.app_notifications
  where recipient_user_id = user_row.id;

  update public.salon_profile_comments
  set author_display_name = case
        when author_user_id = user_row.id then 'Deleted user'
        else author_display_name
      end,
      updated_at = now()
  where author_user_id = user_row.id;

  update public.users
  set auth_user_id = null,
      email = null,
      phone = null,
      first_name = null,
      last_name = null,
      display_name = 'Deleted user',
      avatar_url = null,
      status = 'deleted',
      deleted_at = coalesce(deleted_at, finalization_time),
      anonymized_at = coalesce(anonymized_at, finalization_time),
      deletion_finalized_at = null,
      deletion_finalization_failed_at = null,
      deletion_finalization_error = null,
      last_login_at = null,
      updated_at = now()
  where id = user_row.id
  returning * into user_row;

  insert into public.account_lifecycle_events (
    user_id,
    actor_user_id,
    event_type,
    metadata
  )
  select
    user_row.id,
    null,
    'account_anonymized',
    jsonb_build_object(
      'anonymized_at', user_row.anonymized_at,
      'auth_identity_disconnected', true
    )
  where not exists (
    select 1
    from public.account_lifecycle_events events
    where events.user_id = user_row.id
      and events.event_type = 'account_anonymized'
  );

  insert into public.account_lifecycle_events (
    user_id,
    actor_user_id,
    event_type,
    metadata
  )
  select
    user_row.id,
    null,
    'account_deletion_erasure_queued',
    jsonb_build_object(
      'queued_at', finalization_time,
      'deleted_at', user_row.deleted_at
    )
  where not exists (
    select 1
    from public.account_lifecycle_events events
    where events.user_id = user_row.id
      and events.event_type = 'account_deletion_erasure_queued'
  );

  perform set_config('reylumi.account_erasure_user','',true);
  return jsonb_build_object(
    'ok', true,
    'changed', true,
    'status', user_row.status,
    'deleted_at', user_row.deleted_at,
    'anonymized_at', user_row.anonymized_at,
    'user_id', user_row.id
  );
exception
  when others then
    update public.users
    set deletion_finalization_attempts = deletion_finalization_attempts + 1,
        deletion_finalization_failed_at = now(),
        deletion_finalization_error = sqlerrm,
        updated_at = now()
    where id = p_user_id;

    insert into public.account_lifecycle_events (
      user_id,
      actor_user_id,
      event_type,
      metadata
    )
    values (
      p_user_id,
      null,
      'account_deletion_failed',
      jsonb_build_object(
        'failed_at', now(),
        'reason', sqlerrm,
        'sqlstate', sqlstate
      )
    );

    return jsonb_build_object(
      'ok', false,
      'changed', false,
      'reason', sqlerrm,
      'sqlstate', sqlstate,
      'user_id', p_user_id
    );
end;
$$;
revoke all on function public.finalize_account_deletion(uuid) from public,anon,authenticated;
grant execute on function public.finalize_account_deletion(uuid) to service_role;
notify pgrst,'reload schema';
commit;
