-- Storage SELECT policies are OR'ed together, and policy subqueries still need
-- table privileges for the caller. Keep the public Beauty media rule intact
-- without granting broad direct SELECT on Beauty content tables.

create or replace function public.public_beauty_media_object_is_readable(
  p_bucket_id text,
  p_object_name text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_bucket_id = 'beauty-profile-media'
    and (
      split_part(coalesce(p_object_name, ''), '/', 1) =
        coalesce(public.current_public_user_id()::text, '')
      or exists (
        select 1
        from public.beauty_post_media media
        join public.beauty_posts posts on posts.id = media.post_id
        join public.beauty_profiles profiles on profiles.id = posts.profile_id
        where media.bucket = p_bucket_id
          and media.object_path = p_object_name
          and posts.deleted_at is null
          and posts.visibility = 'public'
          and posts.moderation_status = 'visible'
          and profiles.visibility = 'public'
      )
      or exists (
        select 1
        from public.beauty_profiles profiles
        where profiles.cover_media_path = p_object_name
          and profiles.visibility = 'public'
      )
    )
$$;

revoke all on function public.public_beauty_media_object_is_readable(text, text)
from public, anon, authenticated;

grant execute on function public.public_beauty_media_object_is_readable(text, text)
to anon, authenticated;

drop policy if exists "public_read_active_beauty_media_objects" on storage.objects;
create policy "public_read_active_beauty_media_objects" on storage.objects
for select to anon, authenticated
using (
  public.public_beauty_media_object_is_readable(
    storage.objects.bucket_id,
    storage.objects.name
  )
);
