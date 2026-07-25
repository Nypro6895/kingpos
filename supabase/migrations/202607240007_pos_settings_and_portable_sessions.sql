create table if not exists public.pos_settings (
  salon_id uuid primary key references public.locations(id) on delete cascade,
  large_turn_threshold numeric(12,2) not null default 25,
  tip_suggestions numeric(12,2)[] not null default array[5, 10, 15, 20]::numeric(12,2)[],
  customer_background_image_path text,
  customer_left_ad_image_path text,
  customer_right_ad_image_path text,
  customer_left_ad_text text not null default 'Download Reylumi for easy booking and rewards.',
  customer_right_ad_text text not null default 'Ask the front desk about today''s services and offers.',
  customer_promo_title text not null default 'Welcome to Reylumi',
  customer_promo_body text not null default 'Review your receipt and choose your preferred tip.',
  customer_show_customer_name boolean not null default true,
  customer_show_receipt_status boolean not null default true,
  customer_show_salon_name boolean not null default true,
  customer_show_service_name boolean not null default true,
  customer_show_staff_name boolean not null default true,
  customer_show_barcode boolean not null default true,
  app_download_url text not null default 'https://reylumi.com',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_settings_large_turn_threshold_positive check (large_turn_threshold > 0),
  constraint pos_settings_tip_suggestions_count check (
    coalesce(array_length(tip_suggestions, 1), 0) = 4
  )
);

drop trigger if exists set_pos_settings_updated_at
on public.pos_settings;

create trigger set_pos_settings_updated_at
before update on public.pos_settings
for each row execute function public.set_updated_at();

alter table public.pos_settings enable row level security;

drop policy if exists "salon_member_read_pos_settings"
on public.pos_settings;

create policy "salon_member_read_pos_settings"
on public.pos_settings
for select to authenticated
using (
  public.user_has_salon_permission(
    salon_id,
    array['tickets.view', 'tickets.manage', 'salon_settings.view']
  )
);

drop policy if exists "ticket_manager_write_pos_settings"
on public.pos_settings;

create policy "ticket_manager_write_pos_settings"
on public.pos_settings
for all to authenticated
using (public.user_has_salon_permission(salon_id, array['tickets.manage']))
with check (public.user_has_salon_permission(salon_id, array['tickets.manage']));

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'pos-display-media',
  'pos-display-media',
  true,
  15728640,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "public_read_pos_display_media_objects"
on storage.objects;

create policy "public_read_pos_display_media_objects"
on storage.objects
for select to anon, authenticated
using (bucket_id = 'pos-display-media');

drop policy if exists "ticket_managers_insert_pos_display_media_objects"
on storage.objects;

