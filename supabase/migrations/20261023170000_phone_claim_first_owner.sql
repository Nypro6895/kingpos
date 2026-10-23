-- Verified stored-phone claims are immediate unless an ownership conflict exists.
-- No grants/RLS changes, existing ownership transfer or automatic backlog approvals.
begin;
set local search_path=public;
do $migration$
declare definition text; old_fragment text; new_fragment text;
begin
  definition := pg_get_functiondef('public.confirm_business_claim(uuid,uuid,text)'::regprocedure);
 definition:=replace(definition,chr(13),'');
  old_fragment := $old$ select exists(select 1 from public.salon_directory_listings d where d.salon_id=l.id and d.claim_state='unclaimed' and d.source_type='business_website' and d.collected_on>=current_date-90)
 and (select count(*) from public.locations where public.business_claim_phone(phone)=r.phone)=1
 and not exists(select 1 from public.business_claim_requests where salon_id=l.id and id<>r.id and (status in ('waiting','needs_info') or status='otp_pending' and expires_at>now())) into automatic;
$old$;
  new_fragment := $new$ -- A stored-phone proof is sufficient unless another ownership interest exists.
 -- Source category/collection age/shared phone alone are not ownership disputes.
 select exists(select 1 from public.salon_directory_listings d where d.salon_id=l.id and d.claim_state='unclaimed')
 and (select count(*) from public.locations where account_id=l.account_id)=1
 and not exists(select 1 from public.account_memberships where account_id=l.account_id and status<>'removed')
 and not exists(select 1 from public.salon_memberships where account_id=l.account_id and status<>'removed')
 and not exists(select 1 from public.business_claim_requests c where c.salon_id=l.id
   and c.status in ('waiting','needs_info','rejected') and c.reviewed_by is not null)
 into automatic;
$new$;
  if position(new_fragment in definition)=0 then
    if position(old_fragment in definition)=0 then raise exception 'Unexpected public.confirm_business_claim definition; review before applying.'; end if;
    if position(new_fragment in definition)=0 then execute replace(definition,old_fragment,new_fragment); end if;
  end if;
  definition := pg_get_functiondef('public.confirm_business_claim(uuid,uuid,text)'::regprocedure);
 definition:=replace(definition,chr(13),'');
  old_fragment := $old$ update public.business_claim_requests set phone_verified_at=now() where id=r.id;$old$;
  new_fragment := $new$ if not exists(select 1 from public.users where id=p_user and status='active')
 or not exists(select 1 from public.accounts where id=l.account_id and status='active')
 or public.normalize_salon_lifecycle_status(l.status)='permanently_closed' then
   raise exception 'This account or salon is unavailable.';
 end if;
 update public.business_claim_requests set phone_verified_at=now() where id=r.id;$new$;
  if position(new_fragment in definition)=0 then
    if position(old_fragment in definition)=0 then raise exception 'Unexpected public.confirm_business_claim definition; review before applying.'; end if;
    if position(new_fragment in definition)=0 then execute replace(definition,old_fragment,new_fragment); end if;
  end if;
  definition := pg_get_functiondef('public.confirm_business_claim(uuid,uuid,text)'::regprocedure);
 definition:=replace(definition,chr(13),'');
  old_fragment := $old$Verified business website phone; no competing claim.$old$;
  new_fragment := $new$Verified listed business phone; no ownership conflict.$new$;
  if position(new_fragment in definition)=0 then
    if position(old_fragment in definition)=0 then raise exception 'Unexpected public.confirm_business_claim definition; review before applying.'; end if;
    if position(new_fragment in definition)=0 then execute replace(definition,old_fragment,new_fragment); end if;
  end if;
  definition := pg_get_functiondef('public.confirm_business_claim(uuid,uuid,text)'::regprocedure);
 definition:=replace(definition,chr(13),'');
  old_fragment := $old$update public.business_claim_requests set status='waiting',provider_sid=null,expires_at=null where id=r.id;$old$;
  new_fragment := $new$update public.business_claim_requests set status='waiting',provider_sid=null,expires_at=null,review_reason='Ownership conflict or an existing review decision requires support review.' where id=r.id;$new$;
  if position(new_fragment in definition)=0 then
    if position(old_fragment in definition)=0 then raise exception 'Unexpected public.confirm_business_claim definition; review before applying.'; end if;
    if position(new_fragment in definition)=0 then execute replace(definition,old_fragment,new_fragment); end if;
  end if;
  definition := pg_get_functiondef('public.confirm_business_claim(uuid,uuid,text)'::regprocedure);
 definition:=replace(definition,chr(13),'');
  old_fragment := $old$Phone confirmed; ownership review required.$old$;
  new_fragment := $new$Phone confirmed; ownership conflict or existing review decision requires review.$new$;
  if position(new_fragment in definition)=0 then
    if position(old_fragment in definition)=0 then raise exception 'Unexpected public.confirm_business_claim definition; review before applying.'; end if;
    if position(new_fragment in definition)=0 then execute replace(definition,old_fragment,new_fragment); end if;
  end if;
  definition := pg_get_functiondef('public.begin_business_claim(uuid,uuid,text)'::regprocedure);
 definition:=replace(definition,chr(13),'');
  old_fragment := $old$ if r.status in ('waiting','needs_info') then raise exception 'Your request is already waiting for review.'; end if;$old$;
  new_fragment := $new$ -- A legacy automatic phone hold can retry with a fresh challenge. Never
 -- auto-release a support request or an explicit review decision.
 if r.status in ('waiting','needs_info') and not (r.status='waiting' and r.channel in ('sms','call') and r.phone_verified_at is not null
   and r.reviewed_by is null and r.review_reason is null and r.support_reason is null) then
   raise exception 'Your request is already waiting for review.';
 end if;$new$;
  if position(new_fragment in definition)=0 then
    if position(old_fragment in definition)=0 then raise exception 'Unexpected public.begin_business_claim definition; review before applying.'; end if;
    if position(new_fragment in definition)=0 then execute replace(definition,old_fragment,new_fragment); end if;
  end if;
  definition := pg_get_functiondef('public.begin_business_claim(uuid,uuid,text)'::regprocedure);
 definition:=replace(definition,chr(13),'');
  old_fragment := $old$set channel=p_channel,phone=phone_value,provider_sid=null,expires_at=now()+interval '10 minutes',last_sent_at=now(),attempts=0 where id=r.id returning * into r;$old$;
  new_fragment := $new$set status='otp_pending',channel=p_channel,phone=phone_value,provider_sid=null,expires_at=now()+interval '10 minutes',last_sent_at=now(),attempts=0,phone_verified_at=null where id=r.id returning * into r;$new$;
  if position(new_fragment in definition)=0 then
    if position(old_fragment in definition)=0 then raise exception 'Unexpected public.begin_business_claim definition; review before applying.'; end if;
    if position(new_fragment in definition)=0 then execute replace(definition,old_fragment,new_fragment); end if;
  end if;
