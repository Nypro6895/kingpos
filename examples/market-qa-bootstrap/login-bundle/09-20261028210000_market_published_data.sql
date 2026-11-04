-- Explicit Owner-curated snapshots only. No automatic projection of private tables.
create table market_platform.published_groups(
 salon_id uuid not null references public.locations(id) on delete cascade,group_name text not null check(group_name in('profile','services','media','content')),
 revision integer not null default 1 check(revision>0),published boolean not null default false,data jsonb not null,
 updated_by uuid references public.users(id) on delete set null,updated_at timestamptz not null default now(),primary key(salon_id,group_name)
);
alter table market_platform.published_groups enable row level security;
revoke all on market_platform.published_groups from public,anon,authenticated,service_role;
create table market_platform.sandbox_group_usage(sandbox_id uuid references market_platform.sandboxes(id) on delete cascade,group_name text not null,request_count integer not null,last_request_at timestamptz not null,primary key(sandbox_id,group_name));
alter table market_platform.sandbox_group_usage enable row level security;
revoke all on market_platform.sandbox_group_usage from public,anon,authenticated,service_role;
create function market_platform.reset_group_usage() returns trigger language plpgsql security definer set search_path=pg_catalog,market_platform as $$begin if old.token_hash is distinct from new.token_hash then delete from sandbox_group_usage where sandbox_id=new.id;end if;return new;end $$;
create trigger market_reset_group_usage after update of token_hash on market_platform.sandboxes for each row execute function market_platform.reset_group_usage();
revoke all on function market_platform.reset_group_usage() from public,anon,authenticated,service_role;
alter function market_platform.validate_manifest(jsonb) rename to validate_identity_manifest;
create function market_platform.validate_manifest(p jsonb) returns jsonb language plpgsql immutable set search_path=pg_catalog,market_platform as $$
declare s jsonb;
begin
 perform market_platform.validate_identity_manifest(p||jsonb_build_object('scopes','[]'::jsonb));
 if jsonb_typeof(p->'scopes') is distinct from 'array' or jsonb_array_length(p->'scopes')>5 then raise exception using errcode='22023',message='Choose at most five supported read scopes.';end if;
 for s in select value from jsonb_array_elements(p->'scopes') loop
 if s not in('"salon:identity:read"','"salon:profile:read"','"salon:services:read"','"salon:media:read"','"salon:content:read"') then raise exception using errcode='22023',message='Unsupported API permission.';end if;end loop;
 if (select count(distinct value) from jsonb_array_elements(p->'scopes'))<>jsonb_array_length(p->'scopes') then raise exception using errcode='22023',message='Duplicate permission.';end if;
 return p;
