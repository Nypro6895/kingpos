begin;
create table public.service_relay_entries (
 id uuid primary key default gen_random_uuid(),
 display_token text not null unique,
 expires_at timestamptz not null default now()+interval '8 hours'
);
alter table public.service_relay_entries enable row level security;
create function public.service_relay_entry(p_token text) returns uuid
language plpgsql security definer set search_path=public as $$
declare entry uuid;
begin
 if not exists(select 1 from pos_live_drafts d join salon_market_plugins p on p.salon_id=d.salon_id and p.plugin_id='service-relay' where d.token=p_token and d.status='draft') then return null; end if;
 insert into service_relay_entries(display_token) values(p_token) on conflict(display_token) do update set expires_at=now()+interval '8 hours' returning id into entry;
 return entry;
end $$;
create function public.service_relay_entry_catalog(p_entry uuid) returns jsonb
language sql stable security definer set search_path=public as $$
 select jsonb_build_object('salonName',s.name,'services',coalesce((select jsonb_agg(to_jsonb(catalog)) from get_customer_display_service_catalog(e.display_token) catalog),'[]'::jsonb))
 from service_relay_entries e join pos_live_drafts d on d.token=e.display_token join locations s on s.id=d.salon_id
 where e.id=p_entry and e.expires_at>now() and d.status='draft'
 and exists(select 1 from salon_market_plugins where salon_id=d.salon_id and plugin_id='service-relay')
$$;
create function public.service_relay_phone_checkin(p_entry uuid,p_phone text,p_name text,p_services uuid[],p_request text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare entry_token text; result jsonb; visit uuid; pass jsonb;
begin
 select e.display_token into entry_token from service_relay_entries e join pos_live_drafts d on d.token=e.display_token
 where e.id=p_entry and e.expires_at>now() and d.status='draft'
 and exists(select 1 from salon_market_plugins where salon_id=d.salon_id and plugin_id='service-relay');
 if entry_token is null then raise exception 'Check-in link has expired. Scan the salon screen again.'; end if;
 if coalesce(array_length(p_services,1),0)=0 or array_length(p_services,1)>30 then raise exception 'Choose the services you want.'; end if;
 if exists(select 1 from unnest(p_services) requested(service_id) where not exists(select 1 from services s join pos_live_drafts d on d.salon_id=s.salon_id where d.token=entry_token and s.id=requested.service_id and s.is_active)) then raise exception 'A service is no longer available'; end if;
 result:=resolve_customer_display_check_in(entry_token,p_phone,p_name,p_request);
 if coalesce((result->>'ok')::boolean,false)=false then return result; end if;
 visit:=(result->'visit'->>'id')::uuid;
 -- Do not change services on an existing visit already accepted by staff.
 if exists(select 1 from service_relay_offers where visit_id=visit and status in ('working','done')) then
  pass:=service_relay_issue_pass(entry_token,visit);
 else
  result:=update_customer_visit_requested_services(entry_token,visit,p_services);
  if coalesce((result->>'ok')::boolean,false)=false then raise exception 'Could not save requested services'; end if;
  pass:=service_relay_issue_pass(entry_token,visit);
 end if;
 return jsonb_build_object('ok',true,'pass',pass);
end $$;
revoke all on function public.service_relay_entry(text),public.service_relay_entry_catalog(uuid),public.service_relay_phone_checkin(uuid,text,text,uuid[],text) from public;
grant execute on function public.service_relay_entry(text),public.service_relay_entry_catalog(uuid),public.service_relay_phone_checkin(uuid,text,text,uuid[],text) to anon,authenticated;
commit;
