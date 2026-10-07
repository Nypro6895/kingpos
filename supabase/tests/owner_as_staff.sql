begin;
do $$
declare a uuid:=gen_random_uuid(); u uuid:=gen_random_uuid(); au uuid:=gen_random_uuid();
  r uuid; salon uuid; sid uuid; result jsonb; blocked boolean:=false;
begin
  insert into auth.users(id,email) values(au,'owner-staff@example.test');
  insert into public.users(id,auth_user_id,display_name,first_name,last_name,email,phone)
  values(u,au,'Owner Stylist','Owner','Stylist','owner-staff@example.test','5551234567');
  insert into public.accounts(id,name) values(a,'Owner Staff Test');
  perform public.seed_default_roles_for_account(a);
  select id into r from public.roles where account_id=a and code='OWNER';
  insert into public.account_memberships(account_id,user_id,role_id,status) values(a,u,r,'active');
  perform set_config('request.jwt.claim.sub',au::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  result:=public.create_account_salon_with_owner_staff(a,'owner-staff','Owner Staff Salon',true);
  salon:=(result->>'salon_id')::uuid; sid:=(result->>'staff_id')::uuid;
  if not exists(select 1 from public.staff where id=sid and account_user_id=u and salon_id=salon
    and first_name='Owner' and last_name='Stylist' and email='owner-staff@example.test' and phone='5551234567') then
    raise exception 'Personal data was not copied';
  end if;
  if not public.lifecycle_user_is_salon_owner(salon,u,true) then raise exception 'Ownership lost'; end if;
  perform public.become_salon_owner_staff(salon);
  perform public.create_account_salon_with_owner_staff(a,'owner-staff','Owner Staff Salon',true);
  if (select count(*) from public.staff where salon_id=salon and account_user_id=u)<>1 then
    raise exception 'Duplicate self-enrollment';
  end if;
  result:=public.create_account_salon_with_owner_staff(a,'owner-only','Owner Only Salon',false);
  salon:=(result->>'salon_id')::uuid;
  if exists(select 1 from public.staff where salon_id=salon) then raise exception 'Unchecked option created staff'; end if;
  perform public.become_salon_owner_staff(salon);
  if not exists(select 1 from public.staff where salon_id=salon and account_user_id=u) then raise exception 'Later enrollment failed'; end if;
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  begin perform public.become_salon_owner_staff(salon); exception when others then blocked:=true; end;
  if not blocked then raise exception 'Unauthorized enrollment allowed'; end if;
end;$$;
rollback;
