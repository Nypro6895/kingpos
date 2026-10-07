begin;
do $$
declare a uuid;s uuid;u uuid;au uuid;owner_id uuid;cfg public.platform_twilio_settings;
begin
 if has_table_privilege('authenticated','public.platform_twilio_settings','SELECT') or has_table_privilege('anon','public.platform_twilio_settings','SELECT') then raise exception 'Client can read settings'; end if;
 if has_function_privilege('authenticated','public.save_platform_twilio_settings(uuid,text,jsonb)','EXECUTE') then raise exception 'Client can save settings'; end if;
 begin
 perform public.save_platform_twilio_settings(gen_random_uuid(),repeat('x',100),'{}');
 raise exception 'Unexpected unauthorized save';
 exception when others then
 if sqlerrm <> 'Platform owner access required.' then raise; end if;
 end;
 if exists(select 1 from public.platform_admin_audit_logs where action='twilio.settings.update' and (after_data ? 'authToken' or before_data ? 'authToken')) then raise exception 'Token leaked into audit'; end if;
 select * into cfg from public.platform_twilio_settings where id;
 if cfg.id is not null then
 select m.user_id into owner_id from public.platform_admin_memberships m join public.platform_admin_roles r on r.id=m.role_id where m.status='active' and r.slug='platform_owner' limit 1;
 au:=gen_random_uuid();u:=gen_random_uuid();
 insert into auth.users(id,email) values(au,'twilio-qa-'||au||'@example.invalid');
 insert into public.users(id,auth_user_id,email) values(u,au,'twilio-qa-'||au||'@example.invalid');
 insert into public.accounts(name,status) values('Twilio QA','active') returning id into a;
 insert into public.locations(account_id,name,status) values(a,'Twilio QA','active') returning id into s;
 insert into public.business_claim_requests(salon_id,applicant_user_id,status,channel,expires_at) values(s,u,'otp_pending','sms',now()+interval '10 minutes');
 begin
 perform public.save_platform_twilio_settings(owner_id,cfg.encrypted_config,jsonb_set(cfg.public_config,'{verifyServiceSid}','"VA-other"'));
 raise exception 'Changed service during a live challenge';
 exception when others then
 if sqlerrm <> 'Wait for current claim codes to expire before changing the account or Verify service.' then raise; end if;
 end;
 perform public.save_platform_twilio_settings(owner_id,cfg.encrypted_config,cfg.public_config);
 end if;
end $$;
rollback;
