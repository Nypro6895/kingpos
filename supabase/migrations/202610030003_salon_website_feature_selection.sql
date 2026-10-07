begin;
create table public.salon_website_feature_selection (
 salon_id uuid primary key references public.locations(id) on delete cascade,
 look_id uuid references public.salon_profile_looks(id) on delete set null,
 selected_day date not null
);
alter table public.salon_website_feature_selection enable row level security;
revoke all on public.salon_website_feature_selection from anon, authenticated;

create or replace function public.set_owned_salon_featured_look(target_salon_id uuid,target_look_id uuid,pinned boolean)
returns void language plpgsql security definer set search_path=public as $$
declare actor uuid := public.current_public_user_id(); target public.salon_profile_looks%rowtype;
begin
 if actor is null or not exists(select 1 from public.locations l join public.account_memberships m on m.account_id=l.account_id join public.roles r on r.id=m.role_id where l.id=target_salon_id and m.user_id=actor and m.status='active' and upper(r.code)='OWNER') then
  raise exception 'Only the salon owner can select a featured photo.' using errcode='42501';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(target_salon_id::text,7));
 select * into target from public.salon_profile_looks where id=target_look_id and salon_id=target_salon_id for update;
 if target.id is null or coalesce(target.created_by_user_id,target.author_user_id) is distinct from actor then
  raise exception 'You can only feature a post you own.' using errcode='42501';
 end if;
 if pinned and (target.status <> 'published' or nullif(btrim(target.media_path),'') is null) then raise exception 'Choose a published post with a photo.'; end if;
 if pinned then update public.salon_profile_looks set is_pinned=false where salon_id=target_salon_id and is_pinned; end if;
 update public.salon_profile_looks set is_pinned=pinned where id=target_look_id;
 delete from public.salon_website_feature_selection where salon_id=target_salon_id;
end; $$;
revoke all on function public.set_owned_salon_featured_look(uuid,uuid,boolean) from public;
grant execute on function public.set_owned_salon_featured_look(uuid,uuid,boolean) to authenticated;

create or replace function public.get_public_salon_website_featured_look(target_salon_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare selected uuid; today date := (now() at time zone 'UTC')::date;
begin
 if not public.salon_profile_public_salon_exists(target_salon_id) then return null; end if;
 select id into selected from public.salon_profile_looks where salon_id=target_salon_id and status='published' and nullif(btrim(media_path),'') is not null and is_pinned order by published_at desc nulls last,id limit 1;
 if selected is not null then return selected; end if;
 perform pg_advisory_xact_lock(hashtextextended(target_salon_id::text,7));
 -- Recheck after acquiring the same lock used by manual selection.
 select id into selected from public.salon_profile_looks where salon_id=target_salon_id and status='published' and nullif(btrim(media_path),'') is not null and is_pinned order by published_at desc nulls last,id limit 1;
 if selected is not null then return selected; end if;
 select l.id into selected from public.salon_website_feature_selection s join public.salon_profile_looks l on l.id=s.look_id where s.salon_id=target_salon_id and s.selected_day=today and l.salon_id=target_salon_id and l.status='published' and nullif(btrim(l.media_path),'') is not null;
 if selected is not null then return selected; end if;
 select l.id into selected from public.salon_profile_looks l where l.salon_id=target_salon_id and l.status='published' and nullif(btrim(l.media_path),'') is not null
 order by ((select count(*) from (select user_id from public.salon_profile_look_saves where look_id=l.id union select user_id from public.account_post_saves where source_type='salon_profile_look' and source_id=l.id) saves)+(select count(*) from public.salon_profile_comments c where c.look_id=l.id and c.status in ('visible','published'))) desc,
 l.published_at asc nulls last,l.id asc limit 1;
 insert into public.salon_website_feature_selection(salon_id,look_id,selected_day) values(target_salon_id,selected,today) on conflict(salon_id) do update set look_id=excluded.look_id,selected_day=excluded.selected_day;
 return selected;
end; $$;
revoke all on function public.get_public_salon_website_featured_look(uuid) from public;
grant execute on function public.get_public_salon_website_featured_look(uuid) to anon,authenticated;
commit;
