-- Read-only enrichment for all shared comment surfaces. No changes to saved personas.
begin;
create or replace function public.get_post_comment_identities(p_comment_ids uuid[])
returns table (
  id uuid, acting_role text, acting_salon_id uuid, salon_name text,
  author_avatar_url text, salon_logo_path text, staff_avatar_path text
)
language sql stable security definer set search_path = public
as $$
  select c.id, c.acting_role, c.acting_salon_id, l.name,
    case when c.acting_role = 'salon' or (c.acting_role is null and c.is_salon_reply)
      then null else case when u.status <> 'deleted' then u.avatar_url end end,
    case when c.acting_role = 'salon' or (c.acting_role is null and c.is_salon_reply)
      then s.public_profile_logo_path else null end,
    staff_identity.public_profile_photo_path
  from public.salon_profile_comments c
  left join public.users u on u.id = c.author_user_id
  left join public.locations l on l.id = case
    when c.acting_role = 'salon' then c.acting_salon_id
    when c.acting_role is null and c.is_salon_reply then c.salon_id end
    and l.status = 'active'
  left join public.salon_settings s on s.salon_id = l.id
  left join lateral (
    select st.public_profile_photo_path from public.staff st
    where c.acting_role = 'staff' and st.salon_id = c.acting_salon_id
      and st.account_user_id = c.author_user_id and st.is_active
      and u.status <> 'deleted'
      and (st.online_booking_enabled or st.salon_profile_content_posting_enabled)
      and public.salon_profile_public_salon_exists(st.salon_id)
    order by st.created_at, st.id limit 1
  ) staff_identity on true
  where c.id in (select unnest(p_comment_ids[1:256]))
    and (
      (c.status in ('published', 'visible')
        and public.post_comment_target_is_public(c.look_id, c.update_id, c.beauty_post_id, c.salon_id)
        and (c.parent_comment_id is null or exists (
          select 1 from public.salon_profile_comments root
          where root.id = coalesce(c.root_comment_id, c.parent_comment_id)
            and root.parent_comment_id is null and root.status in ('published', 'visible')
            and root.look_id is not distinct from c.look_id
            and root.update_id is not distinct from c.update_id
            and root.beauty_post_id is not distinct from c.beauty_post_id
        )))
      or (c.status = 'reported' and c.author_user_id = public.current_public_user_id())
    )
$$;
revoke all on function public.get_post_comment_identities(uuid[]) from public;
grant execute on function public.get_post_comment_identities(uuid[]) to anon, authenticated;
commit;
