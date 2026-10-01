begin;
insert into public.accounts(id,name,status) values('80fa2b4d-81b4-494a-bf46-5bd7818a1c51','Offline queue test','active');
insert into public.locations(id,account_id,name,status,country) values('0929a9ab-d089-4814-8ac8-6408512c65a1','80fa2b4d-81b4-494a-bf46-5bd7818a1c51','Offline queue test','active','US');
insert into public.pos_portable_access_keys(id,salon_id,access_id,passcode_salt,passcode_digest,label,is_active) values('a69a560e-6faa-4f69-bfe5-4571b668217e','0929a9ab-d089-4814-8ac8-6408512c65a1','test-a69a560e-6faa-4f69-bfe5-4571b668217e','test','861ac3bc-39e9-4069-964c-165d1b57610c','Test',true);
insert into public.staff(id,salon_id,display_name,is_active,pos_enabled) values('1b0c7f54-cd27-4558-a05c-b7eaf10a8946','0929a9ab-d089-4814-8ac8-6408512c65a1','Test staff',true,true);
insert into public.pos_settings(salon_id,staff_check_in_enabled) values('0929a9ab-d089-4814-8ac8-6408512c65a1',true);
insert into public.services(id,salon_id,name,category,base_price,duration_minutes,is_active) values('de07d2fa-2770-4dfb-992f-f3d4c0aca28d','0929a9ab-d089-4814-8ac8-6408512c65a1','Test service','Nails',50,45,true);

do $test$
declare k uuid:='a69a560e-6faa-4f69-bfe5-4571b668217e'; sig text:='65afefa6e482ff41429f772ae6ce64afeb43b370ce1555f10a42d0b99a75b2be'; salon uuid:='0929a9ab-d089-4814-8ac8-6408512c65a1'; st uuid:='1b0c7f54-cd27-4558-a05c-b7eaf10a8946'; c uuid:=gen_random_uuid(); v uuid:=gen_random_uuid(); op uuid:=gen_random_uuid(); r jsonb; r2 jsonb; count_before int;
begin
 perform public.replay_pos_portable_operation(k,sig,gen_random_uuid(),'attendance',now(),jsonb_build_object('staffId',st,'passcode','1234','eventType','CHECK_IN'));
 select count(*) into count_before from public.staff_attendance_events where salon_id=salon;
 r:=public.replay_pos_portable_operation(k,sig,gen_random_uuid(),'attendance',now(),jsonb_build_object('staffId',st,'passcode','1234','eventType','CHECK_IN'));
 if r->>'reconciled'<>'true' or r->>'status'<>'working' then raise exception 'Duplicate check-in not reconciled'; end if;
 if (select count(*) from public.staff_attendance_events where salon_id=salon)<>count_before then raise exception 'Duplicate attendance event'; end if;
 begin
  perform public.replay_pos_portable_operation(k,sig,gen_random_uuid(),'attendance',now(),jsonb_build_object('staffId',st,'passcode','wrong','eventType','CHECK_IN'));
  raise exception 'Bad PIN accepted';
 exception when others then if SQLERRM='Bad PIN accepted' then raise; end if; end;
 insert into public.customers(id,location_id,name,phone,status,source) values(c,salon,'Waiting test','2025550188','active','manual');
 insert into public.customer_visits(id,salon_id,customer_id) values(v,salon,c);
 if jsonb_array_length(public.get_pos_portable_waiting_queue(k,sig))<>1 then raise exception 'Queue missing customer'; end if;
 perform public.replay_pos_portable_operation(k,sig,gen_random_uuid(),'visit',now(),jsonb_build_object('visitId',v,'action','edit','name','Edited guest','phone','2025550199'));
 if (select name from public.customers where id=c)<>'Edited guest' then raise exception 'Edit failed'; end if;
 r:=public.replay_pos_portable_operation(k,sig,op,'visit',now(),jsonb_build_object('visitId',v,'action','left'));
 r2:=public.replay_pos_portable_operation(k,sig,op,'visit',now(),jsonb_build_object('visitId',v,'action','left'));
 if r<>r2 then raise exception 'Replay mismatch'; end if;
 if (select cancelled_reason from public.customer_visits where id=v)<>'Customer left before service.' then raise exception 'Left history missing'; end if;
 if jsonb_array_length(public.get_pos_portable_waiting_queue(k,sig))<>0 then raise exception 'Left customer still waiting'; end if;
 v:=gen_random_uuid();
 insert into public.customer_visits(id,salon_id,customer_id) values(v,salon,c);
 r:=public.replay_pos_portable_operation(k,sig,gen_random_uuid(),'receipt',now(),jsonb_build_object('customerId',c,'customerVisitId',v,'lines',jsonb_build_array(jsonb_build_object('staffId',st,'serviceId',null,'serviceLabel','Test','amountInput','50','amountParts',jsonb_build_array(50),'total',50)),'tipAmount',0,'discountType','fixed_amount','discountValue',0));
 if (select status from public.customer_visits where id=v)<>'completed' then raise exception 'Ticket did not close waiting visit'; end if;
 if (select customer_id from public.pos_tickets where id=(r->>'ticketId')::uuid) is distinct from c then raise exception 'Customer history not linked'; end if;
 begin
  perform public.get_pos_portable_waiting_queue(k,'wrong'); raise exception 'Bad session accepted';
 exception when others then if SQLERRM='Bad session accepted' then raise; end if; end;
end; $test$;
rollback;
