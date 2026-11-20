-- Additive storage: owned extras remain service-backed so the existing scheduler,
-- staff price/duration overrides, booking snapshots and conflict guards are reused.
alter table public.services add column booking_parent_service_id uuid references public.services(id);
alter table public.services add column booking_add_on_group text;
alter table public.services add constraint services_owned_addon_group check (
  (booking_parent_service_id is null and booking_add_on_group is null) or
  (booking_parent_service_id is not null and booking_parent_service_id <> id and booking_add_on_group is not null and booking_add_on_group in ('one','many'))
);
alter table public.services add constraint services_id_salon_owned_unique unique(id,salon_id);
alter table public.services add constraint services_owned_parent_salon_fk foreign key(booking_parent_service_id,salon_id) references public.services(id,salon_id);
create index services_booking_parent_idx on public.services(booking_parent_service_id);

create or replace function public.save_owned_service_config_batch(p_salon_id uuid, p_configs jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  config jsonb; extra jsonb; saved jsonb; parent_id uuid; child_id uuid; original_id uuid;
  saved_ids uuid[] := '{}'; kept_ids uuid[]; position integer; parent_row public.services;
  retained_assignments jsonb;
begin
  if not public.user_has_salon_permission(p_salon_id,array['services.manage']) then
    raise exception 'Not allowed to manage services.' using errcode='42501';
  end if;
  if p_configs is null or jsonb_typeof(p_configs) <> 'array' or jsonb_array_length(p_configs) not between 1 and 100 then
    raise exception 'Save between 1 and 100 service configurations.';
  end if;
  -- Serialize catalog writes within a salon; never take a release/deployment lock.
  perform pg_advisory_xact_lock(hashtextextended('owned-service-config:'||p_salon_id::text,0));
  for config in select value from jsonb_array_elements(p_configs) loop
    parent_id := nullif(config->>'service_id','')::uuid;
    if parent_id is not null and not exists(select 1 from services where id=parent_id and salon_id=p_salon_id and booking_parent_service_id is null) then
      raise exception 'Main service does not belong to this salon.';
    end if;
    -- Retain staff-specific overrides: the legacy batch recreates assignment rows.
    select coalesce(jsonb_agg(to_jsonb(a)),'[]') into retained_assignments
      from staff_service_assignments a where a.salon_id=p_salon_id and a.service_id=parent_id;
    if config ? 'booking_add_ons' then
      if jsonb_typeof(config->'booking_add_ons') <> 'array' or jsonb_array_length(config->'booking_add_ons') > 40 then
        raise exception 'Invalid owned add-ons.';
      end if;
      config := jsonb_set(config,'{add_on_service_ids}','[]');
    end if;
    -- Use the existing atomic catalog operation for the parent and staff flags.
    saved := public.save_service_config_batch(p_salon_id,jsonb_build_array(config));
    parent_id := (saved->'service_ids'->>0)::uuid;
    update staff_service_assignments a set custom_price=(old->>'custom_price')::numeric,
      custom_duration_minutes=(old->>'custom_duration_minutes')::integer,
      effective_start_date=(old->>'effective_start_date')::date,
      effective_end_date=(old->>'effective_end_date')::date
      from jsonb_array_elements(retained_assignments) old
      where a.service_id=parent_id and a.staff_id=(old->>'staff_id')::uuid and a.salon_id=p_salon_id;
    saved_ids := array_append(saved_ids,parent_id);
    select * into strict parent_row from services where id=parent_id and salon_id=p_salon_id;
    -- Reuse an existing category's spelling rather than create case-only duplicates.
    update services s set category=canonical.category from lateral (
      select category from services where salon_id=p_salon_id and booking_parent_service_id is null
        and id<>parent_id and lower(btrim(category))=lower(btrim(parent_row.category))
      order by created_at,id limit 1
    ) canonical where s.id=parent_id;
    if not (config ? 'booking_add_ons') then continue; end if;
    kept_ids := '{}'; position := 0;
    for extra in select value from jsonb_array_elements(config->'booking_add_ons') loop
      if coalesce(btrim(extra->>'name'),'')='' or length(btrim(extra->>'name'))>120
        or coalesce(extra->>'selection_group','') not in ('one','many')
        or (extra->>'base_price') is null or (extra->>'base_price')::numeric < 0
        or (extra->>'base_price')::numeric::text in ('NaN','Infinity','-Infinity')
        or (extra->>'duration_minutes') is null or (extra->>'duration_minutes')::numeric <> trunc((extra->>'duration_minutes')::numeric)
        or (extra->>'duration_minutes')::integer not between 1 and 1440 then
        raise exception 'Invalid add-on name, group, extra price or time.';
      end if;
      original_id := nullif(extra->>'service_id','')::uuid;
      child_id := null;
      if original_id is not null then
        select id into child_id from services where id=original_id and salon_id=p_salon_id
          and booking_parent_service_id=parent_id;
        if child_id is null and not exists(select 1 from services where id=original_id and salon_id=p_salon_id and booking_parent_service_id is null) then
          raise exception 'Add-on does not belong to this service.';
        end if;
      end if;
      -- Legacy linked main services are copied on save, never edited or removed.
      if child_id is null then
        insert into services(salon_id,name,base_price,duration_minutes,is_active,online_booking_enabled,booking_parent_service_id,booking_add_on_group)
        values(p_salon_id,btrim(extra->>'name'),(extra->>'base_price')::numeric,(extra->>'duration_minutes')::integer,
          parent_row.is_active,parent_row.online_booking_enabled,parent_id,extra->>'selection_group') returning id into child_id;
      else
        if child_id=any(kept_ids) then raise exception 'Duplicate add-on.'; end if;
        update services set name=btrim(extra->>'name'),base_price=(extra->>'base_price')::numeric,
          duration_minutes=(extra->>'duration_minutes')::integer,is_active=parent_row.is_active,
          online_booking_enabled=parent_row.online_booking_enabled,booking_add_on_group=extra->>'selection_group'
          where id=child_id and salon_id=p_salon_id;
      end if;
      kept_ids := array_append(kept_ids,child_id); position := position+1;
      insert into service_add_on_links(salon_id,parent_service_id,add_on_service_id,display_order,is_active)
        values(p_salon_id,parent_id,child_id,position,true);
      -- Owned extras inherit the parent's eligible staff; retain saved overrides.
      update staff_service_assignments set is_active=false,online_bookable=false where service_id=child_id and salon_id=p_salon_id;
      insert into staff_service_assignments(salon_id,service_id,staff_id,is_active,online_bookable,custom_price,custom_duration_minutes,effective_start_date,effective_end_date)
        select p_salon_id,child_id,a.staff_id,a.is_active,a.online_bookable,legacy.custom_price,legacy.custom_duration_minutes,a.effective_start_date,a.effective_end_date
        from staff_service_assignments a left join staff_service_assignments legacy
          on legacy.service_id=original_id and legacy.staff_id=a.staff_id and legacy.salon_id=p_salon_id
        where a.service_id=parent_id and a.salon_id=p_salon_id
        on conflict(staff_id,service_id) do update set is_active=excluded.is_active,online_bookable=excluded.online_bookable,
          effective_start_date=excluded.effective_start_date,effective_end_date=excluded.effective_end_date;
    end loop;
    -- Retire removed extras; historical booking/POS lines retain their IDs/snapshots.
    update services set is_active=false,online_booking_enabled=false
      where booking_parent_service_id=parent_id and salon_id=p_salon_id and not(id=any(kept_ids));
  end loop;
  return jsonb_build_object('ok',true,'service_ids',saved_ids);
end $$;
revoke all on function public.save_owned_service_config_batch(uuid,jsonb) from public,anon;
grant execute on function public.save_owned_service_config_batch(uuid,jsonb) to authenticated;

create or replace function public.get_public_salon_profile_services(target_salon_id uuid)
returns table(id uuid,name text,category text,base_price numeric,duration_minutes integer,description text)
language sql stable as $$
  select id,name,category,base_price,duration_minutes,description from public.services
  where salon_id=target_salon_id and is_active=true and online_booking_enabled=true
    and booking_parent_service_id is null and public.salon_profile_public_salon_exists(target_salon_id)
  order by name
$$;

-- Enforce selection rules even when the public RPC is called without the UI.
create or replace function public.assert_owned_booking_addon_group()
returns trigger language plpgsql set search_path=public as $$
declare child public.services; parent_line public.booking_lines;
begin
  select * into child from services where id=new.service_id;
  if TG_OP='INSERT' and (child.booking_parent_service_id is not null or exists(
    select 1 from services where booking_parent_service_id=child.id)) then
    -- The legacy public insert snapshots base values. Use the same staff values
    -- as the slot engine for these owned-service lines, including the parent.
    select coalesce(a.custom_price,child.base_price),coalesce(a.custom_duration_minutes,child.duration_minutes)
      into new.unit_price,new.duration_minutes from (select 1) seed
      left join staff_service_assignments a on a.service_id=child.id and a.staff_id=new.assigned_staff_id and a.salon_id=new.salon_id;
    new.line_total := new.unit_price*new.quantity;
  end if;
  if child.booking_parent_service_id is null then return new; end if;
  if new.parent_booking_line_id is null then
    select id into new.parent_booking_line_id from booking_lines
      where booking_id=new.booking_id and service_id=child.booking_parent_service_id and line_type='service'
      order by display_order limit 1;
  end if;
  if new.line_type is distinct from 'add_on' or new.parent_booking_line_id is null then
    raise exception 'Owned add-ons must be attached to a main service.';
  end if;
  select * into parent_line from booking_lines where id=new.parent_booking_line_id;
  if parent_line.service_id is distinct from child.booking_parent_service_id or parent_line.booking_id is distinct from new.booking_id then
    raise exception 'Add-on is attached to the wrong service.';
  end if;
  -- Lock the parent to serialize concurrent inserts into the same single group.
  perform 1 from booking_lines where id=new.parent_booking_line_id for update;
  if exists(select 1 from booking_lines l join services s on s.id=l.service_id
    where l.parent_booking_line_id=new.parent_booking_line_id and l.id<>new.id
      and l.line_status <> 'cancelled'
      and (l.service_id=new.service_id or (child.booking_add_on_group='one' and s.booking_add_on_group='one'))) then
    raise exception 'Choose at most one add-on from the single-choice group; duplicate extras are not allowed.';
  end if;
  return new;
end $$;
create trigger owned_booking_addon_group before insert or update of service_id,parent_booking_line_id on public.booking_lines
  for each row execute function public.assert_owned_booking_addon_group();
