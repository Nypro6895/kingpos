begin;

-- Trial time never changes paid_until, checkout reservations, or payer ownership.
alter table public.booking_policy_subscriptions add column trial_ends_at timestamptz;
alter table public.booking_deposit_subscriptions add column trial_ends_at timestamptz;
alter table public.checkin_receipt_subscriptions add column trial_ends_at timestamptz;
alter table public.tax_company_subscriptions add column trial_ends_at timestamptz;
alter table public.booksms_subscriptions add column trial_ends_at timestamptz;

create function public.market_plugin_trial(p_salon uuid,p_plugin text,p_start boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare target text; expiry timestamptz; paid timestamptz;
begin
 if not coalesce(lifecycle_user_is_salon_owner(p_salon,current_public_user_id(),false),false)
 or not exists(select 1 from locations where id=p_salon and status='active')
 or not exists(select 1 from users where id=current_public_user_id() and status='active')
 then raise exception 'Active salon owner access required.'; end if;
 target:=case p_plugin
  when 'booking-policy' then 'booking_policy_subscriptions'
  when 'booking-deposit' then 'booking_deposit_subscriptions'
  when 'checkin-receipt' then 'checkin_receipt_subscriptions'
  when 'tax-company' then 'tax_company_subscriptions'
  when 'booksms' then 'booksms_subscriptions' end;
 if target is null then raise exception 'This plugin uses its own free activation.'; end if;
 if p_start is true then
  -- A single UPSERT arbitrates concurrent starts. The original expiry is retained
  -- after expiration, disable/re-enable, retries, or an owner change.
  execute format('insert into public.%I(salon_id,trial_ends_at) values($1,now()+interval ''5 days'')
   on conflict(salon_id) do update set trial_ends_at=coalesce(%I.trial_ends_at,excluded.trial_ends_at)',target,target) using p_salon;
  if p_plugin='booking-deposit' then update booking_deposit_subscriptions set installed=true where salon_id=p_salon;
  elsif p_plugin='booksms' then
   update booksms_subscriptions set installed=true,monthly_limit=case when paid_until>now() then monthly_limit else 10 end where salon_id=p_salon;
  end if;
 end if;
 execute format('select trial_ends_at,paid_until from public.%I where salon_id=$1',target) into expiry,paid using p_salon;
 return jsonb_build_object('started',expiry is not null,'active',coalesce(expiry>now(),false),'endsAt',expiry,'paid',coalesce(paid>now(),false));
end $$;
revoke all on function public.market_plugin_trial(uuid,text,boolean) from public,anon;
grant execute on function public.market_plugin_trial(uuid,text,boolean) to authenticated;

-- Amend only runtime access gates, preserving their latest authorization and
-- business logic. Billing/settlement/refund functions continue to use paid time.
do $$ declare item record; definition text; amended text;
begin
 for item in select oid from pg_proc where pronamespace='public'::regnamespace and proname=any(array[
  'issue_checkin_receipt','resolve_checkin_receipt','personal_qr_ensure_receipt_for_visit','staff_scan_available',
  'public_booking_policy','booking_deposit_save','public_booking_deposit',
  'tax_company_has_access','tax_company_settings','tax_company_connect',
  'booksms_has_access','booksms_owner_state','booksms_save'
 ]) loop
  definition:=pg_get_functiondef(item.oid);
  amended:=regexp_replace(definition,'\m([a-z_]+\.)?paid_until\s*>\s*now\(\)',
   'greatest(\1paid_until,\1trial_ends_at)>now()','g');
  if definition like '%booksms_owner_state%' then
   amended:=replace(amended,'''paidUntil'',s.paid_until','''subscribed'',s.stripe_subscription is not null,''paidUntil'',s.paid_until');
  end if;
  if amended<>definition then execute amended; end if;
 end loop;
end $$;

-- Complete the BookSMS card path using the same verified invoice transaction.
-- Keep purchases closed until its catalog price and allowance are approved.
do $$ declare definition text; amended text;
begin
 definition:=pg_get_functiondef('public.market_card_reserve(uuid,text)'::regprocedure);
 amended:=replace(definition,'''checkin-receipt'',''tax-company''','''checkin-receipt'',''tax-company'',''booksms''');
 if amended=definition then raise exception 'Review card plugin allowlist before enabling BookSMS'; end if;
 definition:=amended;
 amended:=replace(definition,'elsif p_plugin=''booking-policy'' then',
  'elsif p_plugin=''booksms'' then select stripe_subscription,paid_until,stripe_checkout into sub,until_time,checkout from booksms_subscriptions where salon_id=p_salon for update;'||E'\n elsif p_plugin=''booking-policy'' then');
 if amended=definition then raise exception 'Review card reservation before enabling BookSMS'; end if;
 definition:=amended;
 amended:=replace(definition,'''commission_bps'',c.commission_bps', '''monthly_sms_limit'',c.monthly_sms_limit,''commission_bps'',c.commission_bps');
 if amended=definition then raise exception 'Review card snapshot before enabling BookSMS'; end if;
 execute amended;

 definition:=pg_get_functiondef('public.market_card_apply(uuid,text,text,text,text,integer,integer,text,timestamptz,timestamptz)'::regprocedure);
 amended:=replace(definition,'when ''booking-policy'' then ''booking_policy_subscriptions''',
  'when ''booksms'' then ''booksms_subscriptions'' when ''booking-policy'' then ''booking_policy_subscriptions''');
 if amended=definition then raise exception 'Review card fulfillment before enabling BookSMS'; end if;
 definition:=amended;
 amended:=replace(definition,'update market_card_purchases set subscription_id=',
  'if p.plugin_id=''booksms'' then update booksms_subscriptions set installed=case when p.subscription_id is null and grant_until>now() then true else installed end, monthly_limit=case when grant_until>now() then coalesce((p.snapshot->>''monthly_sms_limit'')::integer,0) when trial_ends_at>now() then 10 else 0 end where salon_id=p.salon_id; end if;'||E'\n update market_card_purchases set subscription_id=');
 if amended=definition then raise exception 'Review card allowance fulfillment before enabling BookSMS'; end if;
 execute amended;
end $$;
commit;
