-- Clarify Scan guidance without changing eligibility or creating check-ins.
begin;
create or replace function public.personal_qr_connect_customer(p_salon uuid,p_token uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare visits uuid[]; customer_account uuid;
begin
 if service_relay_staff(p_salon) is null then raise exception 'Open your Staff workspace first'; end if;
 select q.user_id into customer_account from personal_qr_codes q
 join users u on u.id=q.user_id and u.status='active'
 where q.token=p_token and q.expires_at>now();
 if customer_account is null then
  raise exception 'This QR code is no longer valid. Ask the customer to open a new QR code, then scan again.';
 end if;
 select array_agg(v.id) into visits from personal_qr_codes q join users u on u.id=q.user_id and u.status='active' join customers c on c.customer_user_id=q.user_id and c.location_id=p_salon
 join customer_visits v on v.customer_id=c.id and v.salon_id=p_salon
 where q.token=p_token and q.expires_at>now() and v.ticket_id is null and v.status in ('waiting','in_service','checkout');
 if coalesce(cardinality(visits),0)=0 then
  raise exception 'No check-in found for this customer at this salon. Ask the customer to check in, then scan their QR code again.';
 end if;
 if cardinality(visits)>1 then
  raise exception 'This customer has more than one active check-in. Ask the front desk to confirm the correct check-in before scanning again.';
 end if;
 return staff_scan_connect(p_salon,visits[1]);
end $$;
notify pgrst,'reload schema';
commit;
