begin;

alter table public.check_writer_subscriptions
 add column trial_ends_at timestamptz,
 add column trial_owner uuid references public.users(id),
 add constraint check_writer_trial_owner_check check ((trial_ends_at is null) = (trial_owner is null));

-- Paid ownership and trial ownership are independent. A trial never changes
-- payment facts, a provider subscription, the paid payer or payroll records.
create or replace function public.check_writer_assert(p_salon uuid,p_actor uuid,p_paid boolean default true) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$ begin
 if not coalesce(public.lifecycle_user_is_salon_owner(p_salon,p_actor,false),false)
 or not exists(select 1 from public.locations where id=p_salon and status='active')
 or not exists(select 1 from public.users where id=p_actor and status='active')
 then raise exception 'Check Writer requires the active salon Owner.'; end if;
 if p_paid and not exists(select 1 from public.check_writer_subscriptions where salon_id=p_salon and
  ((paid_until>now() and payment_owner=p_actor) or (trial_ends_at>now() and trial_owner=p_actor)))
 then raise exception 'Activate Check Writer for this salon in Market.'; end if;
end $$;

-- Only the original server boundary can call this, after its explicit trial
-- readiness and crypto checks. A caller cannot supply identity through a URL.
create function public.check_writer_trial(p_salon uuid,p_actor uuid,p_start boolean default false) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.check_writer_subscriptions; paid_active boolean;
begin
 perform public.check_writer_assert(p_salon,p_actor,false);
 perform pg_advisory_xact_lock(hashtextextended('check-writer:'||p_salon,0));
 select * into s from public.check_writer_subscriptions where salon_id=p_salon for update;
 paid_active:=coalesce(s.paid_until>now() and s.payment_owner=p_actor,false);
 if not paid_active and s.trial_owner is not null and s.trial_owner<>p_actor then
  raise exception 'This salon trial belongs to the Owner who started it.';
 end if;
 if p_start is true and s.trial_ends_at is null and not paid_active then
  insert into public.check_writer_subscriptions(salon_id,trial_ends_at,trial_owner)
  values(p_salon,now()+interval '5 days',p_actor)
  on conflict(salon_id) do update set
   trial_ends_at=coalesce(check_writer_subscriptions.trial_ends_at,excluded.trial_ends_at),
   trial_owner=coalesce(check_writer_subscriptions.trial_owner,excluded.trial_owner)
  returning * into s;
  insert into public.check_writer_events(salon_id,actor_id,action) values(p_salon,p_actor,'trial_started');
 end if;
 return jsonb_build_object('started',s.trial_ends_at is not null,
  'active',coalesce(s.trial_ends_at>now() and s.trial_owner=p_actor,false),
  'endsAt',s.trial_ends_at,'paid',paid_active);
end $$;
revoke all on function public.check_writer_trial(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.check_writer_trial(uuid,uuid,boolean) to service_role;
revoke all on function public.check_writer_assert(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.check_writer_assert(uuid,uuid,boolean) to service_role;

commit;
