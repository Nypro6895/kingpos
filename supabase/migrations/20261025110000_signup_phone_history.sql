begin;

-- Keep the established claim/audit implementation for unambiguous phones.
alter function public.claim_customers_for_verified_phone_internal(uuid,text,text)
  rename to claim_customers_for_verified_phone_before_selection;

create function public.claim_customers_for_verified_phone_internal(
  p_user_id uuid, p_normalized_phone text, p_claim_method text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare phone_value text:=normalize_customer_claim_phone(p_normalized_phone); names_count integer;
begin
  if not exists(select 1 from customer_verified_phones v join users u on u.id=v.user_id
    where v.user_id=p_user_id and v.normalized_phone=phone_value and u.status='active') then
    return jsonb_build_object('ok',false,'code','unverified_phone');
  end if;
  select count(distinct coalesce(nullif(customer_name_key(c.name),''),'unknown')) into names_count
  from customers c where normalize_customer_claim_phone(c.phone)=phone_value
    and (c.customer_user_id is null or c.customer_user_id=p_user_id);
  if names_count>1 then
    return jsonb_build_object('ok',true,'linkedCount',0,'selectionRequired',true);
  end if;
  return claim_customers_for_verified_phone_before_selection(p_user_id,phone_value,p_claim_method);
end $$;
revoke all on function public.claim_customers_for_verified_phone_internal(uuid,text,text) from public,anon,authenticated;
revoke all on function public.claim_customers_for_verified_phone_before_selection(uuid,text,text) from public,anon,authenticated;

-- An explicit claim does not fire this branch. New/edited unclaimed profiles
-- only auto-link when their name agrees with the already connected identity.
create or replace function public.auto_link_customer_to_verified_phone() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare phone_value text; owner_id uuid; profile_name text;
begin
  if new.customer_user_id is not null then return new; end if;
  phone_value:=normalize_customer_claim_phone(new.phone);
  if phone_value is null then return new; end if;
  select v.user_id,customer_name_key(u.display_name) into owner_id,profile_name
  from customer_verified_phones v join users u on u.id=v.user_id
  where v.normalized_phone=phone_value and u.status='active';
  if owner_id is null or nullif(customer_name_key(new.name),'') is null then return new; end if;
  if exists(select 1 from customers c where c.id is distinct from new.id
    and normalize_customer_claim_phone(c.phone)=phone_value
    and (c.customer_user_id is null or c.customer_user_id=owner_id)
    and customer_name_key(c.name)<>customer_name_key(new.name)) then return new; end if;
  if not exists(select 1 from customers c where c.id is distinct from new.id
    and c.customer_user_id=owner_id and normalize_customer_claim_phone(c.phone)=phone_value
    and customer_name_key(c.name)=customer_name_key(new.name))
    and customer_name_key(new.name) is distinct from profile_name then return new; end if;
  new.customer_user_id:=owner_id;
  new.customer_account_claimed_at:=coalesce(new.customer_account_claimed_at,now());
  new.customer_account_claim_method:='auto_verified_phone';
  new.customer_account_claim_metadata:=coalesce(new.customer_account_claim_metadata,'{}'::jsonb)
    ||jsonb_build_object('normalized_phone',phone_value,'source','verified_phone_name_auto_link');
  return new;
end $$;

create function public.get_my_phone_history_profiles(p_phone text) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare actor uuid:=current_public_user_id(); phone_value text:=normalize_customer_claim_phone(p_phone);
begin
  if actor is null or not exists(select 1 from customer_verified_phones v join users u on u.id=v.user_id
    where v.user_id=actor and v.normalized_phone=phone_value and u.status='active') then
    return jsonb_build_object('ok',false,'code','unverified_phone');
  end if;
  return jsonb_build_object('ok',true,'profiles',coalesce((select jsonb_agg(jsonb_build_object(
    'id',c.id,'name',c.name,'salonName',l.name,'linked',coalesce(c.customer_user_id=actor,false))
    order by l.name,c.name,c.id) from customers c join locations l on l.id=c.location_id
    where normalize_customer_claim_phone(c.phone)=phone_value
      and (c.customer_user_id is null or c.customer_user_id=actor)),'[]'::jsonb));
end $$;

create function public.claim_selected_phone_history(p_phone text,p_customer_ids uuid[]) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=current_public_user_id(); phone_value text:=normalize_customer_claim_phone(p_phone);
  linked_count integer; selected_ids uuid[];
begin
  if actor is null or not exists(select 1 from customer_verified_phones v join users u on u.id=v.user_id
    where v.user_id=actor and v.normalized_phone=phone_value and u.status='active') then
    return jsonb_build_object('ok',false,'code','unverified_phone');
  end if;
  select array_agg(distinct x) into selected_ids from unnest(p_customer_ids) x;
  if coalesce(cardinality(selected_ids),0)=0 or cardinality(selected_ids)>200 then
    return jsonb_build_object('ok',false,'code','invalid_selection');
  end if;
  perform 1 from customers where id=any(selected_ids) order by id for update;
  if (select count(*) from customers c where c.id=any(selected_ids)
      and normalize_customer_claim_phone(c.phone)=phone_value
      and (c.customer_user_id is null or c.customer_user_id=actor))<>cardinality(selected_ids) then
    return jsonb_build_object('ok',false,'code','invalid_selection');
  end if;
  with changed as (
    update customers set customer_user_id=actor,customer_account_claimed_at=now(),
      customer_account_claim_method='verified_phone',updated_at=now(),
      customer_account_claim_metadata=coalesce(customer_account_claim_metadata,'{}'::jsonb)
        ||jsonb_build_object('source','selected_phone_history','normalized_phone',phone_value)
    where id=any(selected_ids) and customer_user_id is null returning id,location_id
  ), logged as (
    insert into customer_account_claims(salon_id,customer_id,customer_user_id,claim_method,proof_type,claim_status,metadata)
    select location_id,id,actor,'verified_phone','verified_phone_ownership','linked',
      jsonb_build_object('source','selected_phone_history','normalized_phone',phone_value) from changed
    on conflict(customer_id,customer_user_id,claim_method) do nothing returning 1
  ) select count(*) into linked_count from changed;
  return jsonb_build_object('ok',true,'linkedCount',linked_count);
end $$;
revoke all on function public.get_my_phone_history_profiles(text),public.claim_selected_phone_history(text,uuid[]) from public,anon;
grant execute on function public.get_my_phone_history_profiles(text),public.claim_selected_phone_history(text,uuid[]) to authenticated;
commit;
