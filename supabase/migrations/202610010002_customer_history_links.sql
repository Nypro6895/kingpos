begin;
-- Display associations only: never change scheduling, financial rows or queue state.
create table public.customer_history_links (
 id uuid primary key default gen_random_uuid(),
 salon_id uuid not null references public.locations(id) on delete cascade,
 booking_id uuid not null references public.bookings(id) on delete cascade,
 ticket_id uuid references public.pos_tickets(id) on delete cascade,
 visit_id uuid references public.customer_visits(id) on delete cascade,
 actor_user_id uuid references public.users(id) on delete set null,
 created_at timestamptz not null default now(),
 check ((ticket_id is null) <> (visit_id is null)),
 unique(ticket_id), unique(visit_id)
);
create unique index history_one_ticket_per_booking on public.customer_history_links(booking_id) where ticket_id is not null;
alter table public.customer_history_links enable row level security;
revoke all on public.customer_history_links from public,anon,authenticated;
grant select on public.customer_history_links to authenticated;
create policy history_links_read on public.customer_history_links for select to authenticated using (
 exists(select 1 from public.bookings b where b.id=booking_id and b.salon_id=customer_history_links.salon_id
 and (b.customer_user_id=public.current_public_user_id() or public.user_has_salon_permission(b.salon_id,array['booking.view']))));

create function public.history_salon_location(p_salon uuid) returns text
language sql stable security definer set search_path=public as $$
 select concat_ws(' · ',coalesce(nullif(s.address_line1,''),l.address_line1),nullif(concat_ws(', ',coalesce(nullif(s.city,''),l.city),coalesce(nullif(s.state,''),l.state)),''))
 from locations l left join salon_settings s on s.salon_id=l.id where l.id=p_salon;
$$;
revoke all on function public.history_salon_location(uuid) from public,anon,authenticated;

create function public.history_ticket_payload(p_ticket uuid) returns jsonb
language sql stable security definer set search_path=public as $$
 select jsonb_build_object('ticketId',t.id,'ticketNumber',t.ticket_number,'openedAt',t.opened_at,'closedAt',t.closed_at,
 'discountType',t.discount_type,'discountValue',t.discount_value,'taxRate',t.tax_rate,'tipType',t.tip_type,'tipValue',t.tip_value,
 'currency','USD','status',t.status,'salon',jsonb_build_object('id',t.salon_id,'location',history_salon_location(t.salon_id),'name',coalesce(nullif(s.business_name,''),l.name),'logoPath',s.public_profile_logo_path),
 'services',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'name',coalesce(nullif(i.service_name_snapshot,''),sv.name,'Service'),
 'quantity',i.quantity,'unitPrice',i.unit_price,'lineTotal',i.line_total,'staffName',st.display_name) order by i.created_at,i.id)
 from pos_ticket_items i left join services sv on sv.id=i.service_id left join staff st on st.id=coalesce(i.performed_by_staff_id,i.assigned_staff_id)
 where i.pos_ticket_id=t.id and i.salon_id=t.salon_id and not coalesce(i.is_removed,false)),'[]'::jsonb),
 'payments',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'method',p.payment_method,'amount',p.amount,'createdAt',p.created_at)) from pos_payments p where p.ticket_id=t.id and p.salon_id=t.salon_id),'[]'::jsonb),
 'verifiedVisit',customer_visit_verified_visit_payload(t,c))
 from pos_tickets t join customers c on c.id=t.customer_id and c.location_id=t.salon_id
 join locations l on l.id=t.salon_id left join salon_settings s on s.salon_id=t.salon_id
 where t.id=p_ticket and t.status='closed';
$$;
revoke all on function public.history_ticket_payload(uuid) from public,anon,authenticated;

