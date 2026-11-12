begin;
-- Personal profile language is deliberately not migrated: it never represented
-- a consented choice for a particular salon.
alter table public.vietnamese_plugin_subscriptions add column language_activation uuid not null default gen_random_uuid();
alter table public.vietnamese_plugin_subscriptions add column staff_language_activation uuid not null default gen_random_uuid();
create function public.rotate_language_activation() returns trigger
language plpgsql set search_path=public as $$
begin
 if (new.installed and not old.installed)
 or (greatest(old.trial_ends_at,old.paid_until)<=now() and greatest(new.trial_ends_at,new.paid_until)>now()) then
   new.language_activation := gen_random_uuid();
   new.staff_language_activation := gen_random_uuid();
 elsif new.staff_enabled and not old.staff_enabled then
   new.staff_language_activation := gen_random_uuid();
 end if;
 return new;
end $$;
create trigger vietnamese_language_activation before update on public.vietnamese_plugin_subscriptions
for each row execute function public.rotate_language_activation();

create table public.salon_language_choices (
 user_id uuid not null references public.users(id) on delete cascade,
 salon_id uuid not null references public.locations(id) on delete cascade,
 language text not null default 'en', activation uuid, revision bigint not null default 1, updated_at timestamptz not null default now(),
 primary key(user_id,salon_id)
);
create table public.salon_language_notices (
 user_id uuid not null references public.users(id) on delete cascade,
 salon_id uuid not null references public.locations(id) on delete cascade,
 language text not null, activation uuid not null,
 seen_at timestamptz, accepted_at timestamptz, created_at timestamptz not null default now(),
 primary key(user_id,salon_id,language,activation)
);
alter table public.salon_language_choices enable row level security;
alter table public.salon_language_notices enable row level security;
revoke all on public.salon_language_choices,public.salon_language_notices from public,anon,authenticated;
grant all on public.salon_language_choices,public.salon_language_notices to service_role;

-- The sole adapter to the current package. Future packages can add offers
-- without changing preference or notice storage or the client contract.
create function public.salon_language_offers(p_salon uuid,p_staff boolean default null) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare actor uuid := public.current_public_user_id(); owner boolean; subscription public.vietnamese_plugin_subscriptions;
begin
 owner := coalesce(public.lifecycle_user_is_salon_owner(p_salon,actor,false),false);
 if actor is null or not ((owner and p_staff is distinct from true) or (p_staff is distinct from false and exists(select 1 from public.staff where salon_id=p_salon and account_user_id=actor and is_active)))
 or not exists(select 1 from public.locations where id=p_salon and status='active') then raise exception 'Salon access required.'; end if;
 select * into subscription from public.vietnamese_plugin_subscriptions where salon_id=p_salon;
 if found and subscription.installed and ((owner and p_staff is distinct from true) or subscription.staff_enabled)
 and greatest(subscription.trial_ends_at,subscription.paid_until)>now() then
   return jsonb_build_array(jsonb_build_object('code','vi','activation',case when owner and p_staff is distinct from true then subscription.language_activation else subscription.staff_language_activation end,
     'consentActivations',jsonb_build_array(subscription.language_activation,subscription.staff_language_activation),
     'expiresAt',greatest(subscription.trial_ends_at,subscription.paid_until)));
 end if;
 return '[]'::jsonb;
end $$;

