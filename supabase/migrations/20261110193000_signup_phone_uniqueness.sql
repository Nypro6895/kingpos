-- A pending signup reserves a number, but is never proof of ownership.
-- No legacy accounts or customer/salon records are rewritten or merged.
begin;

create table public.account_signup_phones (
  normalized_phone text primary key,
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint account_signup_phones_normalized check (
    public.normalize_customer_claim_phone(normalized_phone) is not null
    and normalized_phone = public.normalize_customer_claim_phone(normalized_phone)
  )
);
alter table public.account_signup_phones enable row level security;
revoke all on public.account_signup_phones from public, anon, authenticated;

-- Internal predicate also accounts for legacy accounts that predate reservations.
-- Salon customer records are intentionally excluded: they are not login accounts.
create function public.account_phone_available(p_phone text, p_except_auth uuid default null)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.normalize_customer_claim_phone(p_phone) is not null
    and not exists (
      select 1 from public.account_signup_phones p
      where p.normalized_phone=public.normalize_customer_claim_phone(p_phone)
        and p.auth_user_id is distinct from p_except_auth
    ) and not exists (
      select 1 from auth.users a
      where a.id is distinct from p_except_auth and (
        public.normalize_customer_claim_phone(a.phone)=public.normalize_customer_claim_phone(p_phone)
        or (not exists(select 1 from public.account_signup_phones r where r.auth_user_id=a.id)
          and public.normalize_customer_claim_phone(a.raw_user_meta_data->>'signup_phone')=public.normalize_customer_claim_phone(p_phone))
      )
    ) and not exists (
      select 1 from public.users u where u.auth_user_id is distinct from p_except_auth
        and public.normalize_customer_claim_phone(u.phone)=public.normalize_customer_claim_phone(p_phone)
    ) and not exists (
      select 1 from public.customer_verified_phones v join public.users u on u.id=v.user_id
      where u.auth_user_id is distinct from p_except_auth
        and v.normalized_phone=public.normalize_customer_claim_phone(p_phone)
    );
$$;
revoke all on function public.account_phone_available(text,uuid) from public,anon,authenticated;

create function public.signup_phone_available(p_phone text)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.account_phone_available(p_phone,null);
$$;
revoke all on function public.signup_phone_available(text) from public,anon,authenticated;
grant execute on function public.signup_phone_available(text) to service_role;

create function public.reserve_account_signup_phone() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare phone_value text;
begin
  if tg_op='INSERT' then
    phone_value:=public.normalize_customer_claim_phone(coalesce(nullif(new.phone,''),new.raw_user_meta_data->>'signup_phone'));
    -- Staff invitation and provider accounts without a phone still need OTP before posting.
    if phone_value is null then
      if nullif(new.raw_user_meta_data->>'signup_phone','') is not null then
        raise exception 'Enter a valid phone number.';
      end if;
      return new;
    end if;
  else
    -- Updating editable metadata never grants or changes phone ownership.
    if new.phone_confirmed_at is null then return new; end if;
    phone_value:=public.normalize_customer_claim_phone(new.phone);
    if phone_value is null then return new; end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('account-phone:'||phone_value,0));
  if not public.account_phone_available(phone_value,new.id) then
    raise exception 'This phone number is already used by another account. Contact support for help.' using errcode='23505';
  end if;
  -- Replacing a phone is only possible after Auth confirms the new number.
  insert into public.account_signup_phones(normalized_phone,auth_user_id)
    values(phone_value,new.id)
    on conflict(auth_user_id) do update set normalized_phone=excluded.normalized_phone;
  return new;
end;
$$;
revoke all on function public.reserve_account_signup_phone() from public,anon,authenticated;
create trigger reserve_account_signup_phone after insert or update of phone,phone_confirmed_at on auth.users
  for each row execute function public.reserve_account_signup_phone();

-- Check the actor's current Auth phone, never signup completion metadata or a QR claim.
create function public.account_has_verified_post_phone(p_user_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists (
    select 1 from public.users u join auth.users a on a.id=u.auth_user_id
    where u.id=p_user_id and a.phone_confirmed_at is not null
      and public.normalize_customer_claim_phone(a.phone) is not null
      and public.account_phone_available(a.phone,a.id)
  );
$$;
revoke all on function public.account_has_verified_post_phone(uuid) from public,anon,authenticated;
grant execute on function public.account_has_verified_post_phone(uuid) to service_role;

create function public.require_verified_post_phone() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare row_data jsonb:=to_jsonb(new); old_data jsonb; author_id uuid; actor_id uuid;
begin
  if tg_table_name='beauty_post_media' then
    if tg_op='UPDATE' and new.object_path is not distinct from old.object_path
      and new.post_id is not distinct from old.post_id and new.role is not distinct from old.role then return new; end if;
    select p.author_user_id into author_id from public.beauty_posts p where p.id=new.post_id;
    if not public.account_has_verified_post_phone(coalesce(public.current_public_user_id(),author_id)) then
      raise exception 'Verify your phone number in Profile before posting.' using errcode='42501';
    end if;
    return new;
  end if;
  if tg_op='UPDATE' then
    old_data:=to_jsonb(old);
    -- Moderation/removal and unrelated metadata updates remain possible.
    if (row_data - array['status','visibility','moderation_status','deleted_at','updated_at','edited_at','safety_hold','published_at','is_pinned'])
      is not distinct from (old_data - array['status','visibility','moderation_status','deleted_at','updated_at','edited_at','safety_hold','published_at','is_pinned'])
      and not coalesce(row_data->>'status'='published' and old_data->>'status' is distinct from 'published',false)
      and not coalesce(row_data->>'visibility' in ('public','followers') and old_data->>'visibility' is distinct from row_data->>'visibility',false)
      and not coalesce(row_data->>'moderation_status'='visible' and old_data->>'moderation_status' is distinct from 'visible',false)
      and not (row_data->>'deleted_at' is null and old_data->>'deleted_at' is not null)
    then return new; end if;
  end if;
  author_id:=coalesce((row_data->>'author_user_id')::uuid,(row_data->>'created_by_user_id')::uuid);
  actor_id:=public.current_public_user_id();
  -- Service-role publication must validate the author too.
  if not public.account_has_verified_post_phone(coalesce(actor_id,author_id)) then
    raise exception 'Verify your phone number in Profile before posting.' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function public.require_verified_post_phone() from public,anon,authenticated;
create trigger ab_verified_post_phone before insert or update on public.beauty_posts
  for each row execute function public.require_verified_post_phone();
create trigger ab_verified_post_phone before insert or update on public.salon_profile_looks
  for each row execute function public.require_verified_post_phone();
create trigger ab_verified_post_phone before insert or update on public.salon_profile_updates
  for each row execute function public.require_verified_post_phone();
create trigger ab_verified_post_phone before insert or update on public.beauty_post_media
  for each row execute function public.require_verified_post_phone();

commit;
