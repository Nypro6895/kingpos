begin;
create function public.reylumi_membership_eligible_badges(p_ids uuid[])
returns table(salon_id uuid,valid_until timestamptz) language sql stable security definer set search_path=public as $$
 select t.salon_id,max(t.ends_at) from reylumi_membership_terms t
 join reylumi_membership_versions v on v.id=t.version_id join locations l on l.id=t.salon_id
 where t.salon_id=any(p_ids) and l.status='active' and t.cancelled_at is null
 and t.starts_at<=now() and t.ends_at>now() and v.config->'salon_member_badge'='true'::jsonb group by t.salon_id
$$;
revoke all on function public.reylumi_membership_eligible_badges(uuid[]) from public,anon,authenticated;
create function public.reylumi_membership_scoped_badges(p_ids uuid[],p_admin boolean default false)
returns table(salon_id uuid,valid_until timestamptz) language plpgsql stable security definer set search_path=public as $$begin
 if coalesce(cardinality(p_ids),0)>100 then raise exception 'At most 100 salons per request';end if;
 return query select b.* from reylumi_membership_eligible_badges(p_ids)b
 where salon_profile_public_salon_exists(b.salon_id) or user_is_salon_member(b.salon_id)
 or tax_company_has_access(b.salon_id)
 or exists(select 1 from customers c where c.location_id=b.salon_id and c.customer_user_id=current_public_user_id())
 or (p_admin and (platform_admin_has_permission('admin.membership.read') or platform_admin_has_permission('admin.locations.read')));
end $$;
revoke all on function public.reylumi_membership_scoped_badges(uuid[],boolean) from public,anon;
grant execute on function public.reylumi_membership_scoped_badges(uuid[],boolean) to authenticated;
-- Device credentials stay in HttpOnly cookies. The existing POS resolver validates
-- signatures, revoked keys, salon status and the local lock remains enforced in HTTP.
create function public.reylumi_membership_portable_badges(p_ids uuid[],p_key uuid,p_signature text)
returns table(salon_id uuid,valid_until timestamptz) language plpgsql stable security definer set search_path=public as $$
declare target uuid;begin
 if coalesce(cardinality(p_ids),0)>100 then raise exception 'At most 100 salons per request';end if;
 target:=pos_portable_access_salon_id(p_key,p_signature);
 return query select b.* from reylumi_membership_eligible_badges(array[target])b where b.salon_id=any(p_ids);
end $$;
revoke all on function public.reylumi_membership_portable_badges(uuid[],uuid,text) from public;
grant execute on function public.reylumi_membership_portable_badges(uuid[],uuid,text) to anon,authenticated;
-- Resource references use their existing read authority; never trust a name or
-- accept a supplied salon ID as permission to inspect a private salon.
create function public.reylumi_membership_reference_badge(p_kind text,p_reference text)
returns table(salon_id uuid,valid_until timestamptz) language plpgsql stable security definer set search_path=public as $$
declare target uuid;payload jsonb;begin
 if length(coalesce(p_reference,'')) not between 1 and 256 then return;end if;
 if p_kind='display' then
  payload:=get_pos_customer_display_settings_by_token(p_reference);
  if payload is not null then select d.salon_id into target from pos_live_drafts d where d.token=btrim(p_reference) order by d.updated_at desc limit 1;end if;
 elsif p_kind='entry' then
  payload:=service_relay_entry_catalog(p_reference::uuid);target:=(payload->>'salonId')::uuid;
 elsif p_kind='visit' then
  payload:=get_notification_visit(p_reference::uuid);
  if payload is not null then select v.salon_id into target from customer_visits v where v.id=p_reference::uuid;end if;
 elsif p_kind='invitation' then
  if exists(select 1 from jsonb_array_elements(list_my_owner_transfer_invites())i where i->>'id'=p_reference) then
   select i.salon_id into target from salon_owner_transfer_invites i where i.id=p_reference::uuid;
  end if;
 elsif p_kind='claim' then
  payload:=get_customer_claim_token_preview(p_reference);
  if payload->'ok'='true'::jsonb then select c.salon_id into target from customer_claim_tokens c where c.token_hash=customer_claim_token_hash(p_reference);end if;
 end if;
 if target is not null then return query select b.* from reylumi_membership_eligible_badges(array[target])b;end if;
exception when invalid_text_representation then return;
end $$;
revoke all on function public.reylumi_membership_reference_badge(text,text) from public;
grant execute on function public.reylumi_membership_reference_badge(text,text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