create function public.get_booking_history_evidence(p_bookings uuid[]) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare b bookings%rowtype; actor uuid:=current_public_user_id(); result jsonb:='[]'; tid uuid; vid uuid; suggestions jsonb; linked boolean;
begin
 if actor is null then raise exception 'Sign in required'; end if;
 if coalesce(cardinality(p_bookings),0)>200 then raise exception 'Too many appointments'; end if;
 for b in select * from bookings where id=any(p_bookings) loop
 if b.customer_user_id is distinct from actor and not user_has_salon_permission(b.salon_id,array['booking.view']) then raise exception 'Not authorized'; end if;
 select t.id into tid from pos_tickets t join customers c on c.id=t.customer_id and c.location_id=t.salon_id
 where t.salon_id=b.salon_id and t.status='closed' and (c.id=b.customer_id or (b.customer_user_id is not null and c.customer_user_id=b.customer_user_id))
 and (t.id=b.pos_ticket_id or t.source_booking_id=b.id or exists(select 1 from customer_visits v where v.ticket_id=t.id and v.appointment_id=b.id)
 or (exists(select 1 from customer_history_links h where h.booking_id=b.id and (h.ticket_id=t.id or h.visit_id in(select id from customer_visits where ticket_id=t.id)))
 and (t.source_booking_id is null or t.source_booking_id=b.id)
 and not exists(select 1 from bookings other where other.pos_ticket_id=t.id and other.id<>b.id)
 and not exists(select 1 from customer_visits other where other.ticket_id=t.id and other.appointment_id is not null and other.appointment_id<>b.id)))
 order by t.closed_at desc,t.id limit 1;
 select v.id into vid from customer_visits v where v.salon_id=b.salon_id and v.status<>'cancelled' and (v.customer_id=b.customer_id or exists(select 1 from customers c where c.id=v.customer_id and c.location_id=v.salon_id and b.customer_user_id is not null and c.customer_user_id=b.customer_user_id))
 and (v.appointment_id=b.id or (tid is not null and v.ticket_id=tid) or exists(select 1 from customer_history_links h where h.booking_id=b.id and h.visit_id=v.id)) order by v.checked_in_at limit 1;
 linked:=exists(select 1 from customer_history_links where booking_id=b.id);
 select coalesce(jsonb_agg(x.entry order by x.at),'[]') into suggestions from (
 select t.opened_at as at,jsonb_build_object('id',t.id,'kind','ticket','at',t.opened_at,'label','Ticket '||t.ticket_number,'ticket',history_ticket_payload(t.id)) as entry
 from pos_tickets t join customers c on c.id=t.customer_id and c.location_id=t.salon_id
 where tid is null and b.status not in('cancelled','no_show') and t.status='closed' and t.salon_id=b.salon_id
 and (c.id=b.customer_id or (b.customer_user_id is not null and c.customer_user_id=b.customer_user_id))
 and (t.opened_at at time zone b.salon_timezone_snapshot)::date=(b.start_at at time zone b.salon_timezone_snapshot)::date
 and t.source_booking_id is null and not exists(select 1 from bookings where pos_ticket_id=t.id)
 and not exists(select 1 from customer_visits where ticket_id=t.id and appointment_id is not null)
 and not exists(select 1 from customer_history_links h where h.ticket_id=t.id or h.visit_id in(select id from customer_visits where ticket_id=t.id))
 union all
 select v.checked_in_at,jsonb_build_object('id',v.id,'kind','visit','at',v.checked_in_at,'label','Checked in')
 from customer_visits v join customers c on c.id=v.customer_id and c.location_id=v.salon_id
 where vid is null and tid is null and b.status not in('cancelled','no_show') and v.status<>'cancelled' and v.ticket_id is null and v.appointment_id is null and v.salon_id=b.salon_id
 and (c.id=b.customer_id or (b.customer_user_id is not null and c.customer_user_id=b.customer_user_id))
 and (v.checked_in_at at time zone b.salon_timezone_snapshot)::date=(b.start_at at time zone b.salon_timezone_snapshot)::date
 and not exists(select 1 from customer_history_links where visit_id=v.id)
 )x;
 result:=result||jsonb_build_array(jsonb_build_object('bookingId',b.id,'appointmentAt',b.start_at,'estimate',(select coalesce(sum(line_total),0) from booking_lines where booking_id=b.id and line_status<>'cancelled'),'appointmentServices',(select coalesce(jsonb_agg(service_name_snapshot order by display_order),'[]') from booking_lines where booking_id=b.id and line_status<>'cancelled'),'ticket',history_ticket_payload(tid),
 'checkedInAt',(select checked_in_at from customer_visits where id=vid),'visitId',vid,'manualLink',linked,'candidates',suggestions));
 end loop;
 return result;
