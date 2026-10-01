insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'account-avatars',
  'account-avatars',
  true,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "public_read_account_avatar_objects" on storage.objects
for select to anon, authenticated
using (bucket_id = 'account-avatars');

create policy "account_users_insert_own_avatar_objects" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'account-avatars'
  and storage.objects.name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/avatar/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]webp$'
  and split_part(storage.objects.name, '/', 1) = public.current_public_user_id()::text
);

create policy "account_users_update_own_avatar_objects" on storage.objects
for update to authenticated
using (
  bucket_id = 'account-avatars'
  and storage.objects.name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/avatar/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]webp$'
  and split_part(storage.objects.name, '/', 1) = public.current_public_user_id()::text
)
with check (
  bucket_id = 'account-avatars'
  and storage.objects.name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/avatar/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]webp$'
  and split_part(storage.objects.name, '/', 1) = public.current_public_user_id()::text
);

create policy "account_users_delete_own_avatar_objects" on storage.objects
for delete to authenticated
using (
  bucket_id = 'account-avatars'
  and storage.objects.name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/avatar/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]webp$'
  and split_part(storage.objects.name, '/', 1) = public.current_public_user_id()::text
);
