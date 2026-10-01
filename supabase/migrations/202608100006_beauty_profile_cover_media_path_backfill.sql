alter table public.beauty_profiles
add column if not exists cover_media_path text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.beauty_profiles'::regclass
      and conname = 'beauty_profiles_cover_media_path_check'
  ) then
    alter table public.beauty_profiles
    add constraint beauty_profiles_cover_media_path_check check (
      cover_media_path is null
      or cover_media_path ~* (
        '^' || user_id::text || '/beauty/cover/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]webp$'
      )
    );
  end if;
end $$;

create index if not exists beauty_profiles_public_cover_idx
on public.beauty_profiles(cover_media_path)
where cover_media_path is not null and visibility = 'public';

drop policy if exists "public_read_active_beauty_media_objects" on storage.objects;

create policy "public_read_active_beauty_media_objects" on storage.objects
for select to anon, authenticated
using (
  bucket_id = 'beauty-profile-media'
  and (
    split_part(name, '/', 1) = public.current_public_user_id()::text
    or exists (
      select 1
      from public.beauty_post_media media
      join public.beauty_posts posts on posts.id = media.post_id
      join public.beauty_profiles profiles on profiles.id = posts.profile_id
      where media.bucket = storage.objects.bucket_id
        and media.object_path = storage.objects.name
        and posts.deleted_at is null
        and posts.visibility = 'public'
        and posts.moderation_status = 'visible'
        and profiles.visibility = 'public'
    )
    or exists (
      select 1
      from public.beauty_profiles profiles
      where profiles.cover_media_path = storage.objects.name
        and profiles.visibility = 'public'
    )
  )
);

drop policy if exists "beauty_users_insert_own_media_objects" on storage.objects;

create policy "beauty_users_insert_own_media_objects" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'beauty-profile-media'
  and (storage.foldername(name))[1] = public.current_public_user_id()::text
  and (storage.foldername(name))[2] = 'beauty'
  and (storage.foldername(name))[3] in ('image', 'before', 'after', 'cover')
  and array_length(storage.foldername(name), 1) = 3
  and name like '%.webp'
);

drop policy if exists "beauty_users_update_own_media_objects" on storage.objects;

create policy "beauty_users_update_own_media_objects" on storage.objects
for update to authenticated
using (
  bucket_id = 'beauty-profile-media'
  and (storage.foldername(name))[1] = public.current_public_user_id()::text
  and (storage.foldername(name))[2] = 'beauty'
  and (storage.foldername(name))[3] in ('image', 'before', 'after', 'cover')
  and array_length(storage.foldername(name), 1) = 3
)
with check (
  bucket_id = 'beauty-profile-media'
  and (storage.foldername(name))[1] = public.current_public_user_id()::text
  and (storage.foldername(name))[2] = 'beauty'
  and (storage.foldername(name))[3] in ('image', 'before', 'after', 'cover')
  and array_length(storage.foldername(name), 1) = 3
  and name like '%.webp'
);

drop policy if exists "beauty_users_delete_own_media_objects" on storage.objects;

create policy "beauty_users_delete_own_media_objects" on storage.objects
for delete to authenticated
using (
  bucket_id = 'beauty-profile-media'
  and (storage.foldername(name))[1] = public.current_public_user_id()::text
  and (storage.foldername(name))[2] = 'beauty'
  and (storage.foldername(name))[3] in ('image', 'before', 'after', 'cover')
  and array_length(storage.foldername(name), 1) = 3
);

grant select, insert, update on table public.beauty_profiles to authenticated;
