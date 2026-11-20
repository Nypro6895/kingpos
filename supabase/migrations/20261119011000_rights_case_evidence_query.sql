begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- UI enumeration is authority to choose an opaque canonical object ID only.
-- It is not a Storage grant or permission to fetch an arbitrary reported URL.
create or replace function public.get_admin_rights_case_evidence(p_case_id uuid)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare c public.post_safety_cases;rid uuid;candidate record;saved public.rights_image_evidence;
 photos jsonb:='[]';state jsonb;enabled boolean;can_capture boolean;blocked text;special boolean:=false;new_candidate boolean:=false;
begin
 select * into c from public.post_safety_cases where id=p_case_id;
 if not found then raise exception 'Case unavailable.' using errcode='42501';end if;
 select report_id into rid from public.review_support_links where kind='post_report' and request_id=c.id;
 rid:=coalesce(rid,c.platform_report_id);
 if not public.rights_evidence_operator(rid,'admin.reports.read') then raise exception 'Assigned case operator required.' using errcode='42501';end if;
 select coalesce(p.enabled,false) into enabled from public.rights_image_evidence_policy p where p.id;
 enabled:=coalesce(enabled,false);
 can_capture:=public.rights_evidence_operator(rid,'admin.reports.update');
 if not can_capture then blocked:='permission';elsif not enabled then blocked:='policy_disabled';end if;
 if blocked is null and (public.rights_evidence_expiry(rid,c.id)<=clock_timestamp()
 or exists(select 1 from public.rights_image_evidence_holds h where h.case_id=c.id and h.released_at is null and h.review_at<=clock_timestamp())) then blocked:='unavailable';end if;
 special:=c.reason='minor_safety';
 for candidate in
  select i.object_id from public.public_post_images i
  where i.status='approved' and i.public_deletion_fenced_at is null and i.uploaded_by_user_id is not null
   and i.sha256 ~ '^[a-f0-9]{64}$' and length(i.object_version)>0 and length(i.object_etag)>0 and i.bytes between 1 and 512000
   and exists(select 1 from public.users where id=i.uploaded_by_user_id and status='active')
   and public.public_post_media_deletion_path(i.bucket,i.object_path,i.uploaded_by_user_id)
   and public.rights_evidence_object_matches(i.bucket,i.object_path,i.object_id,i.object_version,i.object_etag,i.sha256,i.bytes)
   and ((c.source_type='beauty_post' and exists(select 1 from public.beauty_post_media m where m.post_id=c.source_id and m.bucket=i.bucket and m.object_path=i.object_path))
   or (c.source_type in('salon_profile_look','salon_profile_update') and i.bucket='salon-profile-media' and c.content_snapshot->>'media_path'=i.object_path))
  union
  select e.source_object_id from public.rights_image_evidence e where e.case_id=c.id and e.report_id=rid
  order by object_id loop
  select * into saved from public.rights_image_evidence e where e.case_id=c.id and e.report_id=rid and e.source_object_id=candidate.object_id order by created_at desc limit 1;
  state:=null;
  special:=special or exists(select 1 from public.public_post_images selected_image join public.post_safety_cases other_case on other_case.reason='minor_safety'
   where selected_image.object_id=candidate.object_id and (
   (other_case.source_type='beauty_post' and exists(select 1 from public.beauty_post_media m join public.public_post_images i on i.bucket=m.bucket and i.object_path=m.object_path where m.post_id=other_case.source_id and i.sha256=selected_image.sha256))
   or (other_case.source_type in('salon_profile_look','salon_profile_update') and exists(select 1 from public.public_post_images i where i.bucket='salon-profile-media' and i.object_path=other_case.content_snapshot->>'media_path' and i.sha256=selected_image.sha256))));
  if saved.id is not null then
   state:=public.get_admin_rights_image_evidence_state(saved.id);
   special:=special or public.rights_evidence_special_risk(saved.id);
  else
   new_candidate:=true;
   special:=special or exists(select 1 from public.public_post_images i join public.rights_image_evidence e on e.sha256=i.sha256
    where i.object_id=candidate.object_id and public.rights_evidence_special_risk(e.id));
  end if;
  photos:=photos||jsonb_build_array(jsonb_build_object('objectId',candidate.object_id,'evidenceId',saved.id,'state',state));
 end loop;
 if special then blocked:='special_safety';end if;
 if jsonb_array_length(photos)=0 and blocked is null then blocked:='unavailable';end if;
 return jsonb_build_object('caseId',c.id,'policyEnabled',enabled,'canCapture',blocked is null and new_candidate,'blockedReason',blocked,'photos',photos);
exception when lock_not_available then return null;
end $$;
revoke all on function public.get_admin_rights_case_evidence(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_admin_rights_case_evidence(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
