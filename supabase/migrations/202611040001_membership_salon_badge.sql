begin;
-- Offer the benefit in every draft, without changing existing purchased snapshots.
update public.reylumi_membership_plans set config=config||'{"salon_member_badge":true}'::jsonb,
 revision=revision+1 where not(config?'salon_member_badge');
alter function public.reylumi_membership_validate(jsonb) rename to reylumi_membership_validate_v2;
revoke all on function public.reylumi_membership_validate_v2(jsonb) from public,anon,authenticated;
create function public.reylumi_membership_validate(c jsonb) returns void
language plpgsql set search_path=public as $$begin
 perform reylumi_membership_validate_v2(c);
 if c?'salon_member_badge' and jsonb_typeof(c->'salon_member_badge')<>'boolean' then
  raise exception 'Invalid member badge benefit';
 end if;
end $$;
revoke all on function public.reylumi_membership_validate(jsonb) from public,anon,authenticated;

-- Affiliation projection only. No plan, price, source, customer or payment data.
-- Reuse the existing public-salon visibility authority, independently of identity approval.
create function public.reylumi_membership_salon_badges(p_salon_ids uuid[])
returns table(salon_id uuid,valid_until timestamptz)
language plpgsql stable security definer set search_path=public as $$begin
 if coalesce(cardinality(p_salon_ids),0)>100 then raise exception 'At most 100 salons per request';end if;
 return query select t.salon_id,max(t.ends_at)
 from public.reylumi_membership_terms t
 join public.reylumi_membership_versions v on v.id=t.version_id
 join public.locations l on l.id=t.salon_id
 where t.salon_id=any(p_salon_ids) and l.status='active'
 and public.salon_profile_public_salon_exists(l.id)
 and t.cancelled_at is null and t.starts_at<=now() and t.ends_at>now()
 and v.config->'salon_member_badge'='true'::jsonb
 group by t.salon_id;
end $$;
revoke all on function public.reylumi_membership_salon_badges(uuid[]) from public;
grant execute on function public.reylumi_membership_salon_badges(uuid[]) to anon,authenticated;
notify pgrst,'reload schema';
commit;

