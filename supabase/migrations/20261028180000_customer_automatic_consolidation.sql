begin;
-- Normalize canonically equivalent Vietnamese and other Unicode names identically.
create or replace function public.customer_name_key(value text) returns text
language sql immutable parallel safe set search_path=public as $$
 select regexp_replace(lower(btrim(normalize(coalesce(value,''), NFC))), '[^[:alnum:]]+', '', 'g')
$$;
reindex index public.customers_identity_name_idx;
create index if not exists customers_identity_email_idx
 on public.customers(location_id,lower(btrim(email)));
create or replace function public.customer_identity_auto_match(an text,ap text,ae text,bn text,bp text,be text)
returns boolean language sql immutable parallel safe set search_path=public as $$
 select coalesce(customer_name_key(an)<>'' and customer_name_key(bn)<>'' and (
 (normalize_customer_claim_phone(ap) is not null and normalize_customer_claim_phone(ap)=normalize_customer_claim_phone(bp)
 and customer_edit_distance(customer_name_key(an),customer_name_key(bn))<=2)
 or (nullif(lower(btrim(ae)),'') is not null and lower(btrim(ae))=lower(btrim(be)) and customer_name_key(an)=customer_name_key(bn))),false)
$$;
create or replace function public.customer_identity_candidates(p_salon uuid,p_name text,p_phone text,p_email text default null)
returns table(customer_id uuid,name_score numeric,phone_score numeric,score numeric,automatic boolean,reason text)
language sql stable security definer set search_path=public as $$
 with input as (select customer_name_key(left(p_name,100)) n,
 normalize_customer_claim_phone(p_phone) p,nullif(lower(btrim(p_email)),'') e),
 measured as (
 select c.id, c.created_at, i.n, i.p,
 customer_name_key(c.name) cn,normalize_customer_claim_phone(c.phone) cp,
 coalesce(i.e=lower(btrim(c.email)),false) email_equal,
 case when i.n='' then 0::numeric else 1-customer_edit_distance(i.n,customer_name_key(c.name))::numeric/
 greatest(length(i.n),length(customer_name_key(c.name)),1) end ns,
 case when i.p is null or normalize_customer_claim_phone(c.phone) is null then 0::numeric
 else 1-customer_edit_distance(i.p,normalize_customer_claim_phone(c.phone))::numeric/
 greatest(length(i.p),length(normalize_customer_claim_phone(c.phone)),1) end ps
 from customers c cross join input i where c.location_id=p_salon and c.status='active'
 and not customer_is_walking(c)
 ), qualified as (
 select *,coalesce(p=cp,false) exact_phone,
 ((coalesce(p=cp,false) and n<>'' and cn<>'' and customer_edit_distance(n,cn)<=2)
 or (email_equal and n<>'' and n=cn)) auto_match
 from measured where (p is not null and p=cp) or email_equal
 or (length(n)>=2 and ns>=0.5 and p is not null and cp is not null
     and length(p)=length(cp) and customer_edit_distance(p,cp)<=1)
 or (length(n)>=3 and n=cn)
 )
 select id,ns,ps,round((0.65*ps+0.35*ns)*100),auto_match,
 case when auto_match and not exact_phone then 'Same email, matching name'
 when auto_match then 'Same phone, matching name'
 when exact_phone then 'Same phone, different name'
 when email_equal then 'Same email'
 when p is not null and cp is not null and customer_edit_distance(p,cp)<=1 then 'Possible phone typo'
 else 'Same name; check phone' end
 from qualified order by auto_match desc,exact_phone desc,(0.65*ps+0.35*ns) desc,created_at,id limit 8
