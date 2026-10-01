alter table public.booking_settings add column if not exists confirmation_email_enabled boolean not null default true;
alter table public.booking_settings add column if not exists confirmation_sms_enabled boolean not null default true;
alter table public.booking_settings add column if not exists reminder_enabled boolean not null default true;
create table public.booking_message_outbox (
 id uuid primary key default gen_random_uuid(),
 salon_id uuid not null references public.locations(id) on delete cascade,
 booking_id uuid not null references public.bookings(id) on delete cascade,
 channel text not null check(channel in ('email','sms')),
 event_key text not null,
 recipient text not null,
 message text not null,
 state text not null default 'pending' check(state in ('pending','sending','accepted','failed','unknown','unconfigured','skipped')),
 provider_id text,
 detail text,
 attempts integer not null default 0,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(booking_id,channel,event_key)
);
alter table public.booking_message_outbox enable row level security;
create policy booking_message_owner_read on public.booking_message_outbox for select to authenticated
using(public.user_has_salon_permission(salon_id,array['booking.view','booking.manage']));
grant select on public.booking_message_outbox to authenticated;

create or replace function public.enqueue_booking_message() returns trigger
language plpgsql security definer set search_path=public as $$
declare customer customers%rowtype; settings booking_settings%rowtype; salon_name text; body text; event text; channel text; recipient text;
begin
 if TG_OP='UPDATE' and (new.status,new.start_at,new.confirmation_status) is not distinct from (old.status,old.start_at,old.confirmation_status) then return new; end if;
 if new.status not in ('pending','scheduled','confirmed','cancelled') then return new; end if;
 select * into customer from customers where id=new.customer_id and location_id=new.salon_id;
 select * into settings from booking_settings where salon_id=new.salon_id;
 select name into salon_name from locations where id=new.salon_id;
 event := new.status||':'||new.confirmation_status||':'||extract(epoch from new.start_at)::text;
 body := salon_name||': Your appointment on '||to_char(new.start_at at time zone new.salon_timezone_snapshot,'Mon DD, YYYY HH12:MI AM')||' ('||new.salon_timezone_snapshot||') is '||
   case when new.status='cancelled' then 'cancelled.' when new.status='pending' or new.confirmation_status='requested' then 'requested and awaiting salon confirmation.' else 'confirmed.' end;
 foreach channel in array array['email','sms'] loop
  if channel='email' and not coalesce(settings.confirmation_email_enabled,true) then continue; end if;
  if channel='sms' and not coalesce(settings.confirmation_sms_enabled,true) then continue; end if;
  recipient:=case when channel='email' then customer.email else customer.phone end;
  if nullif(trim(recipient),'') is null then continue; end if;
  insert into booking_message_outbox(salon_id,booking_id,channel,event_key,recipient,message)
  values(new.salon_id,new.id,channel,event,recipient,body) on conflict do nothing;
 end loop;
 return new;
end; $$;
revoke all on function public.enqueue_booking_message() from public,anon,authenticated;
create trigger enqueue_booking_message after insert or update of status,start_at,confirmation_status on public.bookings
for each row execute function public.enqueue_booking_message();

