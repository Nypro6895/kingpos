begin;
create table public.explore_salon_preferences (
  user_id uuid not null references public.users(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  loved boolean not null default false,
  saved boolean not null default false,
  hidden boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key(user_id, salon_id)
);
alter table public.explore_salon_preferences enable row level security;
revoke all on public.explore_salon_preferences from anon, authenticated;
grant select on public.explore_salon_preferences to authenticated;
create policy own_explore_salon_preferences on public.explore_salon_preferences for select to authenticated using(user_id=public.current_public_user_id());
create function public.set_explore_salon_preference(p_salon uuid,p_field text,p_active boolean)
returns void language plpgsql security definer set search_path=public as $$
declare actor uuid := public.current_public_user_id();
begin
  if actor is null or not exists(select 1 from users where id=actor and status='active') then raise exception 'Sign in to save your preferences.'; end if;
  if p_field not in ('loved','saved','hidden') or p_field is null or p_active is null then raise exception 'Invalid preference.'; end if;
  if not exists(select 1 from locations where id=p_salon and status='active') then raise exception 'Salon is unavailable.'; end if;
  insert into explore_salon_preferences(user_id,salon_id,loved,saved,hidden)
    values(actor,p_salon,p_field='loved' and p_active,p_field='saved' and p_active,p_field='hidden' and p_active)
  on conflict(user_id,salon_id) do update set
    loved=case when p_field='loved' then p_active else explore_salon_preferences.loved end,
    saved=case when p_field='saved' then p_active else explore_salon_preferences.saved end,
    hidden=case when p_field='hidden' then p_active else explore_salon_preferences.hidden end,updated_at=now();
end $$;
revoke all on function public.set_explore_salon_preference(uuid,text,boolean) from public;
grant execute on function public.set_explore_salon_preference(uuid,text,boolean) to authenticated;

create function public.get_my_explore_salon_preferences(p_offset integer default 0)
returns table(salon_id uuid,salon_name text,loved boolean,saved boolean,hidden boolean)
language sql stable security definer set search_path=public as $$
  select p.salon_id,l.name,p.loved,p.saved,p.hidden from explore_salon_preferences p join locations l on l.id=p.salon_id
  where p.user_id=public.current_public_user_id() and (p.saved or p.hidden or p.loved) and l.status='active'
  order by p.updated_at desc,p.salon_id limit 21 offset greatest(0,least(coalesce(p_offset,0),100000))
$$;
revoke all on function public.get_my_explore_salon_preferences(integer) from public;
grant execute on function public.get_my_explore_salon_preferences(integer) to authenticated;

alter table public.salon_profile_comments add column acting_role text check(acting_role in ('personal','staff','salon'));
-- Historical attribution survives a salon deletion; insertion validates the live salon.
alter table public.salon_profile_comments add column acting_salon_id uuid;
create function public.validate_comment_persona() returns trigger language plpgsql security definer set search_path=public as $$
declare actor uuid := public.current_public_user_id(); person_name text;
begin
  if tg_op='UPDATE' then
    if new.acting_role is distinct from old.acting_role or new.acting_salon_id is distinct from old.acting_salon_id then raise exception 'Comment identity cannot change.'; end if;
    if old.acting_role is not null and new.author_display_name is distinct from old.author_display_name then raise exception 'Comment author name cannot change.'; end if;
    return new;
  end if;
  if new.acting_role is null then
    if new.acting_salon_id is not null then raise exception 'Choose a comment identity.'; end if;
    return new;
  end if;
  if actor is null or new.author_user_id is distinct from actor then raise exception 'Invalid comment identity.'; end if;
  select coalesce(nullif(btrim(display_name),''),nullif(btrim(concat_ws(' ',first_name,last_name)),''),'Reylumi customer') into person_name from users where id=actor and status='active';
  if person_name is null then raise exception 'Account is unavailable.'; end if;
  if new.acting_role='personal' then
    if new.acting_salon_id is not null then raise exception 'Personal comments cannot claim a salon identity.'; end if;
    new.author_display_name:=person_name;
  elsif new.acting_role='salon' then
    if new.acting_salon_id is null or not coalesce(public.user_has_salon_permission(new.acting_salon_id,array['salon_profile.manage','salon_profile.content.manage']),false) then raise exception 'You cannot comment as this salon.'; end if;
    select name into new.author_display_name from locations where id=new.acting_salon_id and status='active';
    if new.author_display_name is null then raise exception 'Salon is unavailable.'; end if;
  else
    if new.acting_salon_id is null or public.current_user_staff_id_for_salon(new.acting_salon_id) is null then raise exception 'You cannot comment as staff at this salon.'; end if;
    new.author_display_name:=person_name;
  end if;
  return new;
end $$;
create trigger zz_validate_comment_persona before insert or update on public.salon_profile_comments for each row execute function public.validate_comment_persona();
commit;
