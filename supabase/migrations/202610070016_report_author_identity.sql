-- Salon posts can record ownership in created_by_user_id instead of author_user_id.
-- Persist that author identity so content decisions and related-case filters agree.
create function public.post_safety_case_author_identity() returns trigger
language plpgsql security definer set search_path=public as $$
declare candidate uuid;
begin
 if new.author_user_id is null then
  candidate:=coalesce(nullif(new.content_snapshot->>'author_user_id',''),nullif(new.content_snapshot->>'created_by_user_id',''))::uuid;
  if exists(select 1 from users where id=candidate) then new.author_user_id:=candidate; end if;
 end if;
 return new;
end; $$;
revoke all on function public.post_safety_case_author_identity() from public,anon,authenticated;
create trigger post_safety_case_author_identity before insert or update of content_snapshot on public.post_safety_cases
for each row execute function public.post_safety_case_author_identity();
update public.post_safety_cases set content_snapshot=content_snapshot where author_user_id is null;
