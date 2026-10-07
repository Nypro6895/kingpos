-- Self-contained RLS regression: all fixture changes roll back.
begin;
do $$
declare actor record; media_path text; fixture_auth uuid := gen_random_uuid(); fixture_user uuid := gen_random_uuid(); fixture_account uuid := gen_random_uuid(); fixture_salon uuid := gen_random_uuid(); fixture_staff uuid := gen_random_uuid();
begin
  insert into auth.users(id, email) values (fixture_auth, fixture_auth::text || '@example.test');
  insert into public.users(id, auth_user_id) values (fixture_user, fixture_auth);
  insert into public.accounts(id, name) values (fixture_account, 'Content RLS test');
  insert into public.locations(id, account_id, name) values (fixture_salon, fixture_account, 'Content RLS salon');
  insert into public.staff(id, salon_id, account_user_id, display_name) values (fixture_staff, fixture_salon, fixture_user, 'Posting staff');
  select fixture_staff as id, fixture_salon as salon_id, fixture_user as account_user_id, fixture_auth as auth_user_id into actor;
  update public.staff set salon_profile_content_posting_enabled = true where id = actor.id;
  perform set_config('request.jwt.claim.sub', actor.auth_user_id::text, true);
  media_path := actor.salon_id::text || '/looks/' || gen_random_uuid()::text || '/' || gen_random_uuid()::text || '.webp';
  set local role authenticated;
  if public.user_has_salon_permission(actor.salon_id, array['salon_profile.content.manage']) then
    raise exception 'Fixture still has manager permissions';
  end if;
  insert into public.salon_profile_media_assets (salon_id, bucket, object_path, purpose, upload_intent, uploaded_by_user_id, status)
    values (actor.salon_id, 'salon-profile-media', media_path, 'look', 'content', actor.account_user_id, 'pending');
  if not public.user_can_manage_salon_profile_media(media_path, array['salon_profile.content.manage']) then
    raise exception 'Own reserved content upload denied';
  end if;
  if public.user_can_manage_salon_profile_media(actor.salon_id::text || '/updates/' || gen_random_uuid()::text || '.webp', array['salon_profile.content.manage']) then
    raise exception 'Unreserved content upload allowed';
  end if;
  begin
    insert into public.salon_profile_media_assets (salon_id, bucket, object_path, purpose, upload_intent, uploaded_by_user_id, status)
      values (actor.salon_id, 'salon-profile-media', actor.salon_id::text || '/profile/logo/' || gen_random_uuid()::text || '.webp', 'logo', 'identity', actor.account_user_id, 'pending');
    raise exception 'Staff identity upload allowed';
  exception when insufficient_privilege then null; end;
  reset role;
  update public.staff set salon_profile_content_posting_enabled = false where id = actor.id;
  set local role authenticated;
  begin
    insert into public.salon_profile_media_assets (salon_id, bucket, object_path, purpose, upload_intent, uploaded_by_user_id, status)
      values (actor.salon_id, 'salon-profile-media', actor.salon_id::text || '/updates/' || gen_random_uuid()::text || '.webp', 'update', 'content', actor.account_user_id, 'pending');
    raise exception 'Disabled posting permission allowed';
  exception when insufficient_privilege then null; end;
  reset role;
end;
$$;
rollback;