end;$$;
revoke all on function public.get_booking_history_evidence(uuid[]) from public,anon;
grant execute on function public.get_booking_history_evidence(uuid[]) to authenticated;

create function public.set_booking_history_link(p_booking uuid,p_target uuid,p_kind text,p_unlink boolean default false) returns void
language plpgsql security definer set search_path=public as $$
declare b bookings%rowtype; actor uuid:=current_public_user_id(); evidence jsonb;
begin
 -- Serialize history associations, including two concurrent bookings choosing one visit/ticket.
 perform pg_advisory_xact_lock(hashtextextended('customer-history-links',0));
 select * into b from bookings where id=p_booking for update;
 if actor is null or b.id is null or (b.customer_user_id is distinct from actor and not user_has_salon_permission(b.salon_id,array['booking.manage'])) then raise exception 'Not authorized'; end if;
 if p_unlink then
 delete from customer_history_links where booking_id=b.id;
 else
 evidence:=get_booking_history_evidence(array[b.id])->0;
 if not exists(select 1 from jsonb_array_elements(evidence->'candidates') x where x->>'id'=p_target::text and x->>'kind'=p_kind) then raise exception 'This visit is no longer available. Refresh the history.'; end if;
 if exists(select 1 from customer_history_links where booking_id=b.id) then raise exception 'Undo the existing merge first.'; end if;
 insert into customer_history_links(salon_id,booking_id,ticket_id,visit_id,actor_user_id)
 values(b.salon_id,b.id,case when p_kind='ticket' then p_target end,case when p_kind='visit' then p_target end,actor);
 end if;
 insert into booking_status_events(salon_id,booking_id,event_type,old_status,new_status,actor_user_id,actor_source,metadata)
 values(b.salon_id,b.id,case when p_unlink then 'history_unlinked' else 'history_linked' end,b.status,b.status,actor,'manage',jsonb_build_object('targetId',p_target,'kind',p_kind));
end;$$;
revoke all on function public.set_booking_history_link(uuid,uuid,text,boolean) from public,anon;
grant execute on function public.set_booking_history_link(uuid,uuid,text,boolean) to authenticated;

do $$declare d text;begin
 d:=pg_get_functiondef('public.get_customer_activity(integer)'::regprocedure);
 execute replace(d,'public.get_customer_activity(','public.get_customer_activity_before_history(');
end;$$;
revoke all on function public.get_customer_activity_before_history(integer) from public,anon,authenticated;
create or replace function public.get_customer_activity(p_limit integer default 40) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb; actor uuid:=current_public_user_id(); ids uuid[]; evidence jsonb; visits jsonb;
begin
 result:=get_customer_activity_before_history(p_limit);
 if actor is null then return result; end if;
 result:=jsonb_set(result,'{purchases}',coalesce((select jsonb_agg(x||jsonb_build_object('salon',(x->'salon')||jsonb_build_object('location',history_salon_location(t.salon_id)),'timezone',get_salon_business_timezone(t.salon_id),
 'checkedInAt',(select min(checked_in_at) from customer_visits where ticket_id=t.id and salon_id=t.salon_id and status<>'cancelled')))
 from jsonb_array_elements(result->'purchases') x join pos_tickets t on t.id=(x->>'ticketId')::uuid),'[]'));
 result:=jsonb_set(result,'{bookings}',coalesce((select jsonb_agg(x||jsonb_build_object('salon',(x->'salon')||jsonb_build_object('location',history_salon_location((x->'salon'->>'id')::uuid)))) from jsonb_array_elements(result->'bookings') x),'[]'));

 select array_agg((x->>'bookingId')::uuid) into ids from jsonb_array_elements(result->'bookings') x;
 evidence:=get_booking_history_evidence(coalesce(ids,'{}'));
 select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'bookingId',coalesce(v.appointment_id,h.booking_id),'ticketId',v.ticket_id,
 'at',v.checked_in_at,'status',v.status,'timezone',get_salon_business_timezone(v.salon_id),'salon',jsonb_build_object('id',v.salon_id,'location',history_salon_location(v.salon_id),'name',l.name,'logoPath',s.public_profile_logo_path),
 'services',coalesce((select jsonb_agg(jsonb_build_object('name',sv.name) order by vs.sort_order) from customer_visit_services vs join services sv on sv.id=vs.service_id and sv.salon_id=v.salon_id where vs.visit_id=v.id),jsonb_build_array(jsonb_build_object('name','Salon visit')))) order by v.checked_in_at desc),'[]') into visits
 from (select v.* from customer_visits v join customers c on c.id=v.customer_id and c.location_id=v.salon_id
 where c.customer_user_id=actor and v.status<>'cancelled' order by v.checked_in_at desc limit greatest(1,least(p_limit,100))) v
 join locations l on l.id=v.salon_id left join salon_settings s on s.salon_id=v.salon_id left join customer_history_links h on h.visit_id=v.id;
 return result||jsonb_build_object('evidence',evidence,'visits',visits);
