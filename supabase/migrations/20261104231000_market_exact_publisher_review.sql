begin;
create table market_platform.review_contexts(
 version_id uuid primary key references market_platform.reviews(version_id),
 organization_id uuid not null references market_platform.organizations(id),
 publisher_name text not null,recorded_at timestamptz not null default now()
);
alter table market_platform.review_contexts enable row level security;
revoke all on market_platform.review_contexts from public,anon,authenticated,service_role;
create function market_platform.erase_review_identity() returns trigger language plpgsql security definer set search_path=pg_catalog,market_platform as $$
begin
 if new.owner_id is null or exists(select 1 from public.users where id=new.owner_id and status='deleted') then delete from review_contexts where organization_id=new.id;end if;return new;
end $$;
revoke all on function market_platform.erase_review_identity() from public,anon,authenticated,service_role;
create trigger market_erase_review_identity after update of owner_id,name on market_platform.organizations for each row execute function market_platform.erase_review_identity();

create function public.market_platform_review_exact(p_version uuid,p_sha256 text,p_publisher_name text,p_decision text,p_reason text) returns jsonb language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare actor uuid:=market_platform.actor();o organizations;result jsonb;
begin
 if not exists(select 1 from market_private.reviewers where user_id=actor and active) then raise exception using errcode='42501',message='Reviewer access required.';end if;
 select org.* into o from organizations org join apps a on a.organization_id=org.id join versions v on v.app_id=a.id where v.id=p_version for update of org;
 if o.id is null or p_publisher_name is null or p_publisher_name is distinct from o.name then raise exception using errcode='PT409',message='Publisher identity changed. Reload and inspect the current publisher before reviewing.';end if;
 if exists(select 1 from reviews where version_id=p_version) and not exists(select 1 from review_contexts where version_id=p_version) then raise exception using errcode='PT409',message='This historical review has no publisher identity snapshot. It cannot be reaffirmed as a new identity review.';end if;
 result:=review_base(p_version,p_sha256,p_decision,p_reason);
 insert into review_contexts(version_id,organization_id,publisher_name) values(p_version,o.id,o.name) on conflict(version_id) do nothing;
 return result||jsonb_build_object('publisher_name',o.name);
end $$;
revoke all on function public.market_platform_review_exact(uuid,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.market_platform_review_exact(uuid,text,text,text,text) to authenticated;

-- A stale reviewer client must not bypass the displayed-identity check.
create or replace function public.market_platform_review(p_version uuid,p_sha256 text,p_decision text,p_reason text) returns jsonb language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare actor uuid:=market_platform.actor();
begin
 if not exists(select 1 from market_private.reviewers where user_id=actor and active) then raise exception using errcode='42501',message='Reviewer access required.';end if;
 raise exception using errcode='42501',message='Reload the current review queue before recording a decision with its displayed publisher identity.';
end $$;
commit;
