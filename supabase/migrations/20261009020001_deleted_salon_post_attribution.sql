-- Retain salon content without exposing a deleted staff member's saved personal identity.
begin;
create or replace function public.get_public_salon_post_attribution(p_content_ids uuid[])
returns table(content_id uuid, author_role text, staff_id uuid)
language sql stable security definer set search_path=public as $$
  with posts as (
    select id, salon_id, author_user_id, author_staff_id, author_presentation_role from salon_profile_looks
    where id = any(p_content_ids) and status = 'published'
    union all
    select id, salon_id, author_user_id, author_staff_id, author_presentation_role from salon_profile_updates
    where id = any(p_content_ids) and status = 'published'
  ), classified as (
    select p.*, case when p.author_presentation_role='staff' and exists (
      select 1 from users u where u.id=p.author_user_id and u.status='deleted'
    ) then 'salon' else p.author_presentation_role end as display_role
    from posts p where public.salon_profile_public_salon_exists(p.salon_id)
  )
  select id, display_role, case when display_role='staff' then author_staff_id else null end from classified;
$$;
revoke all on function public.get_public_salon_post_attribution(uuid[]) from public;
grant execute on function public.get_public_salon_post_attribution(uuid[]) to anon, authenticated;
notify pgrst, 'reload schema';
commit;