end;$$;
-- Keep verification based on recorded tickets, never on elapsed appointment time/check-in.
do $$declare d text; pos integer;begin
 d:=pg_get_functiondef('public.find_beauty_visit_proof(uuid,uuid,uuid)'::regprocedure);
 pos:=strpos(d,'''method'', ''completed_booking''');
 if pos>0 then
 d:=substring(d from 1 for strpos(d, E'  select jsonb_build_object(\n    ''state'', ''verified'',\n    ''method'', ''completed_booking''')-1)||E'  return jsonb_build_object(''state'',''pending'',''method'',''none'');\nend;\n$function$;';
 execute d;
 end if;
end;$$;
-- Existing post badges must also use ticket proof. Preserve original evidence metadata
-- and previously awarded rewards; this migration does not recalculate money/points.
update public.beauty_post_verifications v set
 metadata=v.metadata||jsonb_build_object('previousHistoryProof',jsonb_build_object('state',v.state,'method',v.method,'bookingId',v.booking_id,'verifiedAt',v.verified_at)),
 state='pending',method='none',verified_at=null
 where v.state='verified' and not exists (
 select 1 from pos_tickets t join customers c on c.id=t.customer_id and c.location_id=t.salon_id
 join beauty_posts p on p.id=v.post_id join beauty_post_attributions a on a.post_id=p.id
 where t.id=v.pos_ticket_id and t.status='closed' and t.salon_id=a.salon_id and c.customer_user_id=p.author_user_id);

create function public.enforce_ticket_post_verification() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.state='verified' and not exists (
 select 1 from pos_tickets t join customers c on c.id=t.customer_id and c.location_id=t.salon_id
 join beauty_posts p on p.id=new.post_id join beauty_post_attributions a on a.post_id=p.id
 where t.id=new.pos_ticket_id and t.status='closed' and t.salon_id=a.salon_id and c.customer_user_id=p.author_user_id)
 then new.state:='pending'; new.method:='none'; new.verified_at:=null; end if;
 return new;
end;$$;
create trigger enforce_ticket_post_verification before insert or update on public.beauty_post_verifications
 for each row execute function public.enforce_ticket_post_verification();

create function public.enforce_ticket_review_verification() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.verification_status='verified' and not exists (
 select 1 from pos_tickets t join customers c on c.id=t.customer_id and c.location_id=t.salon_id
 where t.status='closed' and t.salon_id=new.salon_id and c.customer_user_id=new.author_user_id
 and (new.verified_booking_id is null or exists(select 1 from bookings b where b.id=new.verified_booking_id
 and (b.pos_ticket_id=t.id or t.source_booking_id=b.id or exists(select 1 from customer_visits where appointment_id=b.id and ticket_id=t.id)
 or exists(select 1 from customer_history_links where booking_id=b.id and ticket_id=t.id)))))
 then new.verification_status:='unverified'; end if;
 return new;
end;$$;
create trigger enforce_ticket_review_verification before insert or update on public.salon_profile_reviews
 for each row execute function public.enforce_ticket_review_verification();
