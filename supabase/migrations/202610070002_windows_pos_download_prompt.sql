begin;
create table public.windows_pos_download_preferences (
 user_id uuid primary key references public.users(id) on delete cascade,
 downloaded_at timestamptz,
 never_remind boolean not null default false,
 remind_after_download boolean not null default false,
 pending boolean not null default false,
 last_shown_session text,
 updated_at timestamptz not null default now()
);
alter table public.windows_pos_download_preferences enable row level security;
revoke all on public.windows_pos_download_preferences from public, anon;
grant select, insert, update on public.windows_pos_download_preferences to authenticated;
create policy windows_pos_download_self on public.windows_pos_download_preferences
 for all to authenticated using(user_id=public.current_public_user_id())
 with check(user_id=public.current_public_user_id());

-- Owner access is granted by both salon creation and approved claims, including support review.
create function public.queue_windows_pos_download_prompt() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.status='active' and exists(select 1 from roles where id=new.role_id and code='OWNER') then
  insert into windows_pos_download_preferences(user_id,pending) values(new.user_id,true)
  on conflict(user_id) do update set pending=true, updated_at=now();
 end if;
 return new;
end;$$;
revoke all on function public.queue_windows_pos_download_prompt() from public,anon,authenticated;
create trigger queue_windows_pos_download after insert or update of status,role_id on public.salon_memberships
 for each row execute function public.queue_windows_pos_download_prompt();
-- Serialize checks so two tabs in the same login cannot both claim the reminder.
create function public.claim_windows_pos_download_prompt(p_session text,p_pos boolean) returns boolean
language plpgsql security definer set search_path=public as $$
declare actor uuid:=current_public_user_id(); preference windows_pos_download_preferences;
begin
 if actor is null or p_session is null or length(p_session)<>64 then return false; end if;
 if not exists(select 1 from salon_memberships m join roles r on r.id=m.role_id
  where m.user_id=actor and m.status='active' and r.code='OWNER') then return false; end if;
 insert into windows_pos_download_preferences(user_id) values(actor) on conflict do nothing;
 select * into preference from windows_pos_download_preferences where user_id=actor for update;
 if preference.never_remind or (preference.downloaded_at is not null and not preference.remind_after_download)
  or not (preference.pending or coalesce(p_pos,false)) or preference.last_shown_session=p_session then return false; end if;
 update windows_pos_download_preferences set pending=false,last_shown_session=p_session,updated_at=now() where user_id=actor;
 return true;
end;$$;
revoke all on function public.claim_windows_pos_download_prompt(text,boolean) from public,anon;
grant execute on function public.claim_windows_pos_download_prompt(text,boolean) to authenticated;
commit;
