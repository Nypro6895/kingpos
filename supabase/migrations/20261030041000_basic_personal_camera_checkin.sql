begin;

-- Basic account check-in uses the existing paired display and expiring opaque
-- entry. It does not grant Staff Scan, phone relay, Ready or paid receipts.
create function public.personal_checkin_entry(p_token text) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare entry uuid;
begin
 if not exists(select 1 from pos_live_drafts d join locations l on l.id=d.salon_id
   where d.token=p_token and d.status='draft' and l.status='active') then return null; end if;
 insert into service_relay_entries(display_token) values(p_token)
 on conflict(display_token) do update set expires_at=now()+interval '8 hours' returning id into entry;
 return entry;
end $$;

create function public.personal_checkin_catalog(p_entry uuid) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('salonId',d.salon_id,'salonName',l.name,'personalOnly',true,
   'services',coalesce((select jsonb_agg(to_jsonb(c)) from get_customer_display_service_catalog(e.display_token) c),'[]'::jsonb))
 from service_relay_entries e join pos_live_drafts d on d.token=e.display_token
 join locations l on l.id=d.salon_id
 where e.id=p_entry and e.expires_at>now() and d.status='draft' and l.status='active'
$$;
revoke all on function public.personal_checkin_entry(text),public.personal_checkin_catalog(uuid) from public;
grant execute on function public.personal_checkin_entry(text),public.personal_checkin_catalog(uuid) to anon,authenticated;

-- The landing needs the public salon name, not an unused service catalog.
create function public.personal_checkin_destination(p_entry uuid) returns text
language sql stable security definer set search_path=public,pg_temp as $$
 select l.name from service_relay_entries e join pos_live_drafts d on d.token=e.display_token
 join locations l on l.id=d.salon_id
 where e.id=p_entry and e.expires_at>now() and d.status='draft' and l.status='active'
$$;
revoke all on function public.personal_checkin_destination(uuid) from public;
grant execute on function public.personal_checkin_destination(uuid) to anon,authenticated;

-- Preserve the installed identity, verified-phone consolidation, service checks,
-- locks, retry ledger, visit reuse and financial core. Change this one gate only.
do $$declare definition text; marker text:=' and staff_scan_available(d.salon_id)';begin
 definition:=pg_get_functiondef('public.personal_qr_checkin(uuid,uuid[],uuid)'::regprocedure);
 if cardinality(string_to_array(definition,marker))<>2 then
   raise exception 'Review Personal check-in: expected exactly one advanced Scan gate';
 end if;
 execute replace(definition,marker,'');
end $$;

commit;