create policy "ticket_managers_insert_pos_display_media_objects"
on storage.objects
for insert to authenticated
with check (
  bucket_id = 'pos-display-media'
  and case
    when split_part(storage.objects.name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then public.user_has_salon_permission(
      split_part(storage.objects.name, '/', 1)::uuid,
      array['tickets.manage']
    )
    else false
  end
);

drop policy if exists "ticket_managers_update_pos_display_media_objects"
on storage.objects;

create policy "ticket_managers_update_pos_display_media_objects"
on storage.objects
for update to authenticated
using (
  bucket_id = 'pos-display-media'
  and case
    when split_part(storage.objects.name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then public.user_has_salon_permission(
      split_part(storage.objects.name, '/', 1)::uuid,
      array['tickets.manage']
    )
    else false
  end
)
with check (
  bucket_id = 'pos-display-media'
  and case
    when split_part(storage.objects.name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then public.user_has_salon_permission(
      split_part(storage.objects.name, '/', 1)::uuid,
      array['tickets.manage']
    )
    else false
  end
);

drop policy if exists "ticket_managers_delete_pos_display_media_objects"
on storage.objects;

create policy "ticket_managers_delete_pos_display_media_objects"
on storage.objects
for delete to authenticated
using (
  bucket_id = 'pos-display-media'
  and case
    when split_part(storage.objects.name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then public.user_has_salon_permission(
      split_part(storage.objects.name, '/', 1)::uuid,
      array['tickets.manage']
    )
    else false
  end
);

alter table public.pos_portable_access_keys
add column if not exists last_login_at timestamptz,
add column if not exists last_logout_at timestamptz,
add column if not exists last_user_agent text;

create or replace function public.get_pos_setting_payload(target_salon_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  setting_row public.pos_settings%rowtype;
begin
  if target_salon_id is null then
    return null;
  end if;

  select *
  into setting_row
  from public.pos_settings
  where salon_id = target_salon_id
  limit 1;

  return jsonb_build_object(
    'largeTurnThreshold', coalesce(setting_row.large_turn_threshold, 25),
    'tipSuggestions', to_jsonb(coalesce(setting_row.tip_suggestions, array[5, 10, 15, 20]::numeric(12,2)[])),
    'customerBackgroundImagePath', setting_row.customer_background_image_path,
    'customerLeftAdImagePath', setting_row.customer_left_ad_image_path,
    'customerRightAdImagePath', setting_row.customer_right_ad_image_path,
    'customerLeftAdText', coalesce(setting_row.customer_left_ad_text, 'Download Reylumi for easy booking and rewards.'),
    'customerRightAdText', coalesce(setting_row.customer_right_ad_text, 'Ask the front desk about today''s services and offers.'),
    'customerPromoTitle', coalesce(setting_row.customer_promo_title, 'Welcome to Reylumi'),
    'customerPromoBody', coalesce(setting_row.customer_promo_body, 'Review your receipt and choose your preferred tip.'),
    'customerShowCustomerName', coalesce(setting_row.customer_show_customer_name, true),
    'customerShowReceiptStatus', coalesce(setting_row.customer_show_receipt_status, true),
    'customerShowSalonName', coalesce(setting_row.customer_show_salon_name, true),
    'customerShowServiceName', coalesce(setting_row.customer_show_service_name, true),
    'customerShowStaffName', coalesce(setting_row.customer_show_staff_name, true),
    'customerShowBarcode', coalesce(setting_row.customer_show_barcode, true),
    'appDownloadUrl', coalesce(nullif(setting_row.app_download_url, ''), 'https://reylumi.com')
  );
end;
$$;

create or replace function public.get_pos_customer_display_settings_by_token(
  p_token text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  target_salon_id uuid;
begin
  select salon_id
  into target_salon_id
  from public.pos_live_drafts
  where token = btrim(coalesce(p_token, ''))
  order by updated_at desc
  limit 1;

  if target_salon_id is null then
    return public.get_pos_setting_payload(null);
  end if;

  return public.get_pos_setting_payload(target_salon_id);
end;
$$;

drop function if exists public.sign_in_pos_portable_access(text, text);

create or replace function public.sign_in_pos_portable_access(
  p_access_id text,
  p_passcode text,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  access_query text := lower(btrim(coalesce(p_access_id, '')));
  passcode_value text := btrim(coalesce(p_passcode, ''));
  expected_digest text;
  key_row public.pos_portable_access_keys%rowtype;
  salon_name text;
begin
  if access_query = '' or passcode_value = '' then
    return null;
  end if;

  select access_keys.*
  into key_row
  from public.pos_portable_access_keys access_keys
  join public.locations on locations.id = access_keys.salon_id
  where lower(btrim(access_keys.access_id)) = access_query
    and access_keys.is_active = true
    and locations.status = 'active'
  limit 1;

  if key_row.id is null then
    return null;
  end if;

  select locations.name
  into salon_name
  from public.locations
  where locations.id = key_row.salon_id
  limit 1;

  expected_digest := encode(
    extensions.digest(
      access_query || ':' || passcode_value || ':' || key_row.passcode_salt,
      'sha256'
    ),
    'hex'
  );

  if expected_digest <> key_row.passcode_digest then
    return null;
  end if;

  update public.pos_portable_access_keys
  set last_login_at = now(),
      last_used_at = now(),
      last_user_agent = nullif(left(coalesce(p_user_agent, ''), 500), '')
  where id = key_row.id;

  return jsonb_build_object(
    'key_id', key_row.id,
    'access_id', key_row.access_id,
    'salon_id', key_row.salon_id,
    'salon_name', salon_name,
    'signature', public.pos_portable_access_signature(key_row.id, key_row.passcode_digest)
  );
end;
$$;

create or replace function public.log_out_pos_portable_access(
  p_key_id uuid,
  p_session_signature text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_salon_id uuid;
begin
  target_salon_id := public.pos_portable_access_salon_id(p_key_id, p_session_signature);

  if target_salon_id is null then
    return false;
  end if;

  update public.pos_portable_access_keys
  set last_logout_at = now()
  where id = p_key_id
    and salon_id = target_salon_id;

  return true;
end;
$$;

create or replace function public.get_pos_portable_desk_data(
  p_key_id uuid,
  p_session_signature text,
  p_work_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_salon_id uuid;
  salon_name text;
  services_json jsonb;
  staff_json jsonb;
  draft_row public.pos_live_drafts%rowtype;
begin
  target_salon_id := public.pos_portable_access_salon_id(p_key_id, p_session_signature);

  if target_salon_id is null then
    return null;
  end if;

  select locations.name
  into salon_name
  from public.locations
  where locations.id = target_salon_id
  limit 1;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', services.id,
        'name', services.name,
        'category', services.category,
        'base_price', services.base_price
      )
      order by services.name
    ),
    '[]'::jsonb
  )
  into services_json
  from public.services
  where services.salon_id = target_salon_id
    and services.is_active = true;

  with turn_counts as (
    select
      turns.staff_id,
      count(*) filter (where turns.turn_type = 'large')::integer as large_turns,
      count(*) filter (where turns.turn_type = 'small')::integer as small_turns,
      count(*)::integer as total_turns
    from public.pos_ticket_item_turn_parts turns
    where turns.salon_id = target_salon_id
      and turns.work_date = p_work_date
    group by turns.staff_id
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', staff.id,
        'display_name', staff.display_name,
        'job_title', staff.job_title,
        'is_active', staff.is_active,
        'today_status', coalesce(staff_workdays.status, 'not_checked_in'),
        'turns', jsonb_build_object(
          'largeTurns', coalesce(turn_counts.large_turns, 0),
          'smallTurns', coalesce(turn_counts.small_turns, 0),
          'totalTurns', coalesce(turn_counts.total_turns, 0)
        )
      )
      order by
        coalesce(turn_counts.total_turns, 0),
        coalesce(turn_counts.large_turns, 0),
        staff.display_name
    ),
    '[]'::jsonb
  )
  into staff_json
  from public.staff
  left join public.staff_workdays
    on staff_workdays.staff_id = staff.id
    and staff_workdays.salon_id = staff.salon_id
    and staff_workdays.work_date = p_work_date
  left join turn_counts on turn_counts.staff_id = staff.id
  where staff.salon_id = target_salon_id
    and staff.is_active = true
    and staff.pos_enabled = true;

  select *
  into draft_row
  from public.pos_live_drafts
  where salon_id = target_salon_id
    and status = 'draft'
  order by updated_at desc
  limit 1;

  if draft_row.id is null then
    insert into public.pos_live_drafts (
      receipt,
      salon_id,
      staff_lines,
      subtotal,
      tip,
      token,
      total
    )
    values (
      '{}'::jsonb,
      target_salon_id,
      '[]'::jsonb,
      0,
      0,
      replace(gen_random_uuid()::text, '-', ''),
      0
    )
    returning * into draft_row;
  end if;

  return jsonb_build_object(
    'salonName', salon_name,
    'settings', public.get_pos_setting_payload(target_salon_id),
    'services', services_json,
    'staff', staff_json,
    'liveDraft', jsonb_build_object(
      'id', draft_row.id,
      'salon_id', draft_row.salon_id,
      'token', draft_row.token,
      'customer', draft_row.customer,
      'staff_lines', draft_row.staff_lines,
      'selected_staff_id', draft_row.selected_staff_id,
      'tip', draft_row.tip,
      'subtotal', draft_row.subtotal,
      'total', draft_row.total,
      'status', draft_row.status,
      'version', draft_row.version,
      'updated_at', draft_row.updated_at
    )
  );
end;
$$;

grant select, insert, update, delete on table public.pos_settings to authenticated;
grant execute on function public.get_pos_setting_payload(uuid) to anon, authenticated;
grant execute on function public.get_pos_customer_display_settings_by_token(text) to anon, authenticated;
grant execute on function public.sign_in_pos_portable_access(text, text, text) to anon, authenticated;
grant execute on function public.log_out_pos_portable_access(uuid, text) to anon, authenticated;