end;
$migration$;

-- Return routing only, never another claimant's identity or private evidence.
create or replace function public.get_business_claim_mode(p_salon uuid) returns text
language plpgsql security definer set search_path=public as $$
begin
 if public.current_public_user_id() is null then raise exception 'Sign in to request ownership.'; end if;
 if not public.salon_profile_public_salon_exists(p_salon) then return 'unavailable'; end if;
 if exists(select 1 from public.salon_directory_listings where salon_id=p_salon and claim_state='unclaimed')
 and not exists(select 1 from public.account_memberships where account_id=(select account_id from public.locations where id=p_salon) and status<>'removed')
 and not exists(select 1 from public.salon_memberships where account_id=(select account_id from public.locations where id=p_salon) and status<>'removed')
 then return 'phone'; end if;
 return 'support';
end $$;
revoke all on function public.get_business_claim_mode(uuid) from public,anon;
grant execute on function public.get_business_claim_mode(uuid) to authenticated;

do $routing$
declare definition text; old_fragment text; new_fragment text; sig text;
begin
 -- Keep the existing locks and permissions. No second applicant may send a new
 -- code once management exists, even from an old browser page.
 definition:=pg_get_functiondef('public.begin_business_claim(uuid,uuid,text)'::regprocedure);
 definition:=replace(definition,chr(13),'');
 old_fragment:=$old$ select * into l from public.locations where id=p_salon for update;$old$;
 new_fragment:=old_fragment||$new$
 if exists(select 1 from public.salon_directory_listings where salon_id=l.id and claim_state='claimed')
 or exists(select 1 from public.account_memberships where account_id=l.account_id and status<>'removed')
 or exists(select 1 from public.salon_memberships where account_id=l.account_id and status<>'removed') then
   raise exception using errcode='PCL01', message='This salon already has an owner. Submit an ownership support request.';
 end if;
$new$;
 if position(old_fragment in definition)=0 then raise exception 'Unexpected begin_business_claim routing definition'; end if;
 if position(new_fragment in definition)=0 then execute replace(definition,old_fragment,new_fragment); end if;

 -- A losing in-flight challenge must route to support, never suspend the
 -- incumbent or move their memberships, bookings, customers, or transactions.
 foreach sig in array array['reserve_business_claim_check(uuid,uuid)','confirm_business_claim(uuid,uuid,text)'] loop
 definition:=pg_get_functiondef(('public.'||sig)::regprocedure);
 definition:=replace(definition,chr(13),'');
 old_fragment:=$old$ select * into r from public.business_claim_requests where id=p_request and applicant_user_id=p_user for update;$old$;
 new_fragment:=old_fragment||$new$
 if r.id is not null and r.status<>'approved' and (
 exists(select 1 from public.salon_directory_listings where salon_id=r.salon_id and claim_state='claimed')
 or exists(select 1 from public.account_memberships where account_id=(select account_id from public.locations where id=r.salon_id) and status<>'removed')
 or exists(select 1 from public.salon_memberships where account_id=(select account_id from public.locations where id=r.salon_id) and status<>'removed')) then
   raise exception using errcode='PCL01', message='This salon already has an owner. Submit an ownership support request.';
 end if;
$new$;
 if position(old_fragment in definition)=0 then raise exception 'Unexpected claim check routing definition: %',sig; end if;
 if position(new_fragment in definition)=0 then execute replace(definition,old_fragment,new_fragment); end if;
 end loop;

 -- Pending support cases remain open for human decisions after the first grant.
 definition:=pg_get_functiondef('public.complete_business_claim(uuid,uuid,text)'::regprocedure);
 definition:=replace(definition,chr(13),'');
 old_fragment:=$old$where salon_id=l.id and id<>r.id and status in ('otp_pending','waiting','needs_info');$old$;
 new_fragment:=$new$where salon_id=l.id and id<>r.id and status='otp_pending';$new$;
 if position(old_fragment in definition)=0 and position(new_fragment in definition)=0 then raise exception 'Unexpected complete_business_claim definition'; end if;
 if position(new_fragment in definition)=0 then execute replace(definition,old_fragment,new_fragment); end if;
end;
$routing$;
notify pgrst, 'reload schema';
commit;
