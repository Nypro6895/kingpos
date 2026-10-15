begin;
create table public.booking_policy_subscriptions (
 salon_id uuid primary key references public.locations(id) on delete cascade,
 content text not null default '' check(char_length(content)<=6000),
 published boolean not null default false,
 paid_until timestamptz,
 stripe_subscription text unique,
 stripe_checkout text,
 checkout_reference uuid not null default gen_random_uuid(),
 stripe_customer text,
 payment_owner uuid references public.users(id),
 updated_at timestamptz not null default now()
);
alter table public.booking_policy_subscriptions enable row level security;
revoke all on public.booking_policy_subscriptions from public,anon,authenticated;
grant all on public.booking_policy_subscriptions to service_role;
create function public.booking_policy_save(p_salon uuid,p_content text,p_published boolean) returns void
language plpgsql security definer set search_path=public as $$
begin
 if not coalesce(public.lifecycle_user_is_salon_owner(p_salon,public.current_public_user_id(),false),false)
 or not exists(select 1 from public.locations where id=p_salon and status='active') then raise exception 'Active salon owner access required.'; end if;
 if p_content is null or char_length(trim(p_content))>6000 or (p_published and char_length(trim(p_content))=0) then raise exception 'Enter booking rules (up to 6000 characters).'; end if;
 insert into public.booking_policy_subscriptions(salon_id,content,published) values(p_salon,trim(p_content),p_published)
 on conflict(salon_id) do update set content=trim(p_content),published=p_published,updated_at=now();
end $$;
create function public.public_booking_policy(p_salon uuid) returns text
language sql stable security definer set search_path=public as $$
 select content from public.booking_policy_subscriptions p join public.locations l on l.id=p.salon_id
 where p.salon_id=p_salon and p.published and p.paid_until>now() and l.status='active';
$$;
revoke all on function public.booking_policy_save(uuid,text,boolean),public.public_booking_policy(uuid) from public,anon,authenticated;
grant execute on function public.booking_policy_save(uuid,text,boolean) to authenticated;
grant execute on function public.public_booking_policy(uuid) to anon,authenticated;
commit;
