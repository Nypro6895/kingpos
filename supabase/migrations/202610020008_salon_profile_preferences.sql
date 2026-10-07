begin;
create table public.salon_profile_preferences (
  salon_id uuid primary key references public.locations(id) on delete cascade,
  show_services boolean not null default true,
  show_team boolean not null default true,
  allow_staff_posts boolean not null default true,
  allow_sharing boolean not null default true,
  allow_saves boolean not null default true,
  allow_comments boolean not null default true
);
alter table public.salon_profile_preferences enable row level security;
grant select on public.salon_profile_preferences to anon, authenticated;
grant insert, update on public.salon_profile_preferences to authenticated;
create policy "read_profile_preferences" on public.salon_profile_preferences for select to anon, authenticated using (true);
create policy "manage_profile_preferences" on public.salon_profile_preferences for all to authenticated
using (public.user_has_salon_permission(salon_id, array['salon_profile.manage']))
with check (public.user_has_salon_permission(salon_id, array['salon_profile.manage']));
create or replace function public.enforce_salon_profile_preferences()
returns trigger language plpgsql security definer set search_path = public as $$
declare target_salon uuid; enabled boolean;
begin
  if tg_table_name = 'account_post_saves' then
    if new.source_type = 'salon_profile_update' then
      select salon_id into target_salon from public.salon_profile_updates where id = new.source_id;
    elsif new.source_type = 'salon_profile_look' then
      select salon_id into target_salon from public.salon_profile_looks where id = new.source_id;
    else
      return new;
    end if;
  else
    target_salon := new.salon_id;
  end if;
  if tg_table_name = 'salon_profile_comments' then
    select allow_comments into enabled from public.salon_profile_preferences where salon_id = target_salon;
    if enabled = false then raise exception 'Comments are disabled for this salon.' using errcode = '42501'; end if;
  elsif tg_table_name in ('salon_profile_look_saves', 'account_post_saves') then
    if tg_table_name = 'salon_profile_look_saves' then
      select salon_id into target_salon from public.salon_profile_looks where id = new.look_id;
    end if;
    select allow_saves into enabled from public.salon_profile_preferences where salon_id = target_salon;
    if enabled = false then raise exception 'Saving looks is disabled for this salon.' using errcode = '42501'; end if;
  elsif tg_table_name in ('salon_profile_looks', 'salon_profile_updates', 'salon_profile_media_assets') then
    select allow_staff_posts into enabled from public.salon_profile_preferences where salon_id = target_salon;
    if enabled = false and not public.user_can_manage_salon(target_salon) then
      raise exception 'Staff posting is disabled for this salon.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_salon_profile_preferences() from public;
create trigger profile_preferences_comments before insert on public.salon_profile_comments for each row execute function public.enforce_salon_profile_preferences();
create trigger profile_preferences_saves before insert on public.salon_profile_look_saves for each row execute function public.enforce_salon_profile_preferences();
create trigger profile_preferences_looks before insert on public.salon_profile_looks for each row execute function public.enforce_salon_profile_preferences();
create trigger profile_preferences_updates before insert on public.salon_profile_updates for each row execute function public.enforce_salon_profile_preferences();
create trigger profile_preferences_media before insert on public.salon_profile_media_assets for each row when (new.upload_intent = 'content') execute function public.enforce_salon_profile_preferences();
create trigger profile_preferences_post_saves before insert on public.account_post_saves for each row execute function public.enforce_salon_profile_preferences();
commit;