end $$;
create function market_platform.publication_keys(p jsonb,keys text[]) returns void language plpgsql immutable set search_path=pg_catalog as $$
begin if p is null or jsonb_typeof(p)<>'object' or not p ?& keys or (select count(*) from jsonb_object_keys(p))<>cardinality(keys) then raise exception using errcode='22023',message='Unexpected or missing public fields.';end if;end $$;
create function market_platform.publication_text(p jsonb,lo integer,hi integer) returns void language plpgsql immutable set search_path=pg_catalog as $$
begin if p is null or jsonb_typeof(p)<>'string' or char_length(p#>>'{}') not between lo and hi or (lo>0 and char_length(btrim(p#>>'{}',E' \t\r\n'))<lo) or (p#>>'{}') ~ '[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]' then raise exception using errcode='22023',message='Invalid public text.';end if;end $$;
create function market_platform.shareable_asset(s uuid,a uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.salon_profile_media_assets m where m.id=a and m.salon_id=s and m.status='active' and m.deleted_at is null and m.quarantined_at is null and m.bucket='salon-profile-media' and m.purpose in('logo','cover','look','update') and m.mime_type='image/webp' and m.processed_bytes between 1 and 4194304 and m.object_path ~ ('^'||s::text||'/[A-Za-z0-9/_-]+\.webp$'))
$$;
create function market_platform.validate_publication(s uuid,g text,p jsonb) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,market_platform as $$
declare item jsonb;k text;
begin
 if p is null or octet_length(p::text)>131072 then raise exception using errcode='22023',message='Public group is too large (128 KiB maximum).';end if;
 if g='profile' then
 perform publication_keys(p,array['displayName','tagline','businessPhone','businessAddress','website','timezone','brandColor','hours']);
 perform publication_text(p->'displayName',2,100);perform publication_text(p->'tagline',0,300);perform publication_text(p->'businessPhone',0,40);perform publication_text(p->'businessAddress',0,300);perform publication_text(p->'website',0,2048);perform publication_text(p->'timezone',1,100);
 if not exists(select 1 from pg_timezone_names where name=p->>'timezone') or p->>'brandColor' !~ '^#[0-9a-fA-F]{6}$' or jsonb_typeof(p->'brandColor')<>'string' or p->>'businessPhone' !~ '^[+0-9 () .-]*$' or ((p->>'website')<>'' and p->>'website' !~ '^https://[a-z0-9][a-z0-9.-]*\.[a-z]{2,63}(/[A-Za-z0-9._~!$&()*+,;=:@%/-]*)?$') then raise exception using errcode='22023',message='Check business contact, HTTPS website, timezone and brand color.';end if;
 if jsonb_typeof(p->'hours') is distinct from 'array' or jsonb_array_length(p->'hours')>7 then raise exception using errcode='22023',message='Use at most seven opening-hour rows.';end if;
 for item in select value from jsonb_array_elements(p->'hours') loop
 perform publication_keys(item,array['day','closed','opens','closes']);
 if jsonb_typeof(item->'day')<>'number' or item->>'day' !~ '^[0-6]$' or jsonb_typeof(item->'closed')<>'boolean' then raise exception using errcode='22023',message='Invalid opening-hour day.';end if;
 if item->'closed'='true'::jsonb then
 if item->'opens'<>'null'::jsonb or item->'closes'<>'null'::jsonb then raise exception using errcode='22023',message='Closed days have no opening times.';end if;
 elsif jsonb_typeof(item->'opens')<>'string' or jsonb_typeof(item->'closes')<>'string' or item->>'opens' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or item->>'closes' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or item->>'opens'>=item->>'closes' then raise exception using errcode='22023',message='Use valid same-day opening hours.';end if;end loop;
 if (select count(distinct value->>'day') from jsonb_array_elements(p->'hours'))<>jsonb_array_length(p->'hours') then raise exception using errcode='22023',message='Duplicate opening day.';end if;
 elsif g='services' then
 perform publication_keys(p,array['services']);
 if jsonb_typeof(p->'services') is distinct from 'array' or jsonb_array_length(p->'services')>100 then raise exception using errcode='22023',message='Use at most 100 public services.';end if;
 for item in select value from jsonb_array_elements(p->'services') loop
 perform publication_keys(item,array['id','name','category','description','priceKind','amountCents','currency','durationMinutes']);
 foreach k in array array['id','name','category','description','priceKind','currency'] loop perform publication_text(item->k,case when k in('name','id') then 1 else 0 end,case when k='description' then 1000 else 100 end);end loop;
 if item->>'id' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' or item->>'priceKind' not in('fixed','from','on-request') or item->>'currency' !~ '^[A-Z]{3}$' then raise exception using errcode='22023',message='Invalid public service identity or pricing type.';end if;
 if item->>'priceKind'='on-request' then
 if item->'amountCents'<>'null'::jsonb then raise exception using errcode='22023',message='Price on request has no numeric price.';end if;
 elsif jsonb_typeof(item->'amountCents')<>'number' or item->>'amountCents' !~ '^(0|[1-9][0-9]{0,7})$' then raise exception using errcode='22023',message='Use integer minor units for public list prices.';end if;
 if item->'durationMinutes'<>'null'::jsonb and (jsonb_typeof(item->'durationMinutes')<>'number' or item->>'durationMinutes' !~ '^[1-9][0-9]{0,3}$' or (item->>'durationMinutes')::integer>1440) then raise exception using errcode='22023',message='Duration must be unknown or 1–1440 minutes.';end if;end loop;
 if (select count(distinct value->>'id') from jsonb_array_elements(p->'services'))<>jsonb_array_length(p->'services') then raise exception using errcode='22023',message='Duplicate public service.';end if;
 elsif g='media' then
 perform publication_keys(p,array['images']);
 if jsonb_typeof(p->'images') is distinct from 'array' or jsonb_array_length(p->'images')>20 then raise exception using errcode='22023',message='Select at most 20 salon photos.';end if;
 for item in select value from jsonb_array_elements(p->'images') loop
 perform publication_keys(item,array['assetId','label','caption','rights','role']);perform publication_text(item->'assetId',36,36);perform publication_text(item->'label',1,100);perform publication_text(item->'caption',0,500);
 if item->>'assetId' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' or item->>'rights' not in('owner','licensed') or item->>'role' not in('logo','gallery') or jsonb_typeof(item->'rights')<>'string' or jsonb_typeof(item->'role')<>'string' or not shareable_asset(s,(item->>'assetId')::uuid) then raise exception using errcode='22023',message='Select an active salon-owned photo and confirm usage rights.';end if;end loop;
 if (select count(distinct value->>'assetId') from jsonb_array_elements(p->'images'))<>jsonb_array_length(p->'images') then raise exception using errcode='22023',message='Duplicate selected photo.';end if;
 elsif g='content' then
 perform publication_keys(p,array['entries']);
 if jsonb_typeof(p->'entries') is distinct from 'array' or jsonb_array_length(p->'entries')>30 then raise exception using errcode='22023',message='Use at most 30 public content entries.';end if;
 for item in select value from jsonb_array_elements(p->'entries') loop
 perform publication_keys(item,array['id','kind','title','body']);perform publication_text(item->'id',36,36);perform publication_text(item->'title',1,150);perform publication_text(item->'body',1,2000);
 if item->>'id' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' or jsonb_typeof(item->'kind')<>'string' or item->>'kind' not in('faq','policy','guide') then raise exception using errcode='22023',message='Invalid public content entry.';end if;end loop;
 if (select count(distinct value->>'id') from jsonb_array_elements(p->'entries'))<>jsonb_array_length(p->'entries') then raise exception using errcode='22023',message='Duplicate public content entry.';end if;
 else raise exception using errcode='22023',message='Unsupported public group.';end if;
 return p;
end $$;
create function public.market_platform_publication_workspace(p_salon uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare actor uuid:=market_platform.actor();
begin
 if not coalesce(public.lifecycle_user_is_salon_owner(p_salon,actor,false),false) then raise exception using errcode='42501',message='Active salon Owner required.';end if;
 return jsonb_build_object('salonId',p_salon,'groups',coalesce((select jsonb_agg(jsonb_build_object('group',group_name,'revision',revision,'published',published,'data',data,'updatedAt',updated_at)) from published_groups where salon_id=p_salon),'[]'::jsonb),'assets',coalesce((select jsonb_agg(jsonb_build_object('id',id,'purpose',purpose,'path',object_path)) from public.salon_profile_media_assets m where salon_id=p_salon and shareable_asset(p_salon,m.id)),'[]'::jsonb));
end $$;
create function public.market_platform_publish_group(p_salon uuid,p_group text,p_expected integer,p_data jsonb,p_publish boolean) returns integer language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare actor uuid:=market_platform.actor();r integer;
begin
 if p_publish is null or p_expected is null or p_expected<0 or not coalesce(public.lifecycle_user_is_salon_owner(p_salon,actor,false),false) then raise exception using errcode='42501',message='Active salon Owner and current revision required.';end if;
 perform 1 from public.locations where id=p_salon and status='active' for update;if not found then raise exception using errcode='42501',message='Active salon required.';end if;
 select revision into r from published_groups where salon_id=p_salon and group_name=p_group for update;
 if coalesce(r,0)<>p_expected then raise exception using errcode='PT409',message='Public data changed. Reload before saving.';end if;
 if p_data is null and not p_publish and r is not null then update published_groups set published=false,revision=revision+1,updated_by=actor,updated_at=now() where salon_id=p_salon and group_name=p_group returning revision into r;
 else
 perform validate_publication(p_salon,p_group,p_data);
 insert into published_groups(salon_id,group_name,revision,published,data,updated_by) values(p_salon,p_group,coalesce(r,0)+1,p_publish,p_data,actor) on conflict(salon_id,group_name) do update set revision=excluded.revision,published=excluded.published,data=excluded.data,updated_by=actor,updated_at=now() returning revision into r;
 end if;
 insert into events(actor_id,kind,object_id,reason) values(actor,'public_group_changed',p_salon,p_group||': revision '||r::text);
 return r;
end $$;
-- Authenticate actual raw token, never a caller-supplied salon or stored hash.
create function market_platform.publication_authority(p_token text,p_group text) returns jsonb language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare i installations;s sandboxes;scope text:='salon:'||p_group||':read';digest text;
begin
 if p_group not in('profile','services','media','content') or p_token is null or p_token !~ '^rmp_[A-Za-z0-9_-]{43}$' then raise exception using errcode='42501',message='Invalid published-data grant.';end if;
 perform 1 from settings where id and enabled for share;if not found then raise exception using errcode='42501',message='Runtime unavailable.';end if;
 digest:=encode(sha256(convert_to(p_token,'UTF8')),'hex');
 select sb.* into s from sandboxes sb join public.users u on u.id=sb.actor_id and u.status='active' join versions v on v.id=sb.version_id and v.erased_at is null join apps a on a.id=v.app_id and a.active join organizations o on o.id=a.organization_id join public.users pub on pub.id=o.owner_id and pub.status='active' where sb.token_hash=digest and sb.expires_at>now() and sb.request_count<1000 and v.manifest->'scopes' ? scope and (o.owner_id=sb.actor_id or exists(select 1 from market_private.reviewers r where r.user_id=sb.actor_id and r.active)) for update of sb;
 if s.id is not null then update sandboxes set request_count=request_count+1,last_request_at=now() where id=s.id;insert into sandbox_group_usage(sandbox_id,group_name,request_count,last_request_at) values(s.id,p_group,1,now()) on conflict(sandbox_id,group_name) do update set request_count=sandbox_group_usage.request_count+1,last_request_at=now();return jsonb_build_object('salonId',s.id,'installationId',s.id,'versionId',s.version_id,'synthetic',true);end if;
 select ins.* into i from tokens t join installations ins on ins.id=t.installation_id and ins.generation=t.generation join versions v on v.id=ins.version_id where t.token_hash=digest and t.expires_at>now() and ins.scopes ? scope and v.manifest->'scopes' ? scope and connection_allowed(ins.id) for share of ins;
 if i.id is null then raise exception using errcode='42501',message='Token expired, revoked or lacks this group permission.';end if;
 return jsonb_build_object('salonId',i.salon_id,'installationId',i.id,'versionId',i.version_id,'synthetic',false);
end $$;
create function public.market_platform_published_group(p_token text,p_group text) returns jsonb language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare a jsonb:=publication_authority(p_token,p_group);r published_groups;d jsonb;
begin
 if (a->>'synthetic')::boolean then
 d:=case p_group when 'profile' then '{"displayName":"Synthetic Test Salon","tagline":"Synthetic menu data","businessPhone":"","businessAddress":"","website":"","timezone":"America/Chicago","brandColor":"#145946","hours":[]}'::jsonb when 'services' then '{"services":[{"id":"00000000-0000-4000-8000-000000000001","name":"Synthetic manicure","category":"Nails","description":"Synthetic service only","priceKind":"from","amountCents":2500,"currency":"USD","durationMinutes":30}]}'::jsonb when 'media' then '{"images":[]}'::jsonb else '{"entries":[{"id":"00000000-0000-4000-8000-000000000002","kind":"faq","title":"Is this a real salon?","body":"No. Synthetic test data only."}]}'::jsonb end;
 return a||jsonb_build_object('schemaVersion',1,'group',p_group,'revision',1,'publishedAt',null,'data',d);end if;
 select * into r from published_groups where salon_id=(a->>'salonId')::uuid and group_name=p_group and published;
 if r.salon_id is null then raise exception using errcode='PT404',message='This data group is not published.';end if;
 d:=r.data;
 if p_group='media' then d:=jsonb_build_object('images',coalesce((select jsonb_agg(value) from jsonb_array_elements(d->'images') where shareable_asset(r.salon_id,(value->>'assetId')::uuid)),'[]'::jsonb));end if;
 return a||jsonb_build_object('schemaVersion',1,'group',p_group,'revision',r.revision,'publishedAt',r.updated_at,'data',d);
end $$;
create function public.market_platform_published_media_source(p_token text,p_asset uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare a jsonb:=publication_authority(p_token,'media');m public.salon_profile_media_assets;
begin
 if (a->>'synthetic')::boolean then raise exception using errcode='PT404',message='No synthetic image is selected.';end if;
 if not exists(select 1 from published_groups g,jsonb_array_elements(g.data->'images') x where g.salon_id=(a->>'salonId')::uuid and g.group_name='media' and g.published and x->>'assetId'=p_asset::text) or not shareable_asset((a->>'salonId')::uuid,p_asset) then raise exception using errcode='PT404',message='Selected photo is unavailable.';end if;
 select * into m from public.salon_profile_media_assets where id=p_asset;
 return jsonb_build_object('salonId',m.salon_id,'assetId',m.id,'path',m.object_path,'bucket',m.bucket);
end $$;
-- All internal validators/authority helpers remain private.
do $$declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='market_platform' and p.proname in('publication_keys','publication_text','shareable_asset','validate_publication','publication_authority','validate_manifest','validate_identity_manifest') loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);end loop;
end $$;
revoke all on function public.market_platform_publication_workspace(uuid),public.market_platform_publish_group(uuid,text,integer,jsonb,boolean),public.market_platform_published_group(text,text),public.market_platform_published_media_source(text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.market_platform_publication_workspace(uuid),public.market_platform_publish_group(uuid,text,integer,jsonb,boolean) to authenticated;
grant execute on function public.market_platform_published_group(text,text) to anon,authenticated;
-- Only Reylumi's image gateway may see storage paths, never app API roles.
grant execute on function public.market_platform_published_media_source(text,uuid) to service_role;
create or replace function public.market_platform_developer_tools() returns jsonb language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare actor uuid:=market_platform.actor(); org uuid;
begin
 select id into org from organizations where owner_id=actor;
 if org is null then raise exception using errcode='42501',message='Developer organization owner required.';end if;
 return jsonb_build_object('profile',(select to_jsonb(p)-'organization_id' from publisher_profiles p where p.organization_id=org),
 'sandboxGroups',coalesce((select jsonb_agg(jsonb_build_object('versionId',s.version_id,'group',u.group_name,'calls',u.request_count,'lastRequestAt',u.last_request_at)) from sandbox_group_usage u join sandboxes s on s.id=u.sandbox_id where s.actor_id=actor),'[]'::jsonb),'readiness',coalesce((select jsonb_agg(jsonb_build_object('versionId',v.id,'checks',jsonb_build_array(
 jsonb_build_object('name','Validated immutable manifest','passed',v.erased_at is null),
 jsonb_build_object('name','Publisher support profile saved','passed',exists(select 1 from publisher_profiles where organization_id=org)),
 jsonb_build_object('name','Confidential client configured','passed',exists(select 1 from app_credentials where app_id=a.id)),
 jsonb_build_object('name','Synthetic API request observed','passed',exists(select 1 from sandboxes s where s.version_id=v.id and s.actor_id=actor and s.request_count>0)),
 jsonb_build_object('name','Exact version approved independently','passed',exists(select 1 from reviews r where r.version_id=v.id and r.decision='approved')),
 jsonb_build_object('name','Current version authorization code exchanged','passed',exists(select 1 from authorization_codes c join installations i on i.id=c.installation_id where i.version_id=v.id and c.consumed_at is not null and c.installation_generation=i.generation))
 ))) from versions v join apps a on a.id=v.app_id where a.organization_id=org and v.erased_at is null),'[]'::jsonb));
end $$;
