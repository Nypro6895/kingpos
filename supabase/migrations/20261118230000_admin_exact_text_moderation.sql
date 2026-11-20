-- Case-authorized exact text decisions are independent of Support and business
-- workflow state. Holds never modify sentiment, receipts, payroll or Truth facts.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create schema if not exists moderation_public;
revoke all on schema moderation_public from public,anon,authenticated,service_role;
create table if not exists public.admin_text_case_bindings(
 report_id uuid primary key,context_hash text not null,
 kind text not null check(kind in('comment','review','experience','review_reply','experience_reply')),
 content_id uuid not null,parent_id uuid,salon_id uuid,created_at timestamptz not null default now()
);
create table if not exists public.admin_text_case_holds(
 report_id uuid primary key references public.admin_text_case_bindings(report_id),
 kind text not null,content_id uuid not null,active boolean not null,
 revision integer not null check(revision>0),updated_at timestamptz not null default now()
);
create index if not exists admin_text_active_target on public.admin_text_case_holds(kind,content_id) where active;
create table if not exists public.admin_text_decisions(
 id uuid primary key default gen_random_uuid(),report_id uuid not null,request_id uuid not null,
 actor_user_id uuid not null,action text not null check(action in('hide','restore')),
 reason text not null check(length(btrim(reason)) between 3 and 2000),
 payload_hash text not null,evidence_version text not null,kind text not null,content_id uuid not null,
 revision integer not null,created_at timestamptz not null default now(),unique(actor_user_id,request_id)
);
create index if not exists admin_text_case_history on public.admin_text_decisions(report_id,created_at,id);
alter table public.admin_text_case_bindings enable row level security;
alter table public.admin_text_case_holds enable row level security;
alter table public.admin_text_decisions enable row level security;
revoke all on public.admin_text_case_bindings,public.admin_text_case_holds,public.admin_text_decisions from public,anon,authenticated,service_role;

create or replace function public.admin_text_digest(value text) returns text
language sql immutable set search_path=pg_catalog,extensions as $$select encode(extensions.digest(value,'sha256'),'hex')$$;
create or replace function public.admin_text_immutable_decision() returns trigger
language plpgsql set search_path=pg_catalog as $$begin raise exception 'Content decision history is immutable.' using errcode='42501';end $$;
drop trigger if exists admin_text_history_immutable on public.admin_text_decisions;
create trigger admin_text_history_immutable before update or delete on public.admin_text_decisions for each row execute function public.admin_text_immutable_decision();

create or replace function public.exact_text_public(p_kind text,p_target uuid) returns boolean
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare parent uuid;
begin
 if exists(select 1 from public.admin_text_case_holds h where h.kind=p_kind and h.content_id=p_target and h.active) then return false;end if;
 if p_kind='comment' then
  -- A platform-held root/ancestor also removes descendants from every public
  -- projection/count, even while the original status stays published.
  return not exists(with recursive ancestors as(
   select c.id,c.parent_comment_id,c.status,c.author_user_id,array[c.id] seen,0 depth from public.salon_profile_comments c where c.id=p_target
   union all select p.id,p.parent_comment_id,p.status,p.author_user_id,a.seen||p.id,a.depth+1 from ancestors a join public.salon_profile_comments p on p.id=a.parent_comment_id
    where a.depth<8 and not p.id=any(a.seen)
  ) select 1 from ancestors a where exists(select 1 from public.admin_text_case_holds h where h.kind='comment' and h.content_id=a.id and h.active)
    or (a.depth>0 and (a.status not in('published','visible') or public.social_users_blocked(public.current_public_user_id(),a.author_user_id)))
    or (a.parent_comment_id is not null and (a.depth>=8 or a.parent_comment_id=any(a.seen))));
 elsif p_kind='review_reply' then
  select review_id into parent from public.salon_profile_review_replies where id=p_target;
  return not exists(select 1 from public.admin_text_case_holds where kind='review' and content_id=parent and active);
 elsif p_kind='experience_reply' then
  select experience_id into parent from public.visit_experience_replies where id=p_target;
  return not exists(select 1 from public.admin_text_case_holds where kind='experience' and content_id=parent and active);
 end if;
 return true;
