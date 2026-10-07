begin;
do $$
declare auth_id uuid := gen_random_uuid(); user_id_value uuid := gen_random_uuid(); account_id_value uuid := gen_random_uuid(); salon uuid := gen_random_uuid(); look uuid := gen_random_uuid(); staff_id uuid := gen_random_uuid(); owner_role uuid := gen_random_uuid(); n integer;
begin
  insert into auth.users(id,email) values(auth_id, auth_id::text || '@example.test');
  insert into public.users(id,auth_user_id) values(user_id_value,auth_id);
  insert into public.accounts(id,name) values(account_id_value,'Profile settings test');
  insert into public.locations(id,account_id,name) values(salon,account_id_value,'Profile settings salon');
  insert into public.salon_settings(salon_id,business_name,public_discovery_enabled) values(salon,'Profile settings salon',true);
  insert into public.staff(id,salon_id,account_user_id,display_name,salon_profile_content_posting_enabled) values(staff_id,salon,user_id_value,'Posting staff',true);
  perform set_config('request.jwt.claim.sub',auth_id::text,true);
  insert into public.salon_profile_looks(id,salon_id,title,status,published_at) values(look,salon,'Published fixture','published',now());
  insert into public.salon_profile_preferences(salon_id,show_services,show_team,allow_staff_posts,allow_saves,allow_comments) values(salon,false,false,false,false,false);
  set local role authenticated;
  update public.salon_profile_preferences set show_services=true,show_featured=false,show_customer_reviews=false,customer_review_count=2 where salon_id=salon;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'Staff changed salon profile preferences'; end if;
  begin
    insert into public.salon_profile_looks(salon_id,title,status,author_staff_id,author_user_id,created_by_user_id) values(salon,'Blocked staff post','draft',staff_id,user_id_value,user_id_value);
    raise exception 'Staff posting was not blocked';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.salon_profile_look_saves(look_id,user_id) values(look,user_id_value);
    raise exception 'Saving was not blocked';
  exception when insufficient_privilege then null; end;
  reset role;
  begin
    insert into public.salon_profile_comments(salon_id,look_id,author_user_id,body) values(salon,look,user_id_value,'Blocked comment');
    raise exception 'Commenting was not blocked even through privileged writes';
  exception when insufficient_privilege then null; end;
  update public.salon_profile_preferences set allow_staff_posts=true,allow_saves=true,allow_comments=true where salon_id=salon;
  set local role authenticated;
  insert into public.salon_profile_looks(salon_id,title,status,author_staff_id,author_user_id,created_by_user_id) values(salon,'Allowed staff post','draft',staff_id,user_id_value,user_id_value);
  insert into public.salon_profile_look_saves(look_id,user_id) values(look,user_id_value);
  insert into public.salon_profile_comments(salon_id,look_id,author_user_id,body) values(salon,look,user_id_value,'Allowed comment');
  reset role;
  if not exists(select 1 from public.salon_profile_look_saves where look_id=look) then raise exception 'Save did not persist'; end if;
  if not exists(select 1 from public.staff where id=staff_id and is_active and salon_profile_content_posting_enabled) then raise exception 'Visibility changed staff availability'; end if;
  insert into public.roles(id,account_id,name,code) values(owner_role,account_id_value,'Owner','OWNER');
  insert into public.account_memberships(account_id,user_id,role_id,status) values(account_id_value,user_id_value,owner_role,'active');
  set local role authenticated;
  update public.salon_profile_preferences set show_services=true,show_team=true,show_featured=false,show_customer_reviews=false,customer_review_count=2 where salon_id=salon;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'Owner could not save profile preferences'; end if;
  reset role;
  if (select customer_review_count from public.salon_profile_preferences where salon_id=salon) <> 2 then raise exception 'Review highlight count did not persist'; end if;
  if (select show_customer_reviews from public.salon_profile_preferences where salon_id=salon) then raise exception 'Review visibility did not persist'; end if;
  if (select show_featured from public.salon_profile_preferences where salon_id=salon) then raise exception 'Featured visibility did not persist'; end if;
end;
$$;
rollback;