$$;
create or replace function public.merge_customer_records(p_salon uuid,p_target uuid,p_sources uuid[],p_reason text default 'manual')
returns jsonb language plpgsql security definer set search_path=public as $$
declare ids uuid[]; sources uuid[]; linked uuid[]; event uuid; merged_status text; actor uuid:=current_public_user_id();
begin
 select array_agg(distinct x order by x) into sources from unnest(p_sources) x where x<>p_target;
 if coalesce(cardinality(sources),0)=0 or cardinality(sources)>100 then raise exception 'Choose 1 to 100 source records'; end if;
 ids:=sources||p_target;
 perform pg_advisory_xact_lock(hashtextextended('customer-identity:'||p_salon::text,0));
 perform 1 from customers where id=any(ids) order by id for update;
 if (select count(*) from customers where id=any(ids) and location_id=p_salon)<>cardinality(ids)
 then raise exception 'Customer selection changed. Refresh and try again.'; end if;
 if actor is null or (not user_has_salon_permission(p_salon,array['customers.manage']) and
 exists(select 1 from customers where id=any(ids) and customer_user_id is distinct from actor))
 then raise exception 'Customer merge access required' using errcode='42501'; end if;
 if exists(select 1 from pg_constraint where contype='f' and confrelid='public.customers'::regclass
 and conrelid<>all(array['public.bookings'::regclass,'public.pos_tickets'::regclass,'public.pos_desk_sessions'::regclass,
 'public.customer_visits'::regclass,'public.customer_visit_experiences'::regclass,'public.beauty_post_verifications'::regclass,
 'public.account_favorite_customers'::regclass,'public.customer_account_claims'::regclass,'public.customer_claim_tokens'::regclass,
 'public.customer_merged_ids'::regclass])) then raise exception 'A new customer dependency needs review before merging'; end if;
 if exists(select 1 from customers c where id=any(ids) and customer_is_walking(c)) then
 raise exception 'Walking customers are already grouped in the directory'; end if;
 select array_agg(distinct customer_user_id) filter(where customer_user_id is not null) into linked from customers where id=any(ids);
 if coalesce(cardinality(linked),0)>1 then raise exception 'Different personal accounts cannot be merged'; end if;
 if (select count(distinct account_id) from (
  select customer_user_id account_id from customers where id=any(ids)
  union all select customer_user_id from bookings where customer_id=any(ids)
  union all select customer_user_id from customer_account_claims where customer_id=any(ids)
 ) ownership where account_id is not null)>1 then raise exception 'History is linked to different personal accounts'; end if;
 if (select count(*) from customer_visits where salon_id=p_salon and customer_id=any(ids) and status in ('waiting','in_service','checkout'))>1 then
 raise exception 'Finish or cancel the separate active visits before merging these profiles'; end if;
 if p_reason='automatic' and exists(select 1 from customers s cross join customers t
 where s.id=any(sources) and t.id=p_target and not customer_identity_auto_match(s.name,s.phone,s.email,t.name,t.phone,t.email)) then
 raise exception 'Review these records manually'; end if;
 -- Preserve audit evidence including rows which collide on claim/favorite uniqueness.
 insert into customer_merge_events(salon_id,target_id,source_ids,actor_id,reason,source_snapshot)
 values(p_salon,p_target,sources,actor,p_reason,jsonb_build_object(
  'customers',(select jsonb_agg(to_jsonb(c)) from customers c where id=any(ids)),
  'claims',(select jsonb_agg(to_jsonb(c)) from customer_account_claims c where customer_id=any(ids)),
  'favorites',(select jsonb_agg(to_jsonb(c)) from account_favorite_customers c where customer_id=any(ids)),
  'bookings',(select jsonb_agg(jsonb_build_object('id',id,'customer_id',customer_id)) from bookings where customer_id=any(sources)),
  'tickets',(select jsonb_agg(jsonb_build_object('id',id,'customer_id',customer_id)) from pos_tickets where customer_id=any(sources)),
  'sessions',(select jsonb_agg(jsonb_build_object('id',id,'customer_id',customer_id)) from pos_desk_sessions where customer_id=any(sources)),
  'visits',(select jsonb_agg(jsonb_build_object('id',id,'customer_id',customer_id)) from customer_visits where customer_id=any(sources)),
  'experiences',(select jsonb_agg(jsonb_build_object('id',id,'customer_id',customer_id)) from customer_visit_experiences where customer_id=any(sources)),
  'verifications',(select jsonb_agg(to_jsonb(v)) from beauty_post_verifications v where customer_id=any(sources)),
  'claim_tokens',(select jsonb_agg(jsonb_build_object('id',id,'customer_id',customer_id)) from customer_claim_tokens where customer_id=any(sources)))) returning id into event;
 select case when bool_or(status='active') then 'active' else 'inactive' end into merged_status from customers where id=any(ids);
 -- Relationship validation requires an active customer while visits are moved.
 -- Restore inactive when every selected profile was inactive, within this transaction.
 update customers c set customer_user_id=linked[1],status='active',
 phone=coalesce(c.phone,(select phone from customers where id=any(sources) and phone is not null order by created_at,id limit 1)),
 email=coalesce(c.email,(select email from customers where id=any(sources) and email is not null order by created_at,id limit 1)),
 notes=(select string_agg(distinct notes,E'\n\n') from customers where id=any(ids)),
 staff_notes=(select string_agg(distinct staff_notes,E'\n\n') from customers where id=any(ids)),
 internal_notes=(select string_agg(distinct internal_notes,E'\n\n') from customers where id=any(ids)),
 updated_by_user_id=actor where c.id=p_target;
 -- Preserve booking ownership; merging salon records does not newly grant access to bookings.
 update bookings set customer_id=p_target,updated_by_user_id=actor where salon_id=p_salon and customer_id=any(sources);
 update pos_tickets set customer_id=p_target where salon_id=p_salon and customer_id=any(sources);
 update pos_desk_sessions set customer_id=p_target where salon_id=p_salon and customer_id=any(sources);
 update customer_visits set customer_id=p_target where salon_id=p_salon and customer_id=any(sources);
 update customer_visit_experiences set customer_id=p_target where salon_id=p_salon and customer_id=any(sources);
 update beauty_post_verifications set customer_id=p_target where customer_id=any(sources);
 insert into account_favorite_customers(user_id,customer_id)
 select distinct user_id,p_target from account_favorite_customers where customer_id=any(sources)
 on conflict(user_id,customer_id) do nothing;
 delete from account_favorite_customers where customer_id=any(sources);
 delete from customer_account_claims c using customer_account_claims keep
 where c.customer_id=any(ids) and keep.customer_id=any(ids) and c.customer_user_id=keep.customer_user_id
 and c.claim_method=keep.claim_method and (case when c.customer_id=p_target then 0 else 1 end,c.id)>
 (case when keep.customer_id=p_target then 0 else 1 end,keep.id);
 update customer_account_claims set customer_id=p_target where customer_id=any(sources);
 update customer_claim_tokens set customer_id=p_target where customer_id=any(sources);
 -- Active customer-display JSON also references the salon customer.
 update pos_live_drafts set customer=jsonb_set(customer,'{id}',to_jsonb(p_target::text)),
 customer_version=customer_version+1,version=version+1
 where salon_id=p_salon and customer->>'id'=any(select unnest(sources)::text);
 update customer_merged_ids set target_id=p_target where target_id=any(sources);
 insert into customer_merged_ids(source_id,target_id,salon_id,event_id) select x,p_target,p_salon,event from unnest(sources) x;
 delete from customers where id=any(sources) and location_id=p_salon;
 update customers set status=merged_status where id=p_target;
 return jsonb_build_object('targetId',p_target,'merged',cardinality(sources),'eventId',event);
