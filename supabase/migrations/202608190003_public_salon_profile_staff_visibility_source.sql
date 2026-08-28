update public.staff
set owner_public_enabled =
      is_active and (
        online_booking_enabled or salon_profile_content_posting_enabled
      ),
    public_profile_visible =
      is_active and (
        online_booking_enabled or salon_profile_content_posting_enabled
      ),
    staff_public_consent_status =
      case
        when is_active and (
          online_booking_enabled or salon_profile_content_posting_enabled
        ) then 'granted'
        else 'not_requested'
      end
where owner_public_enabled is distinct from (
        is_active and (
          online_booking_enabled or salon_profile_content_posting_enabled
        )
      )
   or public_profile_visible is distinct from (
        is_active and (
          online_booking_enabled or salon_profile_content_posting_enabled
        )
      )
   or staff_public_consent_status is distinct from (
        case
          when is_active and (
            online_booking_enabled or salon_profile_content_posting_enabled
          ) then 'granted'
          else 'not_requested'
        end
      );

create or replace function public.get_public_salon_profile_staff(target_salon_id uuid)
returns table (
  id uuid,
  display_name text,
  job_title text,
  avatar_path text,
  account_avatar_url text,
  bio text,
  online_booking_enabled boolean,
  specialties text[],
  portfolio_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    staff.id,
    staff.display_name,
    staff.job_title,
    staff.public_profile_photo_path,
    account_users.avatar_url,
    staff.public_bio,
    staff.online_booking_enabled,
    staff.specialties,
    (
      select count(*)
      from public.salon_profile_looks looks
      where looks.author_staff_id = staff.id
        and looks.status = 'published'
    )
  from public.staff
  left join public.users account_users on account_users.id = staff.account_user_id
  where staff.salon_id = target_salon_id
    and staff.is_active = true
    and (
      staff.online_booking_enabled = true
      or staff.salon_profile_content_posting_enabled = true
    )
    and public.salon_profile_public_salon_exists(target_salon_id)
  order by staff.profile_display_order, staff.display_name
$$;

revoke all on function public.get_public_salon_profile_staff(uuid) from public;
grant execute on function public.get_public_salon_profile_staff(uuid) to anon, authenticated;