end $$;
revoke all on function public.exact_text_public(text,uuid) from public;
grant execute on function public.exact_text_public(text,uuid) to anon,authenticated,service_role;

create or replace view moderation_public.salon_profile_comments with(security_barrier=true) as select * from public.salon_profile_comments c where public.exact_text_public('comment',c.id);
create or replace view moderation_public.salon_profile_reviews with(security_barrier=true) as select * from public.salon_profile_reviews r where public.exact_text_public('review',r.id);
create or replace view moderation_public.salon_profile_review_replies with(security_barrier=true) as select * from public.salon_profile_review_replies r where public.exact_text_public('review_reply',r.id);
create or replace view moderation_public.customer_visit_experiences with(security_barrier=true) as select * from public.customer_visit_experiences e where public.exact_text_public('experience',e.id);
create or replace view moderation_public.visit_experience_replies with(security_barrier=true) as select * from public.visit_experience_replies r where public.exact_text_public('experience_reply',r.id);
revoke all on all tables in schema moderation_public from public,anon,authenticated,service_role;

-- Restrictive SELECT policy closes direct public-table reads without taking
-- away authorized own/history/business journeys. Existing policies still have
-- to admit the row; this policy grants nothing by itself.
do $$ declare t text;k text;begin
 for t,k in select * from(values('salon_profile_comments','comment'),('salon_profile_reviews','review'),('salon_profile_review_replies','review_reply'),('customer_visit_experiences','experience'),('visit_experience_replies','experience_reply')) x(t,k) loop
  execute format('drop policy if exists platform_exact_text_visibility on public.%I',t);
  execute format('create policy platform_exact_text_visibility on public.%I as restrictive for select to anon,authenticated using(public.exact_text_public(%L,id) or author_user_id=public.current_public_user_id())',t,k);
 end loop;
end $$;

-- Reviewed typed allowlist, obtained from the fully compiled source inventory.
-- No private/history/POS/Truth routine is automatically rewritten by a scan.
do $route$ declare signature text;fn regprocedure;definition text;body text;changed text;t text;start_at integer;
begin
 foreach signature in array array[
  'public.count_public_post_comments(text,uuid)',
  'public.get_post_comment_identities(uuid[])',
  'public.get_public_post_comments(text,uuid,integer,integer)',
  'public.get_public_salon_profile_comments_before_blocks(uuid)',
  'public.get_public_salon_profile_experiences_before_blocks(uuid)',
  'public.get_public_salon_profile_reviews_before_blocks(uuid)',
  'public.get_public_salon_profile_review_summary(uuid)',
  'public.get_public_salon_website_featured_look(uuid)',
  'public.hydrate_explore_social_feed_items_before_blocks(text,jsonb,text[])',
  'public._explore_core_get_public_explore_decision_signals(uuid[])'
 ] loop
  fn:=to_regprocedure(signature);if fn is null then raise exception 'Review missing exact-text public projection: %',signature;end if;
  definition:=pg_get_functiondef(fn);start_at:=strpos(definition,'AS $function$');
  if start_at=0 then raise exception 'Review public projection delimiter: %',signature;end if;
  body:=substr(definition,start_at);changed:=body;
  if strpos(body,'moderation_public.')>0 then continue;end if;
  foreach t in array array['salon_profile_comments','salon_profile_reviews','salon_profile_review_replies','customer_visit_experiences','visit_experience_replies'] loop
   changed:=replace(changed,'public.'||t,'moderation_public.'||t);
   changed:=regexp_replace(changed,'(^|[^[:alnum:]_.])'||t||'([^[:alnum:]_]|$)','\1moderation_public.'||t||'\2','g');
  end loop;
  if changed=body and strpos(body,'moderation_public.')=0 then raise exception 'Review unrouted public projection: %',signature;end if;
  if changed<>body then execute substr(definition,1,start_at-1)||changed;end if;
 end loop;
