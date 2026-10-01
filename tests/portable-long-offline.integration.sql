begin;
insert into public.accounts(id,name,status) values('80fa2b4d-81b4-494a-bf46-5bd7818a1c51','Offline queue test','active');
insert into public.locations(id,account_id,name,status,country) values('0929a9ab-d089-4814-8ac8-6408512c65a1','80fa2b4d-81b4-494a-bf46-5bd7818a1c51','Offline queue test','active','US');
insert into public.pos_portable_access_keys(id,salon_id,access_id,passcode_salt,passcode_digest,label,is_active) values('a69a560e-6faa-4f69-bfe5-4571b668217e','0929a9ab-d089-4814-8ac8-6408512c65a1','test-a69a560e-6faa-4f69-bfe5-4571b668217e','test','861ac3bc-39e9-4069-964c-165d1b57610c','Test',true);
insert into public.staff(id,salon_id,display_name,is_active,pos_enabled) values('1b0c7f54-cd27-4558-a05c-b7eaf10a8946','0929a9ab-d089-4814-8ac8-6408512c65a1','Test staff',true,true);
insert into public.pos_settings(salon_id,staff_check_in_enabled) values('0929a9ab-d089-4814-8ac8-6408512c65a1',true);
insert into public.services(id,salon_id,name,category,base_price,duration_minutes,is_active) values('de07d2fa-2770-4dfb-992f-f3d4c0aca28d','0929a9ab-d089-4814-8ac8-6408512c65a1','Test service','Nails',50,45,true);

do $test$
declare k uuid:='a69a560e-6faa-4f69-bfe5-4571b668217e'; sig text:='65afefa6e482ff41429f772ae6ce64afeb43b370ce1555f10a42d0b99a75b2be'; st uuid:='1b0c7f54-cd27-4558-a05c-b7eaf10a8946'; t timestamptz:=now()-interval '400 days'; op uuid:=gen_random_uuid(); payload jsonb; r jsonb; again jsonb;
begin
 perform replay_pos_portable_operation(k,sig,gen_random_uuid(),'attendance',t,jsonb_build_object('staffId',st,'passcode','1234','eventType','CHECK_IN'));
 payload:=jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('staffId',st,'serviceLabel','Offline sale','amountInput','50','amountParts',jsonb_build_array(50),'total',50)),'tipAmount',0,'discountType','fixed_amount','discountValue',0);
 r:=replay_pos_portable_operation(k,sig,op,'receipt',t+interval '1 minute',payload);
 again:=replay_pos_portable_operation(k,sig,op,'receipt',t+interval '1 minute',payload);
 if r is distinct from again then raise exception 'Retry mismatch'; end if;
 if (select count(*) from pos_tickets where salon_id='0929a9ab-d089-4814-8ac8-6408512c65a1')<>1 then raise exception 'Duplicate';end if;
 if (select closed_at from pos_tickets where id=(r->>'ticketId')::uuid)<>t+interval '1 minute' then raise exception 'Original sale time lost'; end if;
 begin
  perform replay_pos_portable_operation(k,sig,gen_random_uuid(),'receipt',now()+interval '1 day',payload);
  raise exception 'Future accepted';
 exception when others then if SQLERRM='Future accepted' then raise; end if;end;
end;$test$;
rollback;
select '400-day-old attendance and ticket replay exactly once with original sale date; future time rejected' as passed;
