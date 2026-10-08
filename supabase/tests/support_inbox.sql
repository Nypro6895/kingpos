-- Synthetic fixtures only. All messages, settings and audit events roll back.
begin;
do $test$
declare
 owner_id uuid:=gen_random_uuid(); owner_auth uuid:=gen_random_uuid();
 support_id uuid:=gen_random_uuid(); support_auth uuid:=gen_random_uuid();
 auditor_id uuid:=gen_random_uuid(); auditor_auth uuid:=gen_random_uuid();
 thread_id uuid:=gen_random_uuid(); reply_id uuid:=gen_random_uuid(); note_id uuid:=gen_random_uuid();
 fingerprint text:=md5(thread_id::text)||md5(reply_id::text); email text:='qa-'||thread_id::text||'@example.invalid';
 result jsonb; failed boolean; i integer;
begin
 insert into users(id,auth_user_id,display_name,email,status) values
 (owner_id,owner_auth,'Support QA owner','support-owner-'||owner_id::text||'@example.invalid','active'),
 (support_id,support_auth,'Support QA agent','support-agent-'||support_id::text||'@example.invalid','active'),
 (auditor_id,auditor_auth,'Support QA auditor','support-auditor-'||auditor_id::text||'@example.invalid','active');
 insert into platform_admin_memberships(user_id,role_id,status) select owner_id,id,'active' from platform_admin_roles where slug='platform_owner';
 insert into platform_admin_memberships(user_id,role_id,status) select support_id,id,'active' from platform_admin_roles where slug='support_agent';
 insert into platform_admin_memberships(user_id,role_id,status) select auditor_id,id,'active' from platform_admin_roles where slug='auditor';

 if has_table_privilege('anon','public.support_inbox_threads','select') or has_table_privilege('authenticated','public.support_inbox_threads','select') or has_table_privilege('authenticated','public.platform_support_email_settings','select') then raise exception 'Support table privacy failed'; end if;
 if has_function_privilege('anon','public.submit_support_contact(uuid,text,text,text,text)','execute') or has_function_privilege('authenticated','public.submit_support_contact(uuid,text,text,text,text)','execute') or has_function_privilege('authenticated','public.finish_support_reply(uuid,uuid,text,text,text)','execute') then raise exception 'Trusted server function is exposed'; end if;
 if not has_function_privilege('service_role','public.submit_support_contact(uuid,text,text,text,text)','execute') then raise exception 'Server submission is unavailable'; end if;

 result:=submit_support_contact(thread_id,'  Test Customer  ',upper(email),'Help with booking',fingerprint);
 if result->>'reference'<>upper(left(thread_id::text,8)) then raise exception 'Contact reference failed'; end if;
 perform submit_support_contact(thread_id,'Test Customer',email,'Help with booking',fingerprint);
 if (select count(*) from support_inbox_threads where id=thread_id)<>1 then raise exception 'Submission idempotency failed'; end if;
 failed:=false; begin perform submit_support_contact(thread_id,'Changed name',email,'Help with booking',fingerprint); exception when others then failed:=true; end;
 if not failed then raise exception 'Reused submission identifier accepted changed content'; end if;
 failed:=false; begin perform submit_support_contact(gen_random_uuid(),'Test','invalid-email','Message',fingerprint); exception when others then failed:=true; end;
 if not failed then raise exception 'Invalid email was accepted'; end if;
 failed:=false; begin perform submit_support_contact(gen_random_uuid(),'Test',email,'   ',fingerprint); exception when others then failed:=true; end;
 if not failed then raise exception 'Empty message was accepted'; end if;
 for i in 1..2 loop perform submit_support_contact(gen_random_uuid(),'Test Customer',email,'Additional request '||i,fingerprint); end loop;
 failed:=false; begin perform submit_support_contact(gen_random_uuid(),'Test Customer',email,'Too many requests',fingerprint); exception when others then failed:=true; end;
 if not failed then raise exception 'Email rate limit failed'; end if;
 for i in 1..2 loop perform submit_support_contact(gen_random_uuid(),'Test Customer','network-'||gen_random_uuid()::text||'@example.invalid','Network request '||i,fingerprint); end loop;
 failed:=false; begin perform submit_support_contact(gen_random_uuid(),'Test Customer','network-'||gen_random_uuid()::text||'@example.invalid','Too many network requests',fingerprint); exception when others then failed:=true; end;
 if not failed then raise exception 'Network rate limit failed'; end if;

 perform set_config('request.jwt.claim.sub',support_auth::text,true);
 result:=list_platform_support_inbox(1,1,email,'new');
 if (result->>'total')::integer<>3 or jsonb_array_length(result->'items')<>1 then raise exception 'Inbox filter before pagination failed'; end if;
 result:=get_platform_support_thread(thread_id);
 if result->'thread'->>'customer_email'<>email or result->'thread' ? 'network_hash' then raise exception 'Contact detail or private network hash failed'; end if;
 perform update_platform_support_thread(thread_id,'in_progress','me');
 if (select assigned_user_id from support_inbox_threads where id=thread_id)<>support_id then raise exception 'Assignment failed'; end if;
 perform record_platform_support_note(thread_id,note_id,'Internal QA note','note');
 perform record_platform_support_note(thread_id,note_id,'Internal QA note','note');
 if (select count(*) from support_inbox_messages where id=note_id)<>1 then raise exception 'Note idempotency failed'; end if;
 result:=prepare_platform_support_reply(thread_id,reply_id,'A test reply. No real email is sent.');
 if not (result->>'should_send')::boolean or result->>'to'<>email then raise exception 'Reply recipient is not fixed to the original contact'; end if;
 result:=prepare_platform_support_reply(thread_id,reply_id,'A test reply. No real email is sent.');
 if (result->>'should_send')::boolean then raise exception 'Duplicate reply would send'; end if;
 failed:=false; begin perform prepare_platform_support_reply(thread_id,gen_random_uuid(),'A duplicate while sending'); exception when others then failed:=true; end;
 if not failed then raise exception 'An unconfirmed reply did not block another email'; end if;
 perform finish_support_reply(reply_id,support_id,'unknown',null,'QA uncertain delivery');
 perform resolve_platform_support_delivery(reply_id,false,'QA provider logs confirmed no send');
 result:=prepare_platform_support_reply(thread_id,gen_random_uuid(),'A fresh confirmed reply');
 perform finish_support_reply((result->>'id')::uuid,support_id,'sent','qa-provider-reference',null);
 if not exists(select 1 from support_inbox_messages where id=(result->>'id')::uuid and provider_message_id='qa-provider-reference' and delivery_status='sent') then raise exception 'Reply history failed'; end if;
 perform update_platform_support_thread(thread_id,'resolved','unassign');
 result:=list_platform_support_inbox(1,25,email,'resolved');
 if (result->>'total')::integer<>1 then raise exception 'Resolved filter failed'; end if;
 perform update_platform_support_thread(thread_id,'spam','keep');
 failed:=false; begin perform prepare_platform_support_reply(thread_id,gen_random_uuid(),'Do not email spam'); exception when others then failed:=true; end;
 if not failed then raise exception 'Spam reply was accepted'; end if;
 failed:=false; begin perform save_platform_support_email_settings(support_id,repeat('x',80),'{"from":"support@reylumi.com"}'::jsonb); exception when others then failed:=true; end;
 if not failed then raise exception 'Support agent changed provider settings'; end if;
 perform save_platform_support_email_settings(owner_id,repeat('x',80),'{"from":"support@reylumi.com","enabled":false,"keyConfigured":false,"domainVerified":false}'::jsonb);
 failed:=false; begin perform save_platform_support_email_settings(owner_id,repeat('x',80),'{"apiKey":"never expose a secret"}'::jsonb); exception when others then failed:=true; end;
 if not failed then raise exception 'Secrets accepted in public configuration'; end if;
 if not exists(select 1 from platform_admin_audit_logs where target_id=thread_id and action='support.email.sent') then raise exception 'Support audit trail missing'; end if;

 perform set_config('request.jwt.claim.sub',auditor_auth::text,true);
 failed:=false; begin perform get_platform_support_thread(thread_id); exception when others then failed:=true; end;
 if not failed then raise exception 'Auditor read private contact messages'; end if;
 perform set_config('request.jwt.claim.sub','',true);
 failed:=false; begin perform list_platform_support_inbox(); exception when others then failed:=true; end;
 if not failed then raise exception 'Anonymous inbox read was accepted'; end if;
end;$test$;
rollback;