end $route$;

-- This one legacy summary was SECURITY INVOKER. Do not grant callers access
-- to private views to make it work: retain a narrow public-only definer gate.
create or replace function public.get_public_salon_profile_review_summary(target_salon_id uuid)
returns table(average_rating numeric,rating_1_count bigint,rating_2_count bigint,rating_3_count bigint,rating_4_count bigint,rating_5_count bigint,review_count bigint,verified_count bigint)
language sql stable security definer set search_path=pg_catalog,public as $$
 select avg(r.rating)::numeric,count(*) filter(where r.rating=1),count(*) filter(where r.rating=2),count(*) filter(where r.rating=3),count(*) filter(where r.rating=4),count(*) filter(where r.rating=5),count(*),count(*) filter(where r.verification_status='verified')
 from moderation_public.salon_profile_reviews r where r.salon_id=target_salon_id and r.moderation_status='visible'
  and public.salon_profile_public_salon_exists(target_salon_id)
  and not public.social_users_blocked(public.current_public_user_id(),r.author_user_id)
$$;

create or replace function public.admin_text_source(kind text,target uuid) returns jsonb
language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare item jsonb;
begin
 case kind
 when 'comment' then select to_jsonb(c) into item from public.salon_profile_comments c where id=target;
 when 'review' then select to_jsonb(c) into item from public.salon_profile_reviews c where id=target;
 when 'review_reply' then select to_jsonb(c) into item from public.salon_profile_review_replies c where id=target;
 when 'experience' then select to_jsonb(c) into item from public.customer_visit_experiences c where id=target;
 when 'experience_reply' then select to_jsonb(c) into item from public.visit_experience_replies c where id=target;
 else return null;end case;
 return item;
end $$;

create or replace function public.admin_text_context_hash(r public.platform_reports) returns text
language sql immutable set search_path=pg_catalog,public as $$
 select public.admin_text_digest(jsonb_build_array(r.source,r.reporter_user_id,r.created_by_user_id,r.support_context)::text)
$$;

create or replace function public.admin_text_parent_public(p_kind text,p_target uuid) returns boolean
language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare item jsonb;parent jsonb;s uuid;
begin
 item:=public.admin_text_source(p_kind,p_target);if item is null then return false;end if;
 if public.social_users_blocked(public.current_public_user_id(),(item->>'author_user_id')::uuid) then return false;end if;
 if p_kind='comment' then
  if not public.post_comment_target_is_public((item->>'look_id')::uuid,(item->>'update_id')::uuid,(item->>'beauty_post_id')::uuid,(item->>'salon_id')::uuid) then return false;end if;
  return not exists(with recursive parents as(
   select c.id,c.parent_comment_id,c.status,c.author_user_id,array[c.id] seen,0 depth from public.salon_profile_comments c where c.id=(item->>'parent_comment_id')::uuid
   union all select p.id,p.parent_comment_id,p.status,p.author_user_id,a.seen||p.id,a.depth+1 from parents a join public.salon_profile_comments p on p.id=a.parent_comment_id where a.depth<8 and not p.id=any(a.seen)
  ) select 1 from parents p where p.status not in('published','visible') or public.social_users_blocked(public.current_public_user_id(),p.author_user_id)
   or exists(select 1 from public.admin_text_case_holds h where h.kind='comment' and h.content_id=p.id and h.active)
   or (p.parent_comment_id is not null and (p.depth>=8 or p.parent_comment_id=any(p.seen))));
 elsif p_kind='review_reply' then
  parent:=public.admin_text_source('review',(item->>'review_id')::uuid);
  if parent is null or parent->>'moderation_status'<>'visible' or not public.exact_text_public('review',(item->>'review_id')::uuid) then return false;end if;
 elsif p_kind='experience_reply' then
  parent:=public.admin_text_source('experience',(item->>'experience_id')::uuid);
  if parent is null or not public.exact_text_public('experience',(item->>'experience_id')::uuid) then return false;end if;
 end if;
 if parent is not null and public.social_users_blocked(public.current_public_user_id(),(parent->>'author_user_id')::uuid) then return false;end if;
 s:=coalesce((item->>'salon_id')::uuid,(parent->>'salon_id')::uuid);
 return s is not null and public.salon_profile_public_salon_exists(s);
