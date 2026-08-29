alter table public.pos_settings
  alter column customer_promo_title set default 'Welcome back,',
  alter column customer_promo_body set default 'Thank you for choosing us today!',
  alter column customer_left_ad_text set default 'Stay connected with our beauty community',
  alter column customer_right_ad_text set default 'Earn points & rewards. Exclusive member offers. Easy booking & reminders. Track your favorite services.';

update public.pos_settings
set customer_promo_title = 'Welcome back,'
where customer_promo_title = 'Welcome back!';

update public.pos_settings
set customer_promo_body = 'Thank you for choosing us today!'
where customer_promo_body = 'Enter your phone number to earn points and rewards';

update public.pos_settings
set customer_left_ad_text = 'Stay connected with our beauty community'
where customer_left_ad_text in (
  'Download Reylumi for easy booking and rewards.',
  'More beauty, more rewards on the Reylumi app'
);

update public.pos_settings
set customer_right_ad_text = 'Earn points & rewards. Exclusive member offers. Easy booking & reminders. Track your favorite services.'
where customer_right_ad_text in (
  'Ask the front desk about today''s services and offers.',
  'Earn points every visit. Exclusive offers for app members. Book appointments faster.'
);

create or replace function public.get_pos_setting_payload(target_salon_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  setting_row public.pos_settings%rowtype;
  salon_logo_path text;
  salon_name text;
begin
  if target_salon_id is null then
    return null;
  end if;

  select locations.name
  into salon_name
  from public.locations
  where locations.id = target_salon_id
  limit 1;

  select settings.public_profile_logo_path
  into salon_logo_path
  from public.salon_settings settings
  where settings.salon_id = target_salon_id
  limit 1;

  select *
  into setting_row
  from public.pos_settings
  where salon_id = target_salon_id
  limit 1;

  return jsonb_build_object(
    'salonName', coalesce(nullif(salon_name, ''), 'Your salon'),
    'salonLogoPath', salon_logo_path,
    'largeTurnThreshold', coalesce(setting_row.large_turn_threshold, 25),
    'tipSuggestions', to_jsonb(coalesce(setting_row.tip_suggestions, array[5, 10, 15, 20]::numeric(12,2)[])),
    'customerBackgroundImagePath', setting_row.customer_background_image_path,
    'customerLeftAdImagePath', setting_row.customer_left_ad_image_path,
    'customerRightAdImagePath', setting_row.customer_right_ad_image_path,
    'customerLeftAdText', coalesce(setting_row.customer_left_ad_text, 'Stay connected with our beauty community'),
    'customerRightAdText', coalesce(setting_row.customer_right_ad_text, 'Earn points & rewards. Exclusive member offers. Easy booking & reminders. Track your favorite services.'),
    'customerPromoTitle', coalesce(setting_row.customer_promo_title, 'Welcome back,'),
    'customerPromoBody', coalesce(setting_row.customer_promo_body, 'Thank you for choosing us today!'),
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

grant execute on function public.get_pos_setting_payload(uuid) to anon, authenticated;