create function public.salon_language_state(p_salon uuid,p_staff boolean default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor uuid := public.current_public_user_id(); offers jsonb; selected text; effective text; chosen_activation uuid; choice_revision bigint;
begin
 offers := public.salon_language_offers(p_salon,p_staff);
 -- Durable, deduplicated inbox; also covers staff who join after activation.
 insert into public.salon_language_notices(user_id,salon_id,language,activation)
 select actor,p_salon,o->>'code',(o->>'activation')::uuid from jsonb_array_elements(offers) o
 on conflict do nothing;
 select language,activation,revision into selected,chosen_activation,choice_revision from public.salon_language_choices where user_id=actor and salon_id=p_salon;
 selected := coalesce(selected,'en');
 effective := case when exists(select 1 from jsonb_array_elements(offers) o where o->>'code'=selected and (o->'consentActivations') ? chosen_activation::text) then selected else 'en' end;
 return jsonb_build_object('salonId',p_salon,'salonName',(select name from public.locations where id=p_salon),
 'selected',selected,'selectedActivation',case when selected=effective then (select o->>'activation' from jsonb_array_elements(offers) o where o->>'code'=selected limit 1) else chosen_activation::text end,'choiceRevision',coalesce(choice_revision,0)::text,'effective',effective,'unavailable',selected<>effective,'offers',offers,'notices',
 coalesce((select jsonb_agg(jsonb_build_object('code',n.language,'activation',n.activation,'seen',n.seen_at is not null,'accepted',n.accepted_at is not null) order by n.created_at)
 from public.salon_language_notices n where n.user_id=actor and n.salon_id=p_salon
 and exists(select 1 from jsonb_array_elements(offers) o where o->>'code'=n.language and o->>'activation'=n.activation::text)),'[]'::jsonb));
end $$;

create function public.salon_language_choose(p_salon uuid,p_language text,p_activation uuid default null,p_staff boolean default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor uuid := public.current_public_user_id(); offers jsonb;
begin
 -- Lock entitlement changes through this transaction so a revoked offer cannot
 -- be accepted between validation and saving.
 perform 1 from public.vietnamese_plugin_subscriptions where salon_id=p_salon for share;
 offers := public.salon_language_offers(p_salon,p_staff);
 if p_language is null or (p_language<>'en' and not exists(select 1 from jsonb_array_elements(offers) o
 where o->>'code'=p_language and (p_activation is null or o->>'activation'=p_activation::text))) then
   raise exception 'This language is no longer available. Refresh and try again.';
 end if;
 insert into public.salon_language_choices(user_id,salon_id,language,activation)
 values(actor,p_salon,p_language,(select (o->>'activation')::uuid from jsonb_array_elements(offers) o where o->>'code'=p_language limit 1))
 on conflict(user_id,salon_id) do update set language=excluded.language,activation=excluded.activation,revision=salon_language_choices.revision+1,updated_at=now();
 perform public.salon_language_state(p_salon,p_staff);
 -- Explicitly choosing a language also acknowledges currently offered packages;
 -- a later activation has a new identity and can invite the user again.
 update public.salon_language_notices n set seen_at=coalesce(seen_at,now()),
 accepted_at=case when language=p_language then now() else accepted_at end
 where user_id=actor and salon_id=p_salon and exists(select 1 from jsonb_array_elements(offers) o where o->>'code'=n.language and o->>'activation'=n.activation::text);
 return public.salon_language_state(p_salon,p_staff);
end $$;

create function public.salon_language_notice_seen(p_salon uuid,p_language text,p_activation uuid,p_staff boolean default null) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
 perform public.salon_language_state(p_salon,p_staff);
 update public.salon_language_notices set seen_at=coalesce(seen_at,now())
 where user_id=public.current_public_user_id() and salon_id=p_salon and language=p_language and activation=p_activation;
 return public.salon_language_state(p_salon,p_staff);
end $$;
revoke all on function public.rotate_language_activation(),public.salon_language_offers(uuid,boolean),public.salon_language_state(uuid,boolean),public.salon_language_choose(uuid,text,uuid,boolean),public.salon_language_notice_seen(uuid,text,uuid,boolean) from public,anon;
grant execute on function public.salon_language_offers(uuid,boolean),public.salon_language_state(uuid,boolean),public.salon_language_choose(uuid,text,uuid,boolean),public.salon_language_notice_seen(uuid,text,uuid,boolean) to authenticated;
commit;
