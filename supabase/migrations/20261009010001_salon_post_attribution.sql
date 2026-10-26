begin;
alter table public.salon_profile_looks add column if not exists author_presentation_role text not null default 'salon' check (author_presentation_role in ('owner','staff','salon'));
alter table public.salon_profile_updates add column if not exists author_presentation_role text not null default 'salon' check (author_presentation_role in ('owner','staff','salon'));

create or replace function public.resolve_salon_post_author_role(p_salon_id uuid, p_user_id uuid, p_staff_id uuid)
returns text language sql stable security definer set search_path=public as $$
 select case when exists (
  select 1 from account_memberships m join locations l on l.account_id=m.account_id join roles r on r.id=m.role_id
  where l.id=p_salon_id and m.user_id=p_user_id and m.status='active' and upper(r.code)='OWNER'
 ) or exists (
  select 1 from salon_memberships m join roles r on r.id=m.role_id
  where m.salon_id=p_salon_id and m.user_id=p_user_id and m.status='active' and upper(r.code)='OWNER'
 ) then 'owner' when p_staff_id is not null then 'staff' else 'salon' end;
$$;
revoke all on function public.resolve_salon_post_author_role(uuid,uuid,uuid) from public,anon,authenticated;
update public.salon_profile_looks set author_presentation_role=public.resolve_salon_post_author_role(salon_id,author_user_id,author_staff_id);
update public.salon_profile_updates set author_presentation_role=public.resolve_salon_post_author_role(salon_id,author_user_id,author_staff_id);

create or replace function public.snapshot_salon_post_author_role()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if TG_OP='INSERT' then
  NEW.author_presentation_role:=public.resolve_salon_post_author_role(NEW.salon_id,NEW.author_user_id,NEW.author_staff_id);
 elsif NEW.salon_id is distinct from OLD.salon_id or NEW.author_user_id is distinct from OLD.author_user_id
    or NEW.author_staff_id is distinct from OLD.author_staff_id or (NEW.status='published' and OLD.status='draft') then
  NEW.author_presentation_role:=public.resolve_salon_post_author_role(NEW.salon_id,NEW.author_user_id,NEW.author_staff_id);
 else
  NEW.author_presentation_role:=OLD.author_presentation_role;
 end if;
 return NEW;
end; $$;
revoke all on function public.snapshot_salon_post_author_role() from public,anon,authenticated;
drop trigger if exists snapshot_salon_post_author_role on public.salon_profile_looks;
create trigger snapshot_salon_post_author_role before insert or update on public.salon_profile_looks for each row execute function public.snapshot_salon_post_author_role();
drop trigger if exists snapshot_salon_post_author_role on public.salon_profile_updates;
create trigger snapshot_salon_post_author_role before insert or update on public.salon_profile_updates for each row execute function public.snapshot_salon_post_author_role();

-- Expose presentation roles for published salon posts without exposing owner identities.
create or replace function public.get_public_salon_post_attribution(p_content_ids uuid[])
returns table(content_id uuid, author_role text, staff_id uuid)
language sql stable security definer set search_path=public as $$
  with posts as (
    select id, salon_id, author_staff_id, author_presentation_role from salon_profile_looks
    where id = any(p_content_ids) and status = 'published'
    union all
    select id, salon_id, author_staff_id, author_presentation_role from salon_profile_updates
    where id = any(p_content_ids) and status = 'published'
  )
  select id, author_presentation_role, case when author_presentation_role='staff' then author_staff_id else null end
  from posts where public.salon_profile_public_salon_exists(salon_id)
$$;
revoke all on function public.get_public_salon_post_attribution(uuid[]) from public;
grant execute on function public.get_public_salon_post_attribution(uuid[]) to anon, authenticated;

commit;
