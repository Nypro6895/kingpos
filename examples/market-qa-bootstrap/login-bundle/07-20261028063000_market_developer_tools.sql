create table market_platform.publisher_profiles(
 organization_id uuid primary key references market_platform.organizations(id),
 email text not null,website text not null,description text not null default '',updated_at timestamptz not null default now()
);
alter table market_platform.publisher_profiles enable row level security;
revoke all on market_platform.publisher_profiles from public,anon,authenticated,service_role;
create function public.market_platform_profile_save(p_name text,p_email text,p_website text,p_description text) returns boolean language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare actor uuid:=market_platform.actor(); org uuid;
begin
 select id into org from organizations where owner_id=actor for update;
 if org is null then raise exception using errcode='42501',message='Developer organization owner required.';end if;
 if p_name is null or char_length(btrim(p_name)) not between 2 and 100 or p_name ~ '[\x00-\x1f\x7f]'
 or p_email is null or char_length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
 or p_website is null or (char_length(p_website)>2048 or p_website !~ '^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,63}(/[A-Za-z0-9._~!$&()*+,;=:@%/-]*)?$' or p_website ~ '^https://[^/]*\.(localhost|local|internal|test|invalid|example)(/|$)')
 or p_description is null or char_length(p_description)>2000 or p_description ~ '[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]'
 then raise exception using errcode='22023',message='Enter a valid publisher name, support email, public HTTPS website and description (up to 2,000 characters).';end if;
 update organizations set name=btrim(p_name) where id=org;
 insert into publisher_profiles(organization_id,email,website,description) values(org,btrim(p_email),p_website,p_description)
 on conflict(organization_id) do update set email=excluded.email,website=excluded.website,description=excluded.description,updated_at=now();
 return true;
end $$;
create function public.market_platform_developer_tools() returns jsonb language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare actor uuid:=market_platform.actor(); org uuid;
begin
 select id into org from organizations where owner_id=actor;
 if org is null then raise exception using errcode='42501',message='Developer organization owner required.';end if;
 return jsonb_build_object('profile',(select to_jsonb(p)-'organization_id' from publisher_profiles p where p.organization_id=org),
 'readiness',coalesce((select jsonb_agg(jsonb_build_object('versionId',v.id,'checks',jsonb_build_array(
 jsonb_build_object('name','Validated immutable manifest','passed',v.erased_at is null),
 jsonb_build_object('name','Publisher support profile saved','passed',exists(select 1 from publisher_profiles where organization_id=org)),
 jsonb_build_object('name','Confidential client configured','passed',exists(select 1 from app_credentials where app_id=a.id)),
 jsonb_build_object('name','Synthetic identity API request observed','passed',exists(select 1 from sandboxes s where s.version_id=v.id and s.actor_id=actor and s.request_count>0)),
 jsonb_build_object('name','Exact version approved independently','passed',exists(select 1 from reviews r where r.version_id=v.id and r.decision='approved')),
 jsonb_build_object('name','Current version authorization code exchanged','passed',exists(select 1 from authorization_codes c join installations i on i.id=c.installation_id where i.version_id=v.id and c.consumed_at is not null and c.installation_generation=i.generation))
 ))) from versions v join apps a on a.id=v.app_id where a.organization_id=org and v.erased_at is null),'[]'::jsonb));
end $$;
-- Publisher contact details are erased along with the existing developer identity.
create function market_platform.erase_publisher_profile() returns trigger language plpgsql security definer set search_path=pg_catalog,market_platform as $$
begin
 if new.owner_id is null or exists(select 1 from public.users where id=new.owner_id and status='deleted') then delete from publisher_profiles where organization_id=new.id;end if;return new;
end $$;
create trigger market_profile_erasure after update of owner_id,name on market_platform.organizations for each row execute function market_platform.erase_publisher_profile();
revoke all on function market_platform.erase_publisher_profile() from public,anon,authenticated,service_role;
revoke all on function public.market_platform_profile_save(text,text,text,text),public.market_platform_developer_tools() from public,anon,authenticated,service_role;
grant execute on function public.market_platform_profile_save(text,text,text,text),public.market_platform_developer_tools() to authenticated;