end $$;
create or replace function public.consolidate_customer_identities(p_salon uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare c record; sources uuid[]; safe uuid[]; plan jsonb; merged integer:=0;
begin
 if not user_has_salon_permission(p_salon,array['customers.manage']) then raise exception 'Customer management access required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('customer-identity:'||p_salon::text,0));
 for c in select * from customers where location_id=p_salon and status='active' and not customer_is_walking(customers)
 order by created_at,id loop
  if not exists(select 1 from customers where id=c.id) then continue; end if;
  select array_agg(s.id order by s.created_at,s.id) into sources from (
   select s.* from customers s where s.location_id=p_salon and s.id<>c.id and s.status='active'
   and ((normalize_customer_claim_phone(c.phone) is not null and normalize_customer_claim_phone(s.phone)=normalize_customer_claim_phone(c.phone))
    or (nullif(lower(btrim(c.email)),'') is not null and lower(btrim(s.email))=lower(btrim(c.email))))
   and customer_identity_auto_match(c.name,c.phone,c.email,s.name,s.phone,s.email)
   order by s.created_at,s.id limit greatest(0,100-merged)) s;
  if coalesce(cardinality(sources),0)=0 then continue; end if;
  perform 1 from customers where id=any(sources||c.id) order by id for update;
  plan:=customer_merge_plan_internal(p_salon,c.id,sources);
  select array_agg((item->>'id')::uuid) into safe from jsonb_array_elements(plan) item where item->>'blockedReason' is null;
  if coalesce(cardinality(safe),0)>0 then
   perform merge_customer_records(p_salon,c.id,safe,'automatic');
   merged:=merged+cardinality(safe);
  end if;
  if merged>=100 then exit; end if;
 end loop;
 return merged;
end $$;
create or replace function public.customer_duplicate_batch(p_salon uuid,p_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb:='{}'; c customers; candidates jsonb; plan jsonb;
begin
 if cardinality(p_ids)>25 or not user_has_salon_permission(p_salon,array['customers.view','customers.manage']) then
  raise exception 'Customer access required' using errcode='42501'; end if;
 for c in select * from customers where location_id=p_salon and id=any(p_ids) loop
  select coalesce(jsonb_agg(customer_directory_record(d)||jsonb_build_object('match',to_jsonb(m)-'ordinality') order by m.ordinality),'[]')
   into candidates from customer_identity_candidates(p_salon,c.name,c.phone,c.email) with ordinality m
   join customers d on d.id=m.customer_id where d.id<>c.id and (m.automatic or (normalize_customer_claim_phone(c.phone) is not null
 and normalize_customer_claim_phone(c.phone)=normalize_customer_claim_phone(d.phone)));
  if jsonb_array_length(candidates)>0 then
   plan:=customer_merge_plan_internal(p_salon,c.id,array(select (item->>'id')::uuid from jsonb_array_elements(candidates) item));
   select jsonb_agg(item||jsonb_build_object('mergeBlockedReason',p->'blockedReason') order by ordinal)
    into candidates from jsonb_array_elements(candidates) with ordinality a(item,ordinal)
    join jsonb_array_elements(plan) p on p->>'id'=item->>'id';
  end if;
  result:=result||jsonb_build_object(c.id,candidates);
 end loop;
 return result;
end $$;
commit;