end $$;

create or replace function public.admin_text_private_reader(p_kind text,p_target uuid) returns boolean
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.current_public_user_id();item jsonb;parent jsonb;s uuid;
begin
 if actor is null then return false;end if;
 item:=public.admin_text_source(p_kind,p_target);if item is null then return false;end if;
 if (item->>'author_user_id')::uuid=actor then return true;end if;
 if p_kind='review_reply' then parent:=public.admin_text_source('review',(item->>'review_id')::uuid);
 elsif p_kind='experience_reply' then parent:=public.admin_text_source('experience',(item->>'experience_id')::uuid);end if;
 if (parent->>'author_user_id')::uuid=actor then return true;end if;
 s:=coalesce((item->>'salon_id')::uuid,(parent->>'salon_id')::uuid);
 return s is not null and public.user_has_salon_permission(s,array['salon_profile.view','salon_profile.manage','salon_profile.content.manage','tickets.view','tickets.manage']);
end $$;
revoke all on function public.admin_text_private_reader(text,uuid) from public;
grant execute on function public.admin_text_private_reader(text,uuid) to anon,authenticated;
do $$ declare t text;k text;begin
 for t,k in select * from(values('salon_profile_comments','comment'),('salon_profile_reviews','review'),('salon_profile_review_replies','review_reply'),('customer_visit_experiences','experience'),('visit_experience_replies','experience_reply'))x(t,k) loop
  execute format('drop policy platform_exact_text_visibility on public.%I',t);
  execute format('create policy platform_exact_text_visibility on public.%I as restrictive for select to anon,authenticated using(public.exact_text_public(%L,id) or public.admin_text_private_reader(%L,id))',t,k,k);
 end loop;
end $$;

create or replace function public.get_admin_exact_text_moderation(p_report_id uuid) returns jsonb
language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare r public.platform_reports;b public.admin_text_case_bindings;existing jsonb;original jsonb;item jsonb;history jsonb;held boolean;others integer;rev integer;version text;can_write boolean;parent_ok boolean;canonical text;author_active boolean;
 base jsonb:=jsonb_build_object('status','unavailable','kind',null,'contentId',null,'parentId',null,'salonId',null,'body',null,'evidenceVersion',null,'revision',0,'moderationStatus','unavailable','canHide',false,'canRestore',false,'blockedReason','The reported text is unavailable or no longer eligible.','availabilityVerified',true,'history','[]'::jsonb);