update salon_profile_reviews r set verification_status='unverified' where verification_status='verified' and not exists (
 select 1 from pos_tickets t join customers c on c.id=t.customer_id and c.location_id=t.salon_id
 where t.status='closed' and t.salon_id=r.salon_id and c.customer_user_id=r.author_user_id
 and (r.verified_booking_id is null or exists(select 1 from bookings b where b.id=r.verified_booking_id
 and (b.pos_ticket_id=t.id or t.source_booking_id=b.id or exists(select 1 from customer_visits where appointment_id=b.id and ticket_id=t.id)
 or exists(select 1 from customer_history_links where booking_id=b.id and ticket_id=t.id)))));

create function public.refresh_ticket_history_verification() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.status is distinct from old.status or new.customer_id is distinct from old.customer_id then
 update beauty_post_verifications set state=state where pos_ticket_id=new.id and state='verified' and (new.status<>'closed' or new.customer_id is distinct from old.customer_id);
 update salon_profile_reviews set verification_status=verification_status
 where salon_id=new.salon_id and verification_status='verified' and author_user_id in
 (select customer_user_id from customers where id=old.customer_id) and not exists (
 select 1 from pos_tickets t join customers c on c.id=t.customer_id and c.location_id=t.salon_id
 where t.status='closed' and t.salon_id=salon_profile_reviews.salon_id and c.customer_user_id=salon_profile_reviews.author_user_id
 and (salon_profile_reviews.verified_booking_id is null or exists(select 1 from bookings b where b.id=salon_profile_reviews.verified_booking_id and (b.pos_ticket_id=t.id or t.source_booking_id=b.id
 or exists(select 1 from customer_visits where appointment_id=b.id and ticket_id=t.id)
 or exists(select 1 from customer_history_links where booking_id=b.id and ticket_id=t.id)))));
 end if;
 return new;
end;$$;
create trigger refresh_ticket_history_verification after update of status,customer_id on public.pos_tickets
 for each row execute function public.refresh_ticket_history_verification();
revoke all on function public.enforce_ticket_post_verification(),public.enforce_ticket_review_verification(),public.refresh_ticket_history_verification() from public,anon,authenticated;
-- Public experience badges also check the current ticket, including reopened tickets.
do $$declare d text;begin
 d:=pg_get_functiondef('public.get_public_salon_profile_experiences(uuid)'::regprocedure);
 if strpos(d,'''verified''::text as verification_status')=0 then raise exception 'Experience definition changed; review migration'; end if;
 execute replace(d,'''verified''::text as verification_status',
 'case when exists(select 1 from public.pos_tickets t join public.customers c on c.id=t.customer_id and c.location_id=t.salon_id where t.id=experiences.ticket_id and t.status=''closed'' and t.salon_id=experiences.salon_id and c.customer_user_id=experiences.author_user_id) then ''verified''::text else ''unverified''::text end as verification_status');
end;$$;
do $$declare d text;begin
 d:=pg_get_functiondef('public.get_beauty_recent_visit_candidates(integer)'::regprocedure);
 if strpos(d,E'    from candidates\n    order by')=0 then raise exception 'Beauty candidates definition changed; review migration'; end if;
 execute replace(d,E'    from candidates\n    order by',E'    from candidates\n    where source=''receipt''\n    order by');
 d:=pg_get_functiondef('public.get_public_salon_profile_reputation_summary(uuid)'::regprocedure);
 execute replace(d,'where experiences.salon_id = target_salon_id',
 'where experiences.salon_id = target_salon_id and exists(select 1 from public.pos_tickets t join public.customers c on c.id=t.customer_id and c.location_id=t.salon_id where t.id=experiences.ticket_id and t.status=''closed'' and t.salon_id=experiences.salon_id and c.customer_user_id=experiences.author_user_id)');
end;$$;
-- Trusted wrapper owners need access to private helpers on installations with mixed function owners.
do $$declare owner_name text;begin
 for owner_name in select distinct pg_get_userbyid(proowner) from pg_proc where pronamespace='public'::regnamespace and proname in ('get_customer_activity','get_booking_history_evidence','set_booking_history_link') loop
 execute format('grant execute on function public.history_salon_location(uuid), public.history_ticket_payload(uuid), public.get_customer_activity_before_history(integer), public.get_booking_history_evidence(uuid[]) to %I',owner_name);
 end loop;
end;$$;
notify pgrst,'reload schema';
commit;
