begin;

do $$
declare
  v_account_id uuid := '22000000-0000-4000-8000-000000000001';
  v_owner_auth_user_id uuid := '22000000-0000-4000-8000-000000000002';
  v_owner_public_user_id uuid := '22000000-0000-4000-8000-000000000003';
  v_other_auth_user_id uuid := '22000000-0000-4000-8000-000000000004';
  v_other_public_user_id uuid := '22000000-0000-4000-8000-000000000005';
  v_salon_id uuid := '22000000-0000-4000-8000-000000000006';
begin
  insert into auth.users (id, email)
  values
    (v_owner_auth_user_id, 'salon-profile-content-owner@example.test'),
    (v_other_auth_user_id, 'salon-profile-content-other@example.test');

  insert into public.users (id, auth_user_id, email, display_name)
  values
    (
      v_owner_public_user_id,
      v_owner_auth_user_id,
      'salon-profile-content-owner@example.test',
      'Salon Profile Content Owner'
    ),
    (
      v_other_public_user_id,
      v_other_auth_user_id,
      'salon-profile-content-other@example.test',
      'Salon Profile Content Other'
    );

  insert into public.accounts (id, name, status)
  values (v_account_id, 'Salon Profile Content Account', 'active');

  perform public.seed_default_roles_for_account(v_account_id);

  insert into public.account_memberships (
    account_id,
    user_id,
    role_id,
    status,
    joined_at
  )
  select v_account_id, v_owner_public_user_id, roles.id, 'active', now()
  from public.roles
  where roles.account_id = v_account_id
    and roles.code = 'OWNER';

  insert into public.locations (id, account_id, name, status)
  values (v_salon_id, v_account_id, 'Salon Profile Content Salon', 'active');
end $$;

select set_config('request.jwt.claim.sub', '22000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $$
declare
  v_owner_public_user_id uuid := '22000000-0000-4000-8000-000000000003';
  v_salon_id uuid := '22000000-0000-4000-8000-000000000006';
  v_hashtag_id uuid;
  v_look_id uuid;
  v_update_id uuid;
begin
  insert into public.salon_profile_hashtags (tag)
  values ('content_grant')
  on conflict (tag) do update
  set tag = excluded.tag
  returning id into v_hashtag_id;

  insert into public.salon_profile_looks (
    salon_id,
    author_user_id,
    created_by_user_id,
    title,
    status,
    media_path
  )
  values (
    v_salon_id,
    v_owner_public_user_id,
    v_owner_public_user_id,
    'Content Grant Look',
    'draft',
    'salon-profile/looks/content-grant-look.jpg'
  )
  returning id into v_look_id;

  update public.salon_profile_looks
  set status = 'published', published_at = now()
  where id = v_look_id
    and salon_id = v_salon_id;

  if not exists (
    select 1
    from public.salon_profile_looks
    where id = v_look_id
      and status = 'published'
  ) then
    raise exception 'Authenticated owner could not write salon_profile_looks.';
  end if;

  insert into public.salon_profile_look_hashtags (
    salon_id,
    look_id,
    hashtag_id
  )
  values (
    v_salon_id,
    v_look_id,
    v_hashtag_id
  );

  delete from public.salon_profile_looks
  where id = v_look_id
    and salon_id = v_salon_id;

  insert into public.salon_profile_updates (
    salon_id,
    author_user_id,
    created_by_user_id,
    title,
    status
  )
  values (
    v_salon_id,
    v_owner_public_user_id,
    v_owner_public_user_id,
    'Content Grant Update',
    'draft'
  )
  returning id into v_update_id;

  update public.salon_profile_updates
  set status = 'published', published_at = now()
  where id = v_update_id
    and salon_id = v_salon_id;

  if not exists (
    select 1
    from public.salon_profile_updates
    where id = v_update_id
      and status = 'published'
  ) then
    raise exception 'Authenticated owner could not write salon_profile_updates.';
  end if;

  insert into public.salon_profile_update_hashtags (
    salon_id,
    update_id,
    hashtag_id
  )
  values (
    v_salon_id,
    v_update_id,
    v_hashtag_id
  );

  delete from public.salon_profile_updates
  where id = v_update_id
    and salon_id = v_salon_id;
end $$;

reset role;

select set_config('request.jwt.claim.sub', '22000000-0000-4000-8000-000000000004', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $$
declare
  v_other_public_user_id uuid := '22000000-0000-4000-8000-000000000005';
  v_salon_id uuid := '22000000-0000-4000-8000-000000000006';
  v_blocked boolean := false;
begin
  begin
    insert into public.salon_profile_looks (
      salon_id,
      author_user_id,
      created_by_user_id,
      title,
      status,
      media_path
    )
    values (
      v_salon_id,
      v_other_public_user_id,
      v_other_public_user_id,
      'Unauthorized Content Grant Look',
      'draft',
      'salon-profile/looks/unauthorized-content-grant-look.jpg'
    );
  exception
    when others then
      v_blocked := true;
  end;

  if not v_blocked then
    raise exception 'Unaffiliated authenticated user inserted salon_profile_looks.';
  end if;

  v_blocked := false;

  begin
    insert into public.salon_profile_updates (
      salon_id,
      author_user_id,
      created_by_user_id,
      title,
      status
    )
    values (
      v_salon_id,
      v_other_public_user_id,
      v_other_public_user_id,
      'Unauthorized Content Grant Update',
      'draft'
    );
  exception
    when others then
      v_blocked := true;
  end;

  if not v_blocked then
    raise exception 'Unaffiliated authenticated user inserted salon_profile_updates.';
  end if;
end $$;

rollback;
