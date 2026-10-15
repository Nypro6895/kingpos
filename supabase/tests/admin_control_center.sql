-- Run against a migrated database. Every fixture and mutation rolls back.
begin;
do $test$
declare
 owner_id uuid:=gen_random_uuid(); owner_auth uuid:=gen_random_uuid();
 recipient uuid:=gen_random_uuid(); recipient_auth uuid:=gen_random_uuid();
 support_id uuid:=gen_random_uuid(); support_auth uuid:=gen_random_uuid();
 auditor_id uuid:=gen_random_uuid(); auditor_auth uuid:=gen_random_uuid();
 qa_account_id uuid:=gen_random_uuid(); salon_id uuid:=gen_random_uuid(); role_id uuid;
 request_id uuid:=gen_random_uuid(); session_id uuid:=gen_random_uuid(); membership_id uuid;
 result jsonb; failure boolean; amount integer;
begin
 insert into users(id,auth_user_id,display_name,email,phone,status) values
 (owner_id,owner_auth,'Admin control QA owner','admin-qa-owner@example.invalid','+15550001001','active'),
 (recipient,recipient_auth,'Admin control QA recipient','admin-qa-recipient@example.invalid','+15550001002','active'),
 (support_id,support_auth,'Admin control QA support','admin-qa-support@example.invalid',null,'active'),
 (auditor_id,auditor_auth,'Admin control QA auditor','admin-qa-auditor@example.invalid',null,'active');
 insert into platform_admin_memberships(user_id,role_id,status) select owner_id,id,'active' from platform_admin_roles where slug='platform_owner';
 insert into platform_admin_memberships(user_id,role_id,status) select support_id,id,'active' from platform_admin_roles where slug='support_agent';
 insert into platform_admin_memberships(user_id,role_id,status) select auditor_id,id,'active' from platform_admin_roles where slug='auditor';
 perform set_config('request.jwt.claim.sub',owner_auth::text,true);

 result:=get_platform_admin_user_detail(recipient);
 if result->'user'->>'id'<>recipient::text or result->'user'->>'email'<>'admin-qa-recipient@example.invalid' then raise exception 'User detail failed'; end if;
 perform list_platform_admin_notes('user',recipient,1,25);
 result:=search_platform_admin_users_v2(1,25,'Admin control QA recipient','active',null,null,'name_asc');
 if (result->>'total')::integer<>1 then raise exception 'User search failed'; end if;
 failure:=false;
 begin perform search_platform_admin_users_v2(1,25,null,null,null,null,'unsafe'); exception when others then failure:=true; end;
 if not failure then raise exception 'Invalid sort was accepted'; end if;

 perform update_platform_admin_user_profile_v2(recipient,'QA profile updated','QA','Recipient','+15550001002','QA profile update');
 if (select display_name from users where id=recipient)<>'QA profile updated' then raise exception 'Profile edit failed'; end if;
 insert into account_login_sessions(id,user_id,auth_user_id) values(session_id,recipient,recipient_auth);
 perform admin_set_user_access(recipient,'QA suspension',true);
 if (select status from users where id=recipient)<>'suspended' or (select revoked_at from account_login_sessions where id=session_id) is null then raise exception 'Suspension did not revoke sessions'; end if;
 perform admin_set_user_access(recipient,'QA restoration',false);
 if (select status from users where id=recipient)<>'active' then raise exception 'Restoration failed'; end if;
 perform get_platform_admin_user_security(recipient);

 result:=send_platform_admin_notification(recipient,'QA title','QA message','QA notification',request_id);
 if result->>'status'<>'delivered' then raise exception 'In-app delivery failed'; end if;
 perform send_platform_admin_notification(recipient,'QA title','QA message','QA notification',request_id);
 select count(*) into amount from app_notifications where event_key='admin-message:'||request_id::text;
 if amount<>1 then raise exception 'Notification idempotency failed'; end if;
 result:=list_platform_admin_notifications(1,25,recipient,null);
 if (result->>'total')::integer<>1 then raise exception 'Notification history failed'; end if;
 insert into notification_preferences(user_id,category,enabled) values(recipient,'team',false);
 result:=send_platform_admin_notification(recipient,'Muted title','Muted message','QA preference',gen_random_uuid());
 if result->>'status'<>'suppressed' then raise exception 'Recipient preference was not respected'; end if;

 perform schedule_platform_admin_user_deletion(recipient,'QA schedule','DELETE',true);
 if (select status from users where id=recipient)<>'pending_deletion' or (select deletion_scheduled_for from users where id=recipient)<>now()+interval '30 days' then raise exception 'Deletion scheduling failed'; end if;
 failure:=false;
 begin perform admin_set_user_access(recipient,'QA bypass attempt',false); exception when others then failure:=true; end;
 if not failure then raise exception 'Restoration bypassed pending deletion'; end if;
 perform cancel_platform_admin_user_deletion(recipient,'QA cancel');
 if (select status from users where id=recipient)<>'active' then raise exception 'Deletion cancellation failed'; end if;
 perform admin_set_user_access(recipient,'QA suspension before deletion',true);
 failure:=false;
 begin perform schedule_platform_admin_user_deletion(recipient,'QA schedule suspended','DELETE',true); exception when others then failure:=true; end;
 if not failure or (select status from users where id=recipient)<>'suspended' then raise exception 'Deletion bypassed suspension'; end if;
 perform admin_set_user_access(recipient,'QA restore again',false);

 insert into accounts(id,name) values(qa_account_id,'Admin control QA business');
 perform seed_default_roles_for_account(qa_account_id);
 select id into role_id from roles where roles.account_id=qa_account_id and code='OWNER';
 insert into account_memberships(account_id,user_id,role_id,status) values(qa_account_id,recipient,role_id,'active');
 insert into locations(id,account_id,name,status) values(salon_id,qa_account_id,'Admin control QA salon','active');
 result:=get_platform_admin_deletion_impact(recipient);
 if (result->>'blocked')::boolean is not true then raise exception 'Last-owner impact was not detected'; end if;
 select id into membership_id from account_memberships where user_id=recipient and account_memberships.account_id=qa_account_id;
 failure:=false;
 begin perform update_platform_admin_user_membership(recipient,membership_id,'business','STAFF','inactive','QA owner guard'); exception when others then failure:=true; end;
 if not failure then raise exception 'Owner membership was changed directly'; end if;
 select id into role_id from roles where roles.account_id=qa_account_id and code='MANAGER';
 insert into account_memberships(account_id,user_id,role_id,status) values(qa_account_id,support_id,role_id,'active') returning id into membership_id;
 perform update_platform_admin_user_membership(support_id,membership_id,'business','STAFF','suspended','QA membership change');
 if (select status from account_memberships where id=membership_id)<>'suspended' then raise exception 'Membership update failed'; end if;
 failure:=false;
 begin perform schedule_platform_admin_user_deletion(recipient,'QA last-owner guard','DELETE',true); exception when others then failure:=true; end;
 if not failure then raise exception 'Last-owner deletion was accepted'; end if;
 failure:=false;
 begin perform schedule_platform_admin_user_deletion(owner_id,'QA self guard','DELETE',true); exception when others then failure:=true; end;
 if not failure then raise exception 'Self deletion was accepted'; end if;
 result:=search_platform_admin_users_v2(1,25,null,null,'owner',qa_account_id,'created_desc');
 if (result->>'total')::integer<>1 then raise exception 'Business/role filters failed'; end if;
 perform get_platform_admin_work_queues();
 perform get_platform_admin_case_assignees();
 result:=search_platform_admin_audit_logs_v2(1,100,null,null,null,recipient,null,null,null);
 if (result->>'total')::integer<5 then raise exception 'User audit timeline missing'; end if;

 perform set_config('request.jwt.claim.sub',auditor_auth::text,true);
 result:=get_platform_admin_user_detail(recipient);
 if result->'user'->>'email' is not null or result->'user'->>'phone' is not null then raise exception 'Sensitive profile fields leaked to auditor'; end if;
 result:=search_platform_admin_audit_logs_v2(1,100,null,null,null,recipient,null,null,null);
 if exists(select 1 from jsonb_array_elements(result->'items') item where item->'before_data' ? 'email' or item->'after_data' ? 'phone') then raise exception 'Sensitive audit fields leaked'; end if;
 failure:=false;
 begin perform send_platform_admin_notification(recipient,'No permission','No permission','QA guard',gen_random_uuid()); exception when others then failure:=true; end;
 if not failure then raise exception 'Auditor sent notification'; end if;

 perform set_config('request.jwt.claim.sub',support_auth::text,true);
 failure:=false;
 begin perform schedule_platform_admin_user_deletion(recipient,'QA forbidden','DELETE',true); exception when others then failure:=true; end;
 if not failure then raise exception 'Support scheduled deletion'; end if;
 failure:=false;
 begin perform update_platform_admin_user_profile_v2(recipient,'Forbidden',null,null,null,'QA forbidden'); exception when others then failure:=true; end;
 if not failure then raise exception 'Support edited profile'; end if;
 perform set_config('request.jwt.claim.sub','',true);
 failure:=false;
 begin perform search_platform_admin_users_v2(); exception when others then failure:=true; end;
 if not failure then raise exception 'Unauthenticated user read admin data'; end if;
end;
$test$;
rollback;