begin
 perform public.platform_admin_require_permission('admin.reports.read');
 perform public.get_platform_admin_report_detail(p_report_id);
 select * into r from public.platform_reports where id=p_report_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'action',d.action,'reason',d.reason,'actorName',u.display_name,'createdAt',d.created_at,'revision',d.revision) order by d.created_at desc,d.id desc),'[]') into history
 from (select * from public.admin_text_decisions where report_id=p_report_id order by created_at desc,id desc limit 50)d left join public.users u on u.id=d.actor_user_id;
 base:=base||jsonb_build_object('history',history);
 -- Preserve the existing canonical public eligibility and reporter-owned
 -- private-history alias checks. Client-chosen support_context is not access.
 select public.get_admin_social_report_evidence(p_report_id) into original;
 if original is null or original->>'status'<>'available' then return base;end if;
 select * into b from public.admin_text_case_bindings where report_id=p_report_id;
 if not found then
  -- A client may choose support_context. A new unbound public report cannot
  -- turn an already platform-hidden ID into permission to read its body.
  canonical:=case original->>'kind' when 'own_review_reply' then 'review_reply' when 'own_experience_reply' then 'experience_reply' else original->>'kind' end;
  if original->>'kind' not in('own_review_reply','own_experience_reply') and (not public.exact_text_public(canonical,(original->>'contentId')::uuid) or not public.admin_text_parent_public(canonical,(original->>'contentId')::uuid)) then return base;end if;
  insert into public.admin_text_case_bindings(report_id,context_hash,kind,content_id,parent_id,salon_id)
  values(p_report_id,public.admin_text_context_hash(r),case original->>'kind' when 'own_review_reply' then 'review_reply' when 'own_experience_reply' then 'experience_reply' else original->>'kind' end,
   (original->>'contentId')::uuid,(original->>'parentId')::uuid,(original->>'salonId')::uuid) on conflict do nothing;
  select * into b from public.admin_text_case_bindings where report_id=p_report_id;
 end if;
 if b.context_hash is distinct from public.admin_text_context_hash(r) or b.content_id is distinct from (original->>'contentId')::uuid
  or b.parent_id is distinct from (original->>'parentId')::uuid or b.salon_id is distinct from (original->>'salonId')::uuid then return base;end if;
 -- Freeze source/parent/context before pairing its quote with a fingerprint.
 -- Otherwise an author edit between the eligibility read and source hashing
 -- could pair old displayed text with a new revision's authorization token.
 perform public.lock_admin_exact_text_target(b.kind,b.content_id,r.reporter_user_id);
 perform 1 from public.platform_reports where id=p_report_id for share nowait;
 select * into r from public.platform_reports where id=p_report_id;
 select public.get_admin_social_report_evidence(p_report_id) into original;
 if original is null or original->>'status'<>'available' or b.context_hash is distinct from public.admin_text_context_hash(r)
  or b.content_id is distinct from (original->>'contentId')::uuid or b.parent_id is distinct from (original->>'parentId')::uuid
  or b.salon_id is distinct from (original->>'salonId')::uuid then return base;end if;
 item:=public.admin_text_source(b.kind,b.content_id);if item is null then return base;end if;
 parent_ok:=public.admin_text_parent_public(b.kind,b.content_id);
 author_active:=exists(select 1 from public.users where id=(item->>'author_user_id')::uuid and status='active');
 select coalesce(bool_or(active) filter(where report_id=p_report_id),false),count(*) filter(where active and report_id<>p_report_id),coalesce(sum(revision),0)
 into held,others,rev from public.admin_text_case_holds where kind=b.kind and content_id=b.content_id;
 select coalesce(jsonb_agg(to_jsonb(h) order by h.report_id),'[]') into existing from public.admin_text_case_holds h where kind=b.kind and content_id=b.content_id;
 version:=public.admin_text_digest(jsonb_build_array(b.context_hash,b.kind,b.content_id,item,existing,parent_ok,author_active)::text);
 can_write:=public.platform_admin_has_permission('admin.reports.update');
 return base||jsonb_build_object('status','available','kind',b.kind,'contentId',b.content_id,'parentId',b.parent_id,'salonId',b.salon_id,'body',original->'body',
  'evidenceVersion',version,'revision',rev,'moderationStatus',case when public.exact_text_public(b.kind,b.content_id) then 'visible' else 'hidden' end,
  'canHide',can_write and not held and parent_ok,'canRestore',can_write and held and parent_ok and author_active,'heldByThisCase',held,'otherHoldCount',others,
  'blockedReason',case when not parent_ok then 'The parent or salon is private, withdrawn, blocked or held. This authorized evidence is read-only.' when not author_active then 'The author account is restricted; restoration is unavailable.' when not can_write then 'Your role can view this evidence but cannot change content visibility.' when others>0 then 'Another case still holds this text. Releasing this case does not clear another case or parent restriction.' else null end);
exception when lock_not_available then
 return base||jsonb_build_object('availabilityVerified',false,'blockedReason','The text is changing. Refresh to verify the current evidence.');
end $$;

