-- Run with the migration applied; all fixtures are rolled back.
begin;
do $test$
declare au uuid:=gen_random_uuid(); u uuid:=gen_random_uuid(); a uuid; s uuid; r uuid;
begin
 insert into auth.users(id,email) values(au,'windows-pos-'||au||'@example.invalid');
 insert into public.users(id,auth_user_id,email) values(u,au,'windows-pos-'||au||'@example.invalid');
 insert into public.accounts(name,status) values('Windows prompt QA','active') returning id into a;
 insert into public.locations(account_id,name,status) values(a,'Windows prompt QA','active') returning id into s;
 perform public.seed_default_roles_for_account(a);
 select id into r from public.roles where account_id=a and code='OWNER';
 perform set_config('request.jwt.claim.sub',au::text,true);
 if public.claim_windows_pos_download_prompt(repeat('a',64),true) then raise exception 'Non-owner received prompt'; end if;
 insert into public.salon_memberships(account_id,salon_id,user_id,role_id,status,joined_at) values(a,s,u,r,'active',now());
 if not public.claim_windows_pos_download_prompt(repeat('a',64),false) then raise exception 'New owner did not receive prompt'; end if;
 if public.claim_windows_pos_download_prompt(repeat('a',64),true) then raise exception 'Repeated within login'; end if;
 if public.claim_windows_pos_download_prompt(repeat('b',64),false) then raise exception 'Prompt before first POS access'; end if;
 if not public.claim_windows_pos_download_prompt(repeat('b',64),true) then raise exception 'Next login did not remind'; end if;
 update public.windows_pos_download_preferences set downloaded_at=now(),remind_after_download=false where user_id=u;
 if public.claim_windows_pos_download_prompt(repeat('c',64),true) then raise exception 'Download did not suppress'; end if;
 update public.windows_pos_download_preferences set remind_after_download=true where user_id=u;
 if not public.claim_windows_pos_download_prompt(repeat('c',64),true) then raise exception 'Later after download did not override'; end if;
 update public.windows_pos_download_preferences set never_remind=true where user_id=u;
 update public.salon_memberships set status='active' where user_id=u;
 if public.claim_windows_pos_download_prompt(repeat('d',64),true) then raise exception 'New owner event overrode never-remind'; end if;
 if has_table_privilege('anon','public.windows_pos_download_preferences','select') then raise exception 'Preferences exposed to anonymous users'; end if;
end;
$test$;
rollback;
