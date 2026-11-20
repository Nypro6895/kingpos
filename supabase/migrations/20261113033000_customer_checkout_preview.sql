begin;

-- Keep the existing earning/settlement functions authoritative. This projection
-- is read-only and is used only when its receipt facts match the visible draft.
create function public.reward_checkout_preview(p_token text,p_visit uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare d pos_live_drafts; v customer_visits; p reward_programs; r reward_requests; s gift_card_sessions;
 u uuid; net_cents bigint; gift_cents integer:=0; reward_cents integer:=0; points bigint:=0;
begin
 select * into d from pos_live_drafts where token=p_token and status='draft' and updated_at>now()-interval '24 hours';
 select cv.* into v from customer_visits cv join customers c on c.id=cv.customer_id and c.location_id=cv.salon_id
  where cv.id=p_visit and cv.salon_id=d.salon_id and cv.customer_id=nullif(d.customer->>'id','')::uuid
   and c.customer_user_id is not null and cv.status in ('waiting','in_service','checkout');
 if d.id is null or v.id is null then return null; end if;
 select customer_user_id into u from customers where id=v.customer_id and location_id=v.salon_id;
 select * into p from reward_programs where salon_id=d.salon_id;
 select * into r from reward_requests where visit_id=v.id and user_id=u and status='confirmed' and expires_at>now();
 if r.id is not null then reward_cents:=(r.offer->>'valueCents')::integer; end if;
 -- POS may still be publishing the discount selected on the customer display.
 if round(d.discount*100)<reward_cents then return null; end if;
 net_cents:=greatest(0,round((d.subtotal-d.discount)*100)::bigint);
 select * into s from gift_card_sessions where draft_token=p_token and salon_id=d.salon_id
  and customer_id=v.customer_id and status='open' and expires_at>now() order by created_at desc limit 1;
 if s.id is not null and s.approved and s.approval_expires>now() and s.total=round(d.total*100)
  and round((select coalesce(sum((x->>'total')::numeric),0) from jsonb_array_elements(s.receipt->'lines')x)*100)=round(d.subtotal*100)
  and round(greatest(0,coalesce((s.receipt->>'tipAmount')::numeric,0))*100)=round(d.tip*100)
 then gift_cents:=greatest(0,least(s.amount,s.total)); end if;
 if p.enabled and d.subtotal>0 then
  points:=floor(greatest(0,net_cents-gift_cents)/(p.rules->>'spendCents')::numeric)::bigint*(p.rules->>'spendPoints')::integer
   +(p.rules->>'visitPoints')::integer;
  if v.appointment_id is not null and not exists(select 1 from reward_ledger where salon_id=d.salon_id and user_id=u and reason='First paid booking') then
   points:=points+(p.rules->>'firstBookingPoints')::integer;
  end if;
 end if;
 return jsonb_build_object('customerId',v.customer_id,'subtotalCents',round(d.subtotal*100),
  'discountCents',round(d.discount*100),'tipCents',round(d.tip*100),'totalCents',round(d.total*100),
  'rewardValueCents',reward_cents,'giftCents',gift_cents,'earningEnabled',coalesce(p.enabled,false),
  'points',least(2147483647,greatest(0,points)));
end $$;
revoke all on function public.reward_checkout_preview(text,uuid) from public,anon,authenticated;

alter function public.reward_display(text,text,jsonb) rename to reward_display_before_checkout_preview;
revoke all on function public.reward_display_before_checkout_preview(text,text,jsonb) from public,anon,authenticated;
create function public.reward_display(p_token text,p_op text,p_args jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public as $$
declare result jsonb; preview jsonb;
begin
 result:=reward_display_before_checkout_preview(p_token,p_op,p_args);
 if jsonb_typeof(result->'view')='object' then
  preview:=reward_checkout_preview(p_token,nullif(result->'view'->>'visitId','')::uuid);
  if preview is not null then result:=jsonb_set(result,'{view,checkout}',preview); end if;
 end if;
 return result;
end $$;
revoke all on function public.reward_display(text,text,jsonb) from public;
grant execute on function public.reward_display(text,text,jsonb) to anon,authenticated;

-- Automatic custom-tip saves must never spill into a different receipt or
-- customer. Keep the legacy RPC for older clients; new clients pin both versions.
create function public.confirm_pos_live_draft_tip_scoped(p_token text,p_tip_amount numeric,p_request_id text,
 p_draft_id uuid,p_customer_version integer,p_receipt_version integer) returns jsonb
language plpgsql security definer set search_path=public as $$
declare d pos_live_drafts;
begin
 select * into d from pos_live_drafts where token=p_token for update;
 if d.id is null or d.id is distinct from p_draft_id or d.customer_version is distinct from p_customer_version
  or (d.receipt_version is distinct from p_receipt_version and not(coalesce(d.last_tip_action_id=p_request_id,false) and d.tip=round(p_tip_amount,2)))
 then raise exception 'The receipt changed. Please select your tip again.'; end if;
 return confirm_pos_live_draft_tip(p_token,p_tip_amount,p_request_id);
end $$;
revoke all on function public.confirm_pos_live_draft_tip_scoped(text,numeric,text,uuid,integer,integer) from public;
grant execute on function public.confirm_pos_live_draft_tip_scoped(text,numeric,text,uuid,integer,integer) to anon,authenticated;

commit;
