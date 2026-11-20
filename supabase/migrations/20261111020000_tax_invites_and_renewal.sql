begin;
-- A copied invitation is an owner-issued capability, never a salon password.
create table public.tax_invitations (
 id uuid primary key default gen_random_uuid(), salon_id uuid not null references public.locations(id),
 token_hash text not null unique, generation bigint not null, created_by uuid not null references public.users(id),
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '7 days',
 accepted_by uuid references public.users(id), accepted_at timestamptz, revoked_at timestamptz
);
create index tax_invitations_pending_salon on public.tax_invitations(salon_id) where accepted_by is null and revoked_at is null;
alter table public.tax_invitations enable row level security;
revoke all on public.tax_invitations from public,anon,authenticated;

create function public.tax_create_invitation(p_salon uuid) returns jsonb
language plpgsql security definer set search_path=public,extensions as $$
declare k tax_company_credentials; raw text; item tax_invitations; begin
 if not tax_is_owner(p_salon) then raise exception 'Salon owner access required.'; end if;
 select * into k from tax_company_credentials where salon_id=p_salon for update;
 if not found or not k.enabled or not exists(select 1 from tax_company_subscriptions s join locations l on l.id=s.salon_id where s.salon_id=p_salon and l.status='active' and greatest(s.paid_until,s.trial_ends_at)>now()) then
 raise exception 'Activate Tax Company and create salon credentials first.'; end if;
 -- One outstanding invitation per salon; accepted accounts are not disconnected.
 update tax_invitations set revoked_at=now() where salon_id=p_salon and accepted_by is null and revoked_at is null;
 raw:=encode(gen_random_bytes(32),'hex');
 insert into tax_invitations(salon_id,token_hash,generation,created_by) values(p_salon,encode(digest(raw,'sha256'),'hex'),k.generation,tax_actor()) returning * into item;
 return jsonb_build_object('token',raw,'expires_at',item.expires_at);
end $$;
create function public.tax_revoke_invitation(p_salon uuid) returns void
language plpgsql security definer set search_path=public as $$ begin
 if not tax_is_owner(p_salon) then raise exception 'Salon owner access required.'; end if;
 update tax_invitations set revoked_at=now() where salon_id=p_salon and accepted_by is null and revoked_at is null;
end $$;
create function public.tax_invitation_preview(p_token text) returns jsonb
language plpgsql stable security definer set search_path=public,extensions as $$
declare item tax_invitations; k tax_company_credentials; begin
 perform tax_actor();
 if p_token !~ '^[0-9a-f]{64}$' then raise exception 'Invitation is unavailable. Ask the owner for a new link.'; end if;
 select * into item from tax_invitations where token_hash=encode(digest(p_token,'sha256'),'hex');
 select * into k from tax_company_credentials where salon_id=item.salon_id;
 if item.id is null or item.revoked_at is not null or item.expires_at<=now() or not coalesce(k.enabled,false) or k.generation<>item.generation or (item.accepted_by is not null and item.accepted_by<>tax_actor()) or not exists(select 1 from locations where id=item.salon_id and status='active') then
 raise exception 'Invitation is unavailable. Ask the owner for a new link.'; end if;
 return jsonb_build_object('salon_id',item.salon_id,'salon_name',(select name from locations where id=item.salon_id),'expires_at',item.expires_at,'active',exists(select 1 from tax_company_subscriptions s where s.salon_id=item.salon_id and greatest(s.paid_until,s.trial_ends_at)>now()));
end $$;
create function public.tax_accept_invitation(p_token text) returns uuid
language plpgsql security definer set search_path=public,extensions as $$
declare item tax_invitations; k tax_company_credentials; actor uuid:=tax_actor(); begin
 if not exists(select 1 from tax_profiles where user_id=actor) then raise exception 'Activate your Tax profile first.'; end if;
 select * into item from tax_invitations where token_hash=encode(digest(p_token,'sha256'),'hex');
 -- Lock the same credential row as rotation/disconnection, so a revocation cannot race acceptance.
 select * into k from tax_company_credentials where salon_id=item.salon_id for update;
 select * into item from tax_invitations where id=item.id for update;
 -- Validate the locked versions themselves, including a revocation that committed
 -- while acceptance waited for the locks. Do not re-read through a stable preview.
 if item.id is null or item.revoked_at is not null or item.expires_at<=now() or not coalesce(k.enabled,false) or k.generation<>item.generation or (item.accepted_by is not null and item.accepted_by<>actor) or not exists(select 1 from locations where id=item.salon_id and status='active') then
 raise exception 'Invitation is unavailable. Ask the owner for a new link.'; end if;
 if not exists(select 1 from tax_company_subscriptions s where s.salon_id=item.salon_id and greatest(s.paid_until,s.trial_ends_at)>now()) then raise exception 'The owner needs to renew Tax Company access. Your Tax account is ready; return to this invitation after renewal.'; end if;
 insert into tax_company_connections(salon_id,user_id,generation) values(item.salon_id,actor,k.generation)
 on conflict(salon_id,user_id) do update set generation=excluded.generation;
 update tax_invitations set accepted_by=actor,accepted_at=coalesce(accepted_at,now()) where id=item.id;
 return item.salon_id;
end $$;
revoke all on function public.tax_create_invitation(uuid),public.tax_revoke_invitation(uuid),public.tax_invitation_preview(text),public.tax_accept_invitation(text) from public,anon;
grant execute on function public.tax_create_invitation(uuid),public.tax_revoke_invitation(uuid),public.tax_invitation_preview(text),public.tax_accept_invitation(text) to authenticated;

-- Existing reservations must retain their original provider payload. Only an
-- INSERT inside this owner-checked wrapper captures the originating page.
create or replace function public.tax_activation_checkout_snapshot() returns trigger language plpgsql set search_path=public as $$
declare target text:=current_setting('app.tax_checkout_return',true); begin
 if new.plugin_id='tax-company' then
  new.snapshot:=new.snapshot || jsonb_build_object('tax_activation_setup',true);
  if target in ('/payroll/tax-company/settings','/payroll/tax-company/workspace') then
   new.snapshot:=new.snapshot || jsonb_build_object('tax_return_path',target);
  end if;
 end if; return new;
end $$;
create function public.tax_card_reserve(p_salon uuid,p_external boolean,p_return text) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
 perform market_billing_require_owner(p_salon);
 if p_return not in ('/payroll/tax-company/settings','/payroll/tax-company/workspace') or p_return is null then raise exception 'Invalid Tax return page.'; end if;
 perform set_config('app.tax_checkout_return',p_return,true);
 if p_external then return market_card_reserve_safari(p_salon,'tax-company'); end if;
 return market_card_reserve(p_salon,'tax-company');
end $$;
revoke all on function public.tax_card_reserve(uuid,boolean,text) from public,anon;
grant execute on function public.tax_card_reserve(uuid,boolean,text) to authenticated;
notify pgrst,'reload schema';
commit;
