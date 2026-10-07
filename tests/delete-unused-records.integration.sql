begin;
do $$
declare account uuid; salon uuid; member uuid; service uuid; spare uuid; rejected boolean;
  owner_auth uuid := gen_random_uuid(); owner_user uuid := gen_random_uuid(); owner_role uuid; other_salon uuid;
  customer uuid; booking uuid; invitation uuid; ticket uuid; item uuid;
begin
  insert into public.accounts(name) values ('Unused deletion test') returning id into account;
  insert into public.locations(account_id,name) values(account,'Unused deletion test') returning id into salon;
  insert into public.staff(salon_id,display_name) values(salon,'Mistaken staff') returning id into member;
  delete from public.staff where id=member;
  if exists(select 1 from public.staff where id=member) then raise exception 'Unused staff was not deleted'; end if;
  insert into public.services(salon_id,name) values(salon,'Mistaken service') returning id into spare;
  delete from public.services where id=spare;
  if exists(select 1 from public.services where id=spare) then raise exception 'Unused service was not deleted'; end if;
  insert into public.staff(salon_id,display_name) values(salon,'Linked staff') returning id into member;
  insert into public.services(salon_id,name) values(salon,'Linked service') returning id into service;
  insert into public.staff_service_assignments(salon_id,staff_id,service_id) values(salon,member,service);
  insert into public.staff_payroll_settings(salon_id,staff_id) values(salon,member);
  insert into public.staff_workdays(salon_id,staff_id,work_date) values(salon,member,current_date);
  delete from public.staff where id=member;
  if exists(select 1 from public.staff where id=member) then raise exception 'Setup blocked staff deletion'; end if;
  if exists(select 1 from public.staff_payroll_settings where staff_id=member) then raise exception 'Setup was not cleaned up'; end if;
  insert into public.staff(salon_id,display_name) values(salon,'History staff') returning id into member;
  insert into public.staff_service_assignments(salon_id,staff_id,service_id) values(salon,member,service);
  delete from public.services where id=service;
  if exists(select 1 from public.services where id=service) then raise exception 'Assignment blocked service deletion'; end if;
  insert into public.services(salon_id,name) values(salon,'History service') returning id into service;
  rejected:=false;
  begin perform public.delete_unused_salon_record('services',service,salon); exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Anonymous deletion was allowed'; end if;
  insert into auth.users(id,email) values(owner_auth,owner_auth::text || '@example.test');
  insert into public.users(id,auth_user_id,email,display_name,status)
    values(owner_user,owner_auth,owner_auth::text || '@example.test','Deletion test owner','active');
  perform public.seed_default_roles_for_account(account);
  select id into owner_role from public.roles where account_id=account and code='OWNER';
  insert into public.account_memberships(account_id,user_id,role_id,status,joined_at)
    values(account,owner_user,owner_role,'active',now());
  perform set_config('request.jwt.claim.sub',owner_auth::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  insert into public.services(salon_id,name) values(salon,'RPC unused service') returning id into spare;
  perform public.delete_unused_salon_record('services',spare,salon);
  if exists(select 1 from public.services where id=spare) then raise exception 'Owner RPC did not delete'; end if;
  insert into public.staff(salon_id,display_name) values(salon,'RPC unused staff') returning id into spare;
  perform public.delete_unused_salon_record('staff',spare,salon);
  if exists(select 1 from public.staff where id=spare) then raise exception 'Owner staff RPC did not delete'; end if;
  insert into public.locations(account_id,name) values(account,'Other salon') returning id into other_salon;
  rejected:=false;
  begin perform public.delete_unused_salon_record('services',service,other_salon); exception when raise_exception then rejected:=true; end;
  if not rejected then raise exception 'Cross-salon deletion was allowed'; end if;
  insert into public.staff(salon_id,display_name,account_user_id) values(salon,'Connected staff',owner_user) returning id into spare;
  insert into public.staff_salon_connection_requests(salon_id,staff_id,direction,initiated_by_user_id,target_email_normalized,token_hash,expires_at)
    values(salon,spare,'salon_invite',owner_user,'test@example.test','delete-test-token',now()+interval '1 day') returning id into invitation;
  perform public.delete_unused_salon_record('staff',spare,salon);
  if exists(select 1 from public.staff where id=spare) then raise exception 'Connection blocked staff deletion'; end if;
  if not exists(select 1 from public.users where id=owner_user) then raise exception 'Login account was deleted'; end if;
  if not exists(select 1 from public.staff_salon_connection_requests where id=invitation and staff_id is null and status='revoked' and token_hash is null) then raise exception 'Pending invitation remained actionable'; end if;
  insert into public.staff(salon_id,display_name) values(salon,'Financial staff') returning id into spare;
  insert into public.payroll_period_staff_inputs(salon_id,staff_id,period_start,period_end,cycle_type,bonus_amount)
    values(salon,spare,current_date,current_date+6,'weekly',100);
  rejected:=false;
  begin perform public.delete_unused_salon_record('staff',spare,salon); exception when foreign_key_violation then rejected:=true; end;
  if not rejected then raise exception 'Financial staff was deleted'; end if;
  if not exists(select 1 from public.payroll_period_staff_inputs where staff_id=spare and bonus_amount=100) then raise exception 'Payroll money was lost'; end if;
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  rejected:=false;
  begin perform public.delete_unused_salon_record('services',service,salon); exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Unauthorized user deletion was allowed'; end if;
  delete from public.staff_service_assignments where staff_id=member and service_id=service;
  insert into public.customers(location_id,name) values(salon,'History fixture') returning id into customer;
  insert into public.bookings(salon_id,customer_id,staff_id,start_at,end_at)
    values(salon,customer,member,now()+interval '1 day',now()+interval '1 day 1 hour') returning id into booking;
  insert into public.booking_lines(salon_id,booking_id,service_id,service_name_snapshot)
    values(salon,booking,service,'Historical service');
  rejected:=false;
  begin delete from public.services where id=service; exception when foreign_key_violation then rejected:=true; end;
  if not rejected then raise exception 'Historical service was deleted'; end if;
  rejected:=false;
  begin delete from public.staff where id=member; exception when foreign_key_violation then rejected:=true; end;
  if not rejected then raise exception 'Historical staff was deleted'; end if;
  if not exists(select 1 from public.bookings where id=booking and staff_id=member)
    or not exists(select 1 from public.booking_lines where booking_id=booking and service_id=service)
    then raise exception 'History references were lost'; end if;
  update public.bookings set status='cancelled' where id=booking;
  insert into public.pos_tickets(salon_id) values(salon) returning id into ticket;
  insert into public.pos_ticket_items(salon_id,pos_ticket_id,assigned_staff_id,service_id,unit_price,line_total)
    values(salon,ticket,member,service,45,45) returning id into item;
  rejected:=false;
  begin delete from public.staff where id=member; exception when foreign_key_violation then rejected:=true; end;
  if not rejected then raise exception 'Staff with POS money was deleted'; end if;
  rejected:=false;
  begin delete from public.services where id=service; exception when foreign_key_violation then rejected:=true; end;
  if not rejected then raise exception 'Service with POS money was deleted'; end if;
  if not exists(select 1 from public.pos_ticket_items where id=item and assigned_staff_id=member and service_id=service and line_total=45) then raise exception 'POS money was changed'; end if;
  -- Remove the disposable open-ticket fixture, then test cancelled bookings.
  delete from public.pos_ticket_items where id=item;
  delete from public.staff where id=member;
  delete from public.services where id=service;
  if not exists(select 1 from public.booking_lines where booking_id=booking and service_name_snapshot='Historical service') then raise exception 'Cancelled booking snapshot was lost'; end if;
end;
$$;
rollback;
