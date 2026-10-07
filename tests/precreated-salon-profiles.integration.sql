-- Run with the new migration and import in a transaction, then roll back.
do $$
declare total integer; nails_total bigint; sample uuid;
begin
  select count(*) into total from public.salon_directory_listings;
  if total <> 606 then raise exception 'Expected 606 profiles, got %', total; end if;
  if exists(select 1 from public.salon_directory_listings d
    join public.salon_memberships m on m.salon_id=d.salon_id)
    or exists(select 1 from public.account_memberships m join public.locations l on l.account_id=m.account_id join public.salon_directory_listings d on d.salon_id=l.id)
    then raise exception 'Import assigned management memberships'; end if;
  if exists(select 1 from public.salon_directory_listings d join public.booking_settings b on b.salon_id=d.salon_id where b.booking_enabled or b.online_booking_visible)
    then raise exception 'Import enabled online booking'; end if;
  if exists(select 1 from public.salon_directory_listings d join public.services s on s.salon_id=d.salon_id)
    then raise exception 'Import invented bookable services'; end if;
  if exists(select 1 from public.salon_directory_listings d left join public.salon_profile_updates u on u.id=d.reference_post_id
    where u.id is null or u.salon_id<>d.salon_id or u.status<>'published' or u.author_user_id is not null or u.author_staff_id is not null)
    then raise exception 'Missing or misattributed reference post'; end if;
  select total_count into nails_total from public.search_public_explore_salons(p_category=>'Nails',p_location=>'WI') limit 1;
  if nails_total<>586 then raise exception 'Expected 586 searchable nails profiles, got %',nails_total; end if;
  select salon_id into sample from public.salon_directory_listings where listing_id='wi-madison-nail-lounge';
  if not exists(select 1 from public.get_public_salon_profile(sample) where salon_name='Madison Nail Lounge' and phone='608-720-1011') then raise exception 'Canonical profile unavailable'; end if;
  if not exists(select 1 from public.get_public_salon_profile_updates(sample) where author_display_name='Reylumi · Reference introduction') then raise exception 'Reference post unavailable'; end if;
  if not exists(select 1 from public.get_public_salon_profile(sample) where 'Nails'=any(service_categories)) then raise exception 'Reported category unavailable'; end if;
  if exists(select 1 from public.get_public_salon_profile_services(sample)) then raise exception 'Public profile shows fabricated service'; end if;
end $$;

set local role anon;
do $$
declare sample uuid; denied boolean := false;
begin
  select salon_id into sample from public.get_public_directory_salon_links(array['wi-madison-nail-lounge']);
  if sample is null then raise exception 'Anonymous visitor cannot open linked salon'; end if;
  if not exists(select 1 from public.get_public_salon_directory_listing(sample) where claim_state='unclaimed') then raise exception 'Anonymous provenance unavailable'; end if;
  if not exists(select 1 from public.get_public_salon_profile(sample)) then raise exception 'Anonymous canonical profile unavailable'; end if;
  begin
    update public.salon_directory_listings set claim_state='claimed' where salon_id=sample;
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'Anonymous role can claim a salon'; end if;
end $$;
reset role;
set local role authenticated;
do $$
declare denied boolean := false;
begin
  begin
    update public.salon_directory_listings set claim_state='claimed';
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'Authenticated role can self-assign a claim'; end if;
end $$;
reset role;