-- Service worker only. Locked claim avoids duplicate sends across machines.
create or replace function public.claim_booking_messages(p_limit integer default 20,p_email_ready boolean default true,p_sms_ready boolean default true)
returns setof public.booking_message_outbox language plpgsql security definer set search_path=public as $$
begin
 -- One reminder per appointment time, using the salon's enabled channels.
 insert into booking_message_outbox(salon_id,booking_id,channel,event_key,recipient,message)
 select b.salon_id,b.id,c.channel,'reminder:'||extract(epoch from b.start_at)::text,
   case when c.channel='email' then customer.email else customer.phone end,
   salon.name||': Reminder: your appointment is on '||to_char(b.start_at at time zone b.salon_timezone_snapshot,'Mon DD, YYYY HH12:MI AM')||' ('||b.salon_timezone_snapshot||').'
 from bookings b join customers customer on customer.id=b.customer_id and customer.location_id=b.salon_id
 join locations salon on salon.id=b.salon_id left join booking_settings settings on settings.salon_id=b.salon_id
 cross join (values('email'),('sms')) c(channel)
 where b.status in ('confirmed','scheduled') and b.confirmation_status='confirmed'
 and b.start_at>now() and b.start_at<=now()+interval '24 hours' and b.created_at<now()-interval '1 hour'
 and coalesce(settings.reminder_enabled,true)
 and case when c.channel='email' then coalesce(settings.confirmation_email_enabled,true) else coalesce(settings.confirmation_sms_enabled,true) end
 and nullif(trim(case when c.channel='email' then customer.email else customer.phone end),'') is not null
 on conflict do nothing;
 update booking_message_outbox set state='unconfigured',detail='Messaging provider is not connected.',updated_at=now()
 where state='pending' and ((channel='email' and not p_email_ready) or (channel='sms' and not p_sms_ready));
 update booking_message_outbox m set state='skipped',detail='Superseded or expired booking update.',updated_at=now()
 from bookings b where b.id=m.booking_id and m.state in ('pending','unconfigured')
 and (m.created_at<=now()-interval '24 hours' or (b.start_at<=now() and b.status<>'cancelled')
  or not (m.event_key=b.status||':'||b.confirmation_status||':'||extract(epoch from b.start_at)::text
    or (m.event_key='reminder:'||extract(epoch from b.start_at)::text and b.status in ('confirmed','scheduled') and b.confirmation_status='confirmed')));
 -- An interrupted send is uncertain; never automatically resend an SMS that may
 -- have been accepted by the provider before the worker disconnected.
 update booking_message_outbox set state='unknown',detail='Delivery attempt interrupted; verify provider before retrying.',updated_at=now()
 where state='sending' and updated_at<now()-interval '5 minutes';
 return query update booking_message_outbox m set state='sending',attempts=m.attempts+1,updated_at=now()
 where m.id in(select q.id from booking_message_outbox q join bookings b on b.id=q.booking_id
  where q.state in ('pending','unconfigured')
  and ((q.channel='email' and p_email_ready) or (q.channel='sms' and p_sms_ready))
  and case when q.channel='email' then coalesce((select confirmation_email_enabled from booking_settings where salon_id=q.salon_id),true) else coalesce((select confirmation_sms_enabled from booking_settings where salon_id=q.salon_id),true) end and q.created_at>now()-interval '24 hours'
  and (b.start_at>now() or b.status='cancelled')
  and (q.event_key=b.status||':'||b.confirmation_status||':'||extract(epoch from b.start_at)::text
    or (q.event_key='reminder:'||extract(epoch from b.start_at)::text and b.status in ('confirmed','scheduled') and b.confirmation_status='confirmed'
      and coalesce((select reminder_enabled from booking_settings where salon_id=q.salon_id),true)))
  order by q.created_at for update of q skip locked limit least(greatest(p_limit,1),50)) returning m.*;
end; $$;
revoke all on function public.claim_booking_messages(integer,boolean,boolean) from public,anon,authenticated;
grant execute on function public.claim_booking_messages(integer,boolean,boolean) to service_role;
notify pgrst,'reload schema';

do $patch$
declare definition text;
begin
 definition:=pg_get_functiondef('public.get_pos_portable_book_data(uuid,text,date)'::regprocedure);
 definition:=replace(definition,'''status'', booking_rows.status','''status'', booking_rows.status, ''notificationStatus'', booking_rows.notification_status');
 definition:=replace(definition,'bookings.status,','bookings.status, (select string_agg(distinct m.channel||'': ''||case when m.state=''accepted'' then ''provider accepted'' when m.state=''pending'' then ''queued'' else m.state end, '', '') from public.booking_message_outbox m where m.booking_id=bookings.id) as notification_status,');
 execute definition;
end; $patch$;
