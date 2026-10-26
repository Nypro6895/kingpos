begin;

-- Matching contact information is a suggestion, not permission to combine accounts.
-- Compute the whole selection first so an unlinked target never picks an owner
-- merely because that owner's source happened to appear first in the list.
create function public.customer_merge_plan_internal(p_salon uuid,p_target uuid,p_sources uuid[])
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare sources uuid[]; ids uuid[]; owner_count integer; target_owners uuid[]; result jsonb;
begin
 select array_agg(distinct x order by x) into sources from unnest(p_sources) x where x<>p_target;
 if p_target is null or coalesce(cardinality(sources),0)=0 or cardinality(sources)>100 then
  raise exception 'Choose 1 to 100 source records'; end if;
 ids:=sources||p_target;
 if (select count(*) from customers where location_id=p_salon and id=any(ids))<>cardinality(ids) then
  raise exception 'Customer selection changed. Refresh and try again.'; end if;
 with ownership as (
  select id customer_id,customer_user_id account_id from customers where id=any(ids)
  union all select customer_id,customer_user_id from bookings where customer_id=any(ids)
  union all select customer_id,customer_user_id from customer_account_claims where customer_id=any(ids)
 ) select count(distinct account_id),array_agg(distinct account_id) filter(where customer_id=p_target and account_id is not null)
 into owner_count,target_owners from ownership;
 with ownership as (
  select id customer_id,customer_user_id account_id from customers where id=any(ids)
  union all select customer_id,customer_user_id from bookings where customer_id=any(ids)
  union all select customer_id,customer_user_id from customer_account_claims where customer_id=any(ids)
 ), source_owners as (
  select customer_id,array_agg(distinct account_id) owners from ownership where account_id is not null group by customer_id
 ), active_visits as (
  select customer_id,count(*) n from customer_visits where salon_id=p_salon and customer_id=any(ids)
   and status in ('waiting','in_service','checkout') group by customer_id
 )
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'blockedReason',case
  when customer_is_walking(c) or customer_is_walking(t) then 'Walking customers are already grouped in the directory'
  when coalesce(cardinality(target_owners),0)>1 then 'This profile has history linked to different personal accounts'
  when cardinality(o.owners)>1 or (cardinality(target_owners)=1 and not o.owners<@target_owners)
   then 'Linked to a different personal account'
  when coalesce(cardinality(target_owners),0)=0 and owner_count>1 and cardinality(o.owners)>0
   then 'Choose a linked profile to keep before merging these records'
  when coalesce(tv.n,0)>1 or coalesce(v.n,0)>1 or (coalesce(v.n,0)>0 and
    (select coalesce(sum(n),0) from active_visits)>1)
   then 'Finish or cancel the separate active visits before merging these profiles'
  else null end) order by c.id),'[]'::jsonb) into result
 from customers c cross join customers t left join source_owners o on o.customer_id=c.id
 left join active_visits v on v.customer_id=c.id left join active_visits tv on tv.customer_id=t.id
 where c.id=any(sources) and t.id=p_target;
 return result;
end $$;
revoke all on function public.customer_merge_plan_internal(uuid,uuid,uuid[]) from public,anon,authenticated;

create function public.customer_merge_plan(p_salon uuid,p_target uuid,p_sources uuid[])
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not user_has_salon_permission(p_salon,array['customers.view','customers.manage']) then
  raise exception 'Customer access required' using errcode='42501'; end if;
 return customer_merge_plan_internal(p_salon,p_target,p_sources);
end $$;
revoke all on function public.customer_merge_plan(uuid,uuid,uuid[]) from public,anon;
grant execute on function public.customer_merge_plan(uuid,uuid,uuid[]) to authenticated;

create or replace function public.customer_duplicate_batch(p_salon uuid,p_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare result jsonb:='{}'; c customers; candidates jsonb; plan jsonb;
begin
 if cardinality(p_ids)>25 or not user_has_salon_permission(p_salon,array['customers.view','customers.manage']) then
  raise exception 'Customer access required' using errcode='42501'; end if;
 for c in select * from customers where location_id=p_salon and id=any(p_ids) loop
  select coalesce(jsonb_agg(customer_directory_record(d)||jsonb_build_object('match',to_jsonb(m)-'ordinality') order by m.ordinality),'[]')
   into candidates from customer_identity_candidates(p_salon,c.name,c.phone,c.email) with ordinality m
   join customers d on d.id=m.customer_id where d.id<>c.id;
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

-- One transaction for the compatible subset; unexpected errors still roll back
-- all changes. Keep the existing merge RPC's ownership and dependency guards.
create function public.merge_customer_suggestions(p_salon uuid,p_target uuid,p_sources uuid[])
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare plan jsonb; sources uuid[]; skipped jsonb; result jsonb;
begin
 if current_public_user_id() is null or not user_has_salon_permission(p_salon,array['customers.manage']) then
  raise exception 'Customer merge access required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('customer-identity:'||p_salon::text,0));
 perform 1 from customers where id=any(p_sources||p_target) order by id for update;
 plan:=customer_merge_plan_internal(p_salon,p_target,p_sources);
 select array_agg((item->>'id')::uuid) filter(where item->>'blockedReason' is null),
  coalesce(jsonb_agg(item) filter(where item->>'blockedReason' is not null),'[]')
 into sources,skipped from jsonb_array_elements(plan) item;
 if coalesce(cardinality(sources),0)>0 then
  result:=merge_customer_records(p_salon,p_target,sources,'manual');
 else result:=jsonb_build_object('targetId',p_target,'merged',0); end if;
 return result||jsonb_build_object('skipped',skipped);
end $$;
revoke all on function public.merge_customer_suggestions(uuid,uuid,uuid[]) from public,anon;
grant execute on function public.merge_customer_suggestions(uuid,uuid,uuid[]) to authenticated;
commit;