-- Acquire user locks first; every later row lock is NOWAIT to avoid inversion
-- against author edits, parent privacy changes and user-first erasure work.
create or replace function public.lock_admin_exact_text_target(kind text,target uuid,reporter uuid) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare item jsonb;u uuid;s uuid;p uuid;row_id uuid;
begin
 item:=public.admin_text_source(kind,target);if item is null then raise exception 'This text is unavailable.';end if;
 for u in select distinct x from unnest(array[public.current_public_user_id(),reporter,(item->>'author_user_id')::uuid])x where x is not null order by x loop
  perform 1 from public.users where id=u for share nowait;
 end loop;
 case kind
 when 'comment' then
  perform 1 from public.salon_profile_comments where id=target for share nowait;
  for row_id in select x from unnest(array[(item->>'parent_comment_id')::uuid,(item->>'root_comment_id')::uuid])x where x is not null order by x loop perform 1 from public.salon_profile_comments where id=row_id for share nowait;end loop;
  if item->>'beauty_post_id' is not null then
   p:=(item->>'beauty_post_id')::uuid;perform 1 from public.beauty_posts where id=p for share nowait;
   perform 1 from public.beauty_profiles where id=(select profile_id from public.beauty_posts where id=p) for share nowait;
  elsif item->>'look_id' is not null then perform 1 from public.salon_profile_looks where id=(item->>'look_id')::uuid for share nowait;
  else perform 1 from public.salon_profile_updates where id=(item->>'update_id')::uuid for share nowait;end if;
 when 'review' then perform 1 from public.salon_profile_reviews where id=target for share nowait;
 when 'review_reply' then
  perform 1 from public.salon_profile_review_replies where id=target for share nowait;
  perform 1 from public.salon_profile_reviews where id=(item->>'review_id')::uuid for share nowait;
  select salon_id into s from public.salon_profile_reviews where id=(item->>'review_id')::uuid;
 when 'experience' then perform 1 from public.customer_visit_experiences where id=target for share nowait;
 when 'experience_reply' then
  perform 1 from public.visit_experience_replies where id=target for share nowait;
  perform 1 from public.customer_visit_experiences where id=(item->>'experience_id')::uuid for share nowait;
  select salon_id into s from public.customer_visit_experiences where id=(item->>'experience_id')::uuid;
 end case;
 s:=coalesce(s,(item->>'salon_id')::uuid);
 if s is not null then perform 1 from public.locations where id=s for share nowait;perform 1 from public.salon_settings where salon_id=s for share nowait;end if;
end $$;

create or replace function public.set_admin_exact_text_visibility(p_report_id uuid,p_request_id uuid,p_expected_version text,p_action text,p_reason text)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.current_public_user_id();r public.platform_reports;b public.admin_text_case_bindings;receipt public.admin_text_decisions;
 state jsonb;payload text;rev integer;
