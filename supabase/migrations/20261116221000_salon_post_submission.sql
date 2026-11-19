-- One transaction owns the social post, associated data, final publication and replay marker.
-- The publishing function is invoker-security so existing post/asset/hashtag RLS still applies.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table public.salon_post_submission_requests (
  request_id uuid not null,
  author_user_id uuid not null references public.users(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  kind text not null check (kind in ('look','update')),
  input_hash text not null check (input_hash ~ '^[a-f0-9]{64}$'),
  completed boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (author_user_id, request_id)
);
alter table public.salon_post_submission_requests enable row level security;
revoke all on public.salon_post_submission_requests from public, anon, authenticated;
grant select on public.salon_post_submission_requests to authenticated;
grant insert (request_id, author_user_id, salon_id, kind, input_hash) on public.salon_post_submission_requests to authenticated;
create policy salon_submission_own_read on public.salon_post_submission_requests for select to authenticated
using (author_user_id = public.current_public_user_id());
create policy salon_submission_own_insert on public.salon_post_submission_requests for insert to authenticated
with check (author_user_id = public.current_public_user_id() and (
  public.user_has_salon_permission(salon_id, array['salon_profile.manage','salon_profile.content.manage'])
  or public.current_user_can_post_salon_content(salon_id)
));

create function public.lookup_salon_post_submission(p_request_id uuid, p_request jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare r public.salon_post_submission_requests; result_row jsonb;
begin
  select * into r from public.salon_post_submission_requests where author_user_id=public.current_public_user_id() and request_id=p_request_id;
  if r.request_id is null then return null; end if;
  if r.input_hash is distinct from encode(extensions.digest(p_request::text,'sha256'),'hex') then raise exception 'This request belongs to a different draft.'; end if;
  if not (public.user_has_salon_permission(r.salon_id,array['salon_profile.manage','salon_profile.content.manage']) or public.current_user_can_post_salon_content(r.salon_id)) then raise exception 'You no longer have permission to post for this salon.'; end if;
  if not r.completed then return null; end if;
  if r.kind='look' then select to_jsonb(t) into result_row from public.salon_profile_looks t where id=p_request_id and salon_id=r.salon_id and author_user_id=r.author_user_id;
  else select to_jsonb(t) into result_row from public.salon_profile_updates t where id=p_request_id and salon_id=r.salon_id and author_user_id=r.author_user_id; end if;
  if result_row is null or result_row->>'status'<>'published' or (result_row->>'safety_hold')::boolean then raise exception 'This post was already processed and is no longer published. Refresh your feed.'; end if;
  return jsonb_build_object('kind',r.kind,'row',result_row);
end; $$;
revoke all on function public.lookup_salon_post_submission(uuid,jsonb) from public,anon;
grant execute on function public.lookup_salon_post_submission(uuid,jsonb) to authenticated;

-- Callers cannot set completed directly. A completion always refers to an actual own published row.
create function public.finish_salon_post_submission(p_request_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.salon_post_submission_requests; actor uuid := public.current_public_user_id();
begin
  if auth.role() <> 'authenticated' or actor is null then raise exception 'Sign in before posting.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text || ':' || p_request_id::text, 162210));
  select * into r from public.salon_post_submission_requests where author_user_id=actor and request_id=p_request_id;
  if r.request_id is null then raise exception 'Post request was not found.'; end if;
  if r.kind='look' then
    if not exists(select 1 from public.salon_profile_looks where id=p_request_id and salon_id=r.salon_id and author_user_id=actor and status='published' and not safety_hold) then
      raise exception 'Published post could not be verified.';
    end if;
  else
    if not exists(select 1 from public.salon_profile_updates where id=p_request_id and salon_id=r.salon_id and author_user_id=actor and status='published' and not safety_hold) then
      raise exception 'Published post could not be verified.';
    end if;
  end if;
  update public.salon_post_submission_requests set completed=true where author_user_id=actor and request_id=p_request_id;
end; $$;
revoke all on function public.finish_salon_post_submission(uuid) from public, anon;
grant execute on function public.finish_salon_post_submission(uuid) to authenticated;

create function public.publish_salon_post_once(
  p_request_id uuid, p_request jsonb, p_kind text, p_row jsonb,
  p_hashtags text[] default '{}', p_booking jsonb default '{}'
) returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  actor uuid := public.current_public_user_id();
  target_salon uuid := (p_row->>'salon_id')::uuid;
  fingerprint text := encode(extensions.digest(p_request::text,'sha256'),'hex');
  previous public.salon_post_submission_requests;
  result_row jsonb; tag_value text; tag_id uuid;
begin
  if auth.role() <> 'authenticated' or actor is null or p_request_id is null or p_kind not in ('look','update')
    or jsonb_typeof(p_request) <> 'object' or jsonb_typeof(p_row) <> 'object'
    or target_salon is null or (p_row->>'author_user_id')::uuid is distinct from actor
    or (p_row->>'created_by_user_id')::uuid is distinct from actor then raise exception 'Post request is not valid.'; end if;
  if not (public.user_has_salon_permission(target_salon, array['salon_profile.manage','salon_profile.content.manage'])
    or public.current_user_can_post_salon_content(target_salon)) then raise exception 'You do not have permission to post for this salon.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text || ':' || p_request_id::text,162210));
  insert into public.salon_post_submission_requests(request_id,author_user_id,salon_id,kind,input_hash)
    values(p_request_id,actor,target_salon,p_kind,fingerprint) on conflict do nothing;
  select * into previous from public.salon_post_submission_requests where author_user_id=actor and request_id=p_request_id;
  if previous.input_hash is distinct from fingerprint or previous.salon_id is distinct from target_salon or previous.kind is distinct from p_kind then
    raise exception 'This request belongs to a different draft. Reopen your draft before posting.';
  end if;
  if previous.completed then
    if p_kind='look' then select to_jsonb(t) into result_row from public.salon_profile_looks t where id=p_request_id and salon_id=target_salon and author_user_id=actor;
    else select to_jsonb(t) into result_row from public.salon_profile_updates t where id=p_request_id and salon_id=target_salon and author_user_id=actor; end if;
    if result_row is null or result_row->>'status' <> 'published' or (result_row->>'safety_hold')::boolean then raise exception 'This post was already processed and is no longer published. Refresh your feed.'; end if;
    return result_row; -- Never restore a deleted/archived/moderated row.
  end if;

  if p_kind='look' then
    insert into public.salon_profile_looks(id,salon_id,author_user_id,created_by_user_id,author_avatar_path,author_display_name,author_staff_id,
      badge,booking_note,caption,duration_minutes,emotional_description,is_pinned,media_path,mood,palette,recommended_staff_id,service_id,starting_price,title,why_love_it,status)
    select p_request_id,target_salon,actor,actor,r.author_avatar_path,r.author_display_name,r.author_staff_id,
      r.badge,r.booking_note,r.caption,r.duration_minutes,r.emotional_description,false,r.media_path,r.mood,r.palette,r.recommended_staff_id,r.service_id,r.starting_price,r.title,r.why_love_it,'draft'
      from jsonb_populate_record(null::public.salon_profile_looks,p_row) r;
  else
    insert into public.salon_profile_updates(id,salon_id,author_user_id,created_by_user_id,author_avatar_path,author_display_name,author_staff_id,
      caption,cta_label,media_path,service_id,staff_id,starts_at,summary,title,update_type,status)
    select p_request_id,target_salon,actor,actor,r.author_avatar_path,r.author_display_name,r.author_staff_id,
      r.caption,r.cta_label,r.media_path,r.service_id,r.staff_id,r.starts_at,r.summary,r.title,r.update_type,'draft'
      from jsonb_populate_record(null::public.salon_profile_updates,p_row) r;
  end if;
  if p_row->>'media_path' is not null then
    update public.salon_profile_media_assets set attached_at=now(),attached_entity_id=p_request_id,attached_entity_type=p_kind,
      orphaned_at=null,status='active' where bucket='salon-profile-media' and object_path=p_row->>'media_path' and salon_id=target_salon;
    if not found then raise exception 'Uploaded photo registration could not be attached.'; end if;
  end if;
  foreach tag_value in array p_hashtags loop
    insert into public.salon_profile_hashtags(tag) values(tag_value) on conflict(tag) do update set tag=excluded.tag returning id into tag_id;
    if p_kind='look' then insert into public.salon_profile_look_hashtags(salon_id,look_id,hashtag_id) values(target_salon,p_request_id,tag_id);
    else insert into public.salon_profile_update_hashtags(salon_id,update_id,hashtag_id) values(target_salon,p_request_id,tag_id); end if;
  end loop;
  perform public.save_salon_profile_content_booking_config(
    p_source_type => case p_kind when 'look' then 'salon_profile_look' else 'salon_profile_update' end,
    p_content_id => p_request_id,
    p_booking_cta_enabled => coalesce((p_booking->>'bookingCtaEnabled')::boolean,true),
    p_primary_service_id => (p_booking->>'primaryServiceId')::uuid,
    p_credited_staff_id => (p_booking->>'creditedStaffId')::uuid,
    p_additional_service_ids => array(select jsonb_array_elements_text(coalesce(p_booking->'additionalServiceIds','[]'))::uuid),
    p_booking_note => p_booking->>'bookingNote'
  );
  if p_kind='look' then
    update public.salon_profile_looks set status='published',published_at=now() where id=p_request_id and author_user_id=actor and not safety_hold returning to_jsonb(salon_profile_looks.*) into result_row;
  else
    update public.salon_profile_updates set status='published',published_at=now() where id=p_request_id and author_user_id=actor and not safety_hold returning to_jsonb(salon_profile_updates.*) into result_row;
  end if;
  if result_row is null or (result_row->>'safety_hold')::boolean then raise exception 'Post publication could not be confirmed under current posting restrictions.'; end if;
  perform public.finish_salon_post_submission(p_request_id);
  return result_row;
end; $$;
revoke all on function public.publish_salon_post_once(uuid,jsonb,text,jsonb,text[],jsonb) from public, anon;
grant execute on function public.publish_salon_post_once(uuid,jsonb,text,jsonb,text[],jsonb) to authenticated;

-- Receipts contain only a request fingerprint, but remain account-linked personal metadata.
do $erase$
declare definition text; marker text := 'perform public.erase_tax_personal_profile(p_user_id);';
begin
  definition := pg_get_functiondef('public.erase_account_personal_content(uuid,uuid)'::regprocedure);
  if strpos(definition,'public.salon_post_submission_requests')=0 then
    if strpos(definition,marker)=0 then raise exception 'Account erasure changed; review Salon request metadata cleanup.'; end if;
    execute replace(definition,marker,marker || E'\n delete from public.salon_post_submission_requests where author_user_id=p_user_id;');
  end if;
end $erase$;
commit;
