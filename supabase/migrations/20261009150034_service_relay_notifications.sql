begin;
create function public.notify_service_relay_change() returns trigger
language plpgsql security definer set search_path=public as $$
declare visit uuid; salon uuid; recipient uuid;
begin
 visit:=case when TG_OP='DELETE' then old.visit_id else new.visit_id end;
 select salon_id into salon from service_relay_tickets where visit_id=visit;
 if TG_TABLE_NAME='service_relay_offers' and TG_OP='INSERT' and new.status='offered' then
  select coalesce(s.account_user_id,u.id) into recipient from staff s left join users u on u.auth_user_id=s.user_id where s.id=new.staff_id;
  if recipient is not null then
   insert into app_notifications(salon_id,recipient_user_id,recipient_kind,notification_type,title,body,href,event_key)
   values(salon,recipient,'staff','service_relay_offer','Your next customer','POS assigned a customer. Open My Work to accept or decline.','/staff/my-work','service-relay:'||new.id::text);
  end if;
 elsif TG_TABLE_NAME='service_relay_offers' and TG_OP='UPDATE' and new.status<>old.status then
  update app_notifications set read_at=coalesce(read_at,now()),title=case new.status when 'expired' then 'Customer offer expired' when 'declined' then 'Customer offer declined' else 'Customer offer received' end where event_key='service-relay:'||new.id::text;
 end if;
 -- No customer data is put on the shared realtime channel.
 begin
  perform realtime.send(jsonb_build_object('salonId',salon,'resource','staff'),'workspace_changed','pos-staff:'||salon::text,false);
 exception when others then null;
 end;
 return null;
end $$;
create trigger service_relay_offer_changed after insert or update on service_relay_offers for each row execute function notify_service_relay_change();
create trigger service_relay_ticket_changed after insert or update on service_relay_tickets for each row execute function notify_service_relay_change();
revoke all on function public.notify_service_relay_change() from public,anon,authenticated;
commit;
