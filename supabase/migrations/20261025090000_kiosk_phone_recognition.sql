begin;

-- Phone is a salon CRM lookup, never an account claim or access to personal history.
-- Keep the salon lock used by the check-in core through customer/visit creation.
create or replace function public.resolve_display_customer_identity(p_salon uuid,p_name text,p_phone text,p_choice uuid default null,p_new boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare normalized_phone text:=normalize_customer_claim_phone(p_phone);
 name_key text:=customer_name_key(p_name); matching_ids uuid[]; selected uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('customer-identity:'||p_salon::text,0));
 if normalized_phone is null then
  return jsonb_build_object('ok',false,'code','invalid_phone','message','Enter a full phone number.');
 end if;
 select array_agg(c.id order by c.id) into matching_ids from customers c
 where c.location_id=p_salon and c.status='active'
 and normalize_customer_claim_phone(c.phone)=normalized_phone;
 if cardinality(matching_ids)=1 then
  selected:=matching_ids[1];
  -- A supplied contradictory name must not silently attach another person's visit.
  if name_key<>'' and not exists(select 1 from customers where id=selected and customer_name_key(name)=name_key) then
   return jsonb_build_object('ok',false,'code','identity_ambiguous','message','Please ask the front desk to confirm your profile.');
  end if;
 elsif cardinality(matching_ids)>1 then
  if length(name_key)<2 then
   return jsonb_build_object('ok',false,'code','profile_required','message','Enter your name to find your profile.');
  end if;
  select array_agg(c.id order by c.id) into matching_ids from customers c
   where c.id=any(matching_ids) and customer_name_key(c.name)=name_key;
  if coalesce(cardinality(matching_ids),0)<>1 then
   -- Do not list identities, guess the oldest/newest, merge, or create a seventh row.
   return jsonb_build_object('ok',false,'code','identity_ambiguous','message','Please ask the front desk to confirm your profile.');
  end if;
  selected:=matching_ids[1];
 elsif length(name_key)<2 then
  return jsonb_build_object('ok',false,'code','profile_required','message','Enter your name to continue.');
 end if;
 if p_choice is not null and p_choice is distinct from selected then
  return jsonb_build_object('ok',false,'code','identity_choice_expired','message','The selection changed. Search again.');
 end if;
 -- p_new cannot bypass an existing exact phone. Retained for installed clients.
 return jsonb_build_object('ok',true,'customerId',selected);
end $$;
revoke all on function public.resolve_display_customer_identity(uuid,text,text,uuid,boolean) from public,anon,authenticated;

-- The locally paired receipt path uses these legacy RPCs. Apply the same exact,
-- scoped resolver rather than raw digits or newest-row selection.
create or replace function public.find_pos_live_draft_customer_by_phone(p_phone text,p_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare draft_row pos_live_drafts%rowtype; resolution jsonb; c customers%rowtype;
begin
 select * into draft_row from pos_live_drafts where token=btrim(coalesce(p_token,'')) and status='draft' limit 1;
 if draft_row.id is null then raise exception 'Live draft was not found.'; end if;
 resolution:=resolve_display_customer_identity(draft_row.salon_id,null,p_phone);
 if resolution->>'code'='profile_required' then return null; end if;
 if not (resolution->>'ok')::boolean then raise exception '%',resolution->>'message'; end if;
 select * into c from customers where id=(resolution->>'customerId')::uuid and location_id=draft_row.salon_id;
 if c.id is null then return null; end if;
 return jsonb_build_object('id',c.id,'name',c.name,'phone',c.phone);
end $$;

create or replace function public.create_pos_live_draft_customer_by_phone(p_token text,p_name text,p_phone text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare draft_row pos_live_drafts%rowtype; resolution jsonb; c customers%rowtype; payload jsonb;
begin
 select * into draft_row from pos_live_drafts where token=btrim(coalesce(p_token,'')) and status='draft' limit 1;
 if draft_row.id is null then raise exception 'Live draft was not found.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('customer-identity:'||draft_row.salon_id::text,0));
 select * into draft_row from pos_live_drafts where id=draft_row.id for update;
 if draft_row.status<>'draft' then raise exception 'Live draft was not found.'; end if;
 resolution:=resolve_display_customer_identity(draft_row.salon_id,p_name,p_phone);
 if not (resolution->>'ok')::boolean then raise exception '%',resolution->>'message'; end if;
 select * into c from customers where id=(resolution->>'customerId')::uuid and location_id=draft_row.salon_id;
 if c.id is null then
  insert into customers(location_id,name,phone,status)
   values(draft_row.salon_id,btrim(p_name),normalize_customer_claim_phone(p_phone),'active') returning * into c;
 end if;
 payload:=jsonb_build_object('id',c.id,'name',c.name,'phone',c.phone);
 update pos_live_drafts set customer=payload,customer_version=customer_version+1,version=version+1
  where id=draft_row.id and customer is distinct from payload;
 return payload;
end $$;
-- Preserve existing grants on replaced public RPCs; helper remains private.
commit;