begin
 if not coalesce(public.platform_admin_has_permission('admin.reports.read'),false) or not coalesce(public.platform_admin_has_permission('admin.reports.update'),false) then
  raise exception 'Permission denied.' using errcode='42501';end if;
 perform public.platform_admin_require_permission('admin.reports.read');
 perform public.platform_admin_require_permission('admin.reports.update');
 perform public.get_platform_admin_report_detail(p_report_id);
 if actor is null or p_report_id is null or p_request_id is null or coalesce(p_expected_version,'') !~ '^[a-f0-9]{64}$'
  or p_action is null or p_action not in('hide','restore') or length(btrim(coalesce(p_reason,''))) not between 3 and 2000 then
  return jsonb_build_object('ok',false,'code','conflict','message','Invalid content decision. Use the current evidence and a reason.');end if;
 payload:=public.admin_text_digest(jsonb_build_array(p_report_id,p_expected_version,p_action,btrim(p_reason))::text);
 -- Same actor/request must settle before replay lookup. A timeout is unknown,
 -- never a definitive failure that would permit a new UUID duplicate.
 perform pg_advisory_xact_lock(hashtextextended('exact-text-request:'||actor::text||':'||p_request_id::text,0));
 select * into receipt from public.admin_text_decisions where actor_user_id=actor and request_id=p_request_id;
 if found then
  if receipt.payload_hash<>payload or receipt.report_id<>p_report_id then return jsonb_build_object('ok',false,'code','conflict','message','This request belongs to a different content decision. Refresh the case.');end if;
  return jsonb_build_object('ok',true,'state',public.get_admin_exact_text_moderation(p_report_id));
 end if;
 state:=public.get_admin_exact_text_moderation(p_report_id);
 if state->>'status'<>'available' then return jsonb_build_object('ok',false,'code',case when state->>'availabilityVerified'='false' then 'unknown' else 'unavailable' end,'message','The reported text could not be verified as eligible. Retry the same decision if its result is unconfirmed.','state',state);end if;
 select * into b from public.admin_text_case_bindings where report_id=p_report_id;
 select * into r from public.platform_reports where id=p_report_id;
 perform public.lock_admin_exact_text_target(b.kind,b.content_id,r.reporter_user_id);
 if not pg_try_advisory_xact_lock(hashtextextended('exact-text-target:'||b.kind||':'||b.content_id::text,0)) then
  return jsonb_build_object('ok',false,'code','stale','message','This text has another decision in progress. Refresh the case.');end if;
 perform 1 from public.platform_reports where id=p_report_id for share nowait;
 perform 1 from public.admin_text_case_bindings where report_id=p_report_id for update nowait;
 state:=public.get_admin_exact_text_moderation(p_report_id);
 if state->>'status'<>'available' then return jsonb_build_object('ok',false,'code',case when state->>'availabilityVerified'='false' then 'unknown' else 'unavailable' end,'message','The reported text could not be verified as eligible. Retry the same decision if its result is unconfirmed.','state',state);end if;
 if state->>'evidenceVersion'<>p_expected_version then return jsonb_build_object('ok',false,'code','stale','message','This text or its restrictions changed. Review the current evidence.','state',state);end if;
 if (p_action='hide' and not (state->>'canHide')::boolean) or (p_action='restore' and not (state->>'canRestore')::boolean) then
  return jsonb_build_object('ok',false,'code','conflict','message','This case cannot make that visibility change. Refresh the current evidence.','state',state);end if;
 insert into public.admin_text_case_holds(report_id,kind,content_id,active,revision) values(p_report_id,b.kind,b.content_id,p_action='hide',1)
 on conflict(report_id) do update set active=excluded.active,revision=public.admin_text_case_holds.revision+1,updated_at=clock_timestamp() returning revision into rev;
 insert into public.admin_text_decisions(report_id,request_id,actor_user_id,action,reason,payload_hash,evidence_version,kind,content_id,revision)
 values(p_report_id,p_request_id,actor,p_action,btrim(p_reason),payload,p_expected_version,b.kind,b.content_id,rev);
 return jsonb_build_object('ok',true,'state',public.get_admin_exact_text_moderation(p_report_id));
exception when lock_not_available then
 return jsonb_build_object('ok',false,'code','unknown','message','The decision could not be confirmed while this record is changing. Retry the same decision.');
end $$;

do $$ declare f regprocedure;begin
 foreach f in array array['public.admin_text_digest(text)'::regprocedure,'public.admin_text_immutable_decision()'::regprocedure,
 'public.admin_text_source(text,uuid)'::regprocedure,'public.admin_text_context_hash(public.platform_reports)'::regprocedure,
 'public.admin_text_parent_public(text,uuid)'::regprocedure,
 'public.get_admin_exact_text_moderation(uuid)'::regprocedure,'public.lock_admin_exact_text_target(text,uuid,uuid)'::regprocedure,
 'public.set_admin_exact_text_visibility(uuid,uuid,text,text,text)'::regprocedure] loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
 end loop;
end $$;
grant execute on function public.get_admin_exact_text_moderation(uuid),public.set_admin_exact_text_visibility(uuid,uuid,text,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
