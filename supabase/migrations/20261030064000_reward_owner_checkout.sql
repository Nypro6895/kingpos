begin;
create table public.reward_cart_channels(salon_id uuid not null references public.locations(id),cart_id uuid not null,token text not null unique default gen_random_uuid()::text,primary key(salon_id,cart_id));
alter table public.reward_cart_channels enable row level security;
revoke all on table public.reward_cart_channels from anon,authenticated;
create function public.reward_owner_cart(p_salon uuid,p_cart uuid,p_receipt jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_token text; sub numeric; disc numeric; v_tip numeric; cid uuid; quoted jsonb; reward_discount numeric; begin
 if not coalesce(user_has_salon_permission(p_salon,array['tickets.create','tickets.manage']),false) then raise exception 'POS access required'; end if;
 if p_cart is null then raise exception 'Cart identity required'; end if;
 cid:=nullif(p_receipt->>'customerId','')::uuid;
 if cid is not null and not exists(select 1 from customers where id=cid and location_id=p_salon) then raise exception 'Customer belongs to another salon'; end if;
 insert into reward_cart_channels(salon_id,cart_id) values(p_salon,p_cart) on conflict do nothing;
 select token into v_token from reward_cart_channels where salon_id=p_salon and cart_id=p_cart;
 select coalesce(sum((l->>'total')::numeric),0) into sub from jsonb_array_elements(coalesce(p_receipt->'lines','[]'))l;
 disc:=least(sub,greatest(0,coalesce((p_receipt->>'discountValue')::numeric,0)));v_tip:=greatest(0,coalesce((p_receipt->>'tipAmount')::numeric,0));
 insert into pos_live_drafts(salon_id,token,customer,subtotal,total,tip) values(p_salon,v_token,case when cid is null then null else jsonb_build_object('id',cid,'name',p_receipt->>'customerName') end,sub,sub-disc+v_tip,v_tip)
 on conflict(token) do update set customer=excluded.customer,subtotal=excluded.subtotal,total=excluded.total,tip=excluded.tip,updated_at=now();
 update pos_live_drafts set receipt=p_receipt,discount=disc,total_before_tip=sub-disc,
  customer_handoff_started_at=case when sub>0 then coalesce(customer_handoff_started_at,now()) else null end,
  staff_lines=coalesce((select jsonb_agg(jsonb_build_object('id',n::text,'staffId',l->>'staffId','staffName',coalesce((select display_name from staff where id=nullif(l->>'staffId','')::uuid),'Unassigned'),'serviceId',l->>'serviceId','label',l->>'serviceLabel','amount',(l->>'total')::numeric,'amountInput',l->>'amountInput','amountParts',l->'amountParts','sortOrder',n)) from jsonb_array_elements(coalesce(p_receipt->'lines','[]')) with ordinality x(l,n)),'[]'),version=version+1
 where token=v_token and receipt is distinct from p_receipt;
 quoted:=reward_quote(p_salon,p_receipt,v_token);
 reward_discount:=case when quoted->'view'->'request'->>'status'='confirmed' then (quoted->'view'->'request'->>'valueCents')::numeric/100 else 0 end;
 update pos_live_drafts set discount=disc+reward_discount,total_before_tip=sub-disc-reward_discount,total=sub-disc-reward_discount+v_tip,version=version+1
 where token=v_token and (discount is distinct from disc+reward_discount or total is distinct from sub-disc-reward_discount+v_tip);
 return quoted||jsonb_build_object('token',v_token);
end $$;
revoke all on function public.reward_owner_cart(uuid,uuid,jsonb) from public,anon;
grant execute on function public.reward_owner_cart(uuid,uuid,jsonb) to authenticated;
commit;
