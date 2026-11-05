begin;
-- Keep the existing public snapshot stable while an Owner prepares a draft.
-- edit_revision is the workspace CAS; revision remains the public-data revision.
alter table market_platform.published_groups
 add column edit_revision integer,
 add column draft_data jsonb,
 add column draft_updated_at timestamptz;
update market_platform.published_groups set edit_revision=revision;
alter table market_platform.published_groups alter column edit_revision set not null;
alter table market_platform.published_groups alter column edit_revision set default 1;
alter table market_platform.published_groups add constraint market_public_edit_revision check(edit_revision>0);
alter table market_platform.published_groups alter column data drop not null;
alter table market_platform.published_groups drop constraint published_groups_revision_check;
alter table market_platform.published_groups add constraint published_groups_revision_check check(revision>=0 and (not published or (revision>0 and data is not null)));

create function public.market_platform_save_publication(p_salon uuid,p_group text,p_expected integer,p_data jsonb,p_intent text)
returns integer language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare actor uuid:=market_platform.actor(); current_row published_groups; next_edit integer;
begin
 if p_intent is null or p_intent not in('draft','publish','unpublish','discard') or p_group is null or p_group not in('profile','services','media','content')
 or p_expected is null or p_expected<0 or not coalesce(public.lifecycle_user_is_salon_owner(p_salon,actor,false),false)
 then raise exception using errcode='42501',message='Active salon Owner and valid publication operation required.';end if;
 perform 1 from public.locations where id=p_salon and status='active' for update;
 if not found then raise exception using errcode='42501',message='Active salon required.';end if;
 select * into current_row from published_groups where salon_id=p_salon and group_name=p_group for update;
 if coalesce(current_row.edit_revision,0)<>p_expected then raise exception using errcode='PT409',message='Public data changed. Reload before saving.';end if;
 next_edit:=p_expected+1;
 if p_intent='discard' then
  if current_row.salon_id is null or p_data is not null or current_row.draft_data is null then raise exception using errcode='22023',message='Choose an existing saved draft to discard.';end if;
  update published_groups set draft_data=null,draft_updated_at=null,edit_revision=next_edit,updated_by=actor where salon_id=p_salon and group_name=p_group;
 elsif p_intent='unpublish' then
  if current_row.salon_id is null or p_data is not null then raise exception using errcode='22023',message='Choose an existing group to stop sharing.';end if;
  update published_groups set published=false,revision=revision+1,edit_revision=next_edit,updated_by=actor,updated_at=now()
   where salon_id=p_salon and group_name=p_group;
 else
  perform validate_publication(p_salon,p_group,p_data);
  if current_row.salon_id is null then
   insert into published_groups(salon_id,group_name,revision,edit_revision,published,data,draft_data,draft_updated_at,updated_by)
    values(p_salon,p_group,case when p_intent='draft' then 0 else 1 end,next_edit,p_intent='publish',case when p_intent='publish' then p_data end,case when p_intent='draft' then p_data end,case when p_intent='draft' then now() end,actor);
  elsif p_intent='draft' then
   update published_groups set draft_data=p_data,draft_updated_at=now(),edit_revision=next_edit,updated_by=actor
    where salon_id=p_salon and group_name=p_group;
  else
   update published_groups set data=p_data,published=true,revision=revision+1,edit_revision=next_edit,draft_data=null,draft_updated_at=null,updated_by=actor,updated_at=now()
    where salon_id=p_salon and group_name=p_group;
  end if;
 end if;
 insert into events(actor_id,kind,object_id,reason) values(actor,'public_group_'||p_intent,p_salon,p_group||': edit '||next_edit::text);
 return next_edit;
end $$;
revoke all on function public.market_platform_save_publication(uuid,text,integer,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.market_platform_save_publication(uuid,text,integer,jsonb,text) to authenticated;

-- Preserve the explicit stop-sharing contract of older clients, while sharing
-- the same lock/CAS as the new editor. The new editor never calls this adapter.
create or replace function public.market_platform_publish_group(p_salon uuid,p_group text,p_expected integer,p_data jsonb,p_publish boolean)
returns integer language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare r integer;
begin
 if p_publish is null then raise exception using errcode='22023',message='Choose publication state.';end if;
 if p_publish then return public.market_platform_save_publication(p_salon,p_group,p_expected,p_data,'publish');end if;
 if p_data is null then return public.market_platform_save_publication(p_salon,p_group,p_expected,null,'unpublish');end if;
 r:=public.market_platform_save_publication(p_salon,p_group,p_expected,p_data,'draft');
 return public.market_platform_save_publication(p_salon,p_group,r,null,'unpublish');
end $$;

create or replace function public.market_platform_publication_workspace(p_salon uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare actor uuid:=market_platform.actor();
begin
 if not coalesce(public.lifecycle_user_is_salon_owner(p_salon,actor,false),false) then raise exception using errcode='42501',message='Active salon Owner required.';end if;
 return jsonb_build_object('salonId',p_salon,'groups',coalesce((select jsonb_agg(jsonb_build_object(
  'group',group_name,'revision',edit_revision,'publishedRevision',revision,'published',published,
  'hasDraft',draft_data is not null,'data',coalesce(draft_data,data),'publishedData',case when published then data end,
  'draftUpdatedAt',draft_updated_at,'updatedAt',updated_at)) from published_groups where salon_id=p_salon),'[]'::jsonb),
  'assets',coalesce((select jsonb_agg(jsonb_build_object('id',id,'purpose',purpose,'path',object_path)) from public.salon_profile_media_assets m where salon_id=p_salon and shareable_asset(p_salon,m.id)),'[]'::jsonb));
end $$;

-- Durable history is intentionally separate from current credential readiness.
-- Events contain version IDs, never raw codes, secrets, tokens or private data.
create unique index market_version_observation on market_platform.events(kind,object_id,actor_id)
 where kind in('version_code_exchange_observed','version_sandbox_api_observed','synthetic_code_exchange_observed');
create function market_platform.record_version_observation() returns trigger language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare version_id uuid; observer uuid; observation text;
begin
 if TG_TABLE_NAME='authorization_codes' then
  if new.consumed_at is null then return new;end if;
  select i.version_id,i.consented_by into version_id,observer from installations i where i.id=new.installation_id;
  observation:='version_code_exchange_observed';
 else
  if new.request_count<1 then return new;end if;
  version_id:=new.version_id;observer:=new.actor_id;observation:='version_sandbox_api_observed';
 end if;
 if version_id is not null then
  insert into events(actor_id,kind,object_id,reason) values(observer,observation,version_id,'Recorded version observation; not runtime certification') on conflict do nothing;
 end if;
 return new;
end $$;
revoke all on function market_platform.record_version_observation() from public,anon,authenticated,service_role;
create trigger market_record_code_exchange after update of consumed_at on market_platform.authorization_codes
 for each row execute function market_platform.record_version_observation();
create trigger market_record_sandbox_success after update of request_count on market_platform.sandboxes
 for each row execute function market_platform.record_version_observation();
-- Backfill only observations that still have actual evidence; deleted history
-- cannot be reconstructed and is never inferred from a present installation.
insert into market_platform.events(actor_id,kind,object_id,reason)
 select distinct i.consented_by,'version_code_exchange_observed',i.version_id,'Migrated extant consumed-code observation'
 from market_platform.authorization_codes c join market_platform.installations i on i.id=c.installation_id
 where c.consumed_at is not null and c.installation_generation=i.generation;
insert into market_platform.events(actor_id,kind,object_id,reason)
 select distinct s.actor_id,'version_sandbox_api_observed',s.version_id,'Migrated extant successful sandbox observation'
 from market_platform.sandboxes s where s.request_count>0;

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
 jsonb_build_object('name','Synthetic API request observed','passed',exists(select 1 from events e where e.kind='version_sandbox_api_observed' and e.object_id=v.id and e.actor_id=actor)),
 jsonb_build_object('name','Exact version approved independently','passed',a.active and exists(select 1 from reviews r where r.version_id=v.id and r.decision='approved')),
 jsonb_build_object('name','Authorization code exchange recorded (history)','passed',exists(select 1 from events e where e.kind='version_code_exchange_observed' and e.object_id=v.id)),
 jsonb_build_object('name','Active Owner access grant available now','passed',exists(select 1 from installations i join refresh_grants t on t.installation_id=i.id and t.generation=i.generation and t.expires_at>now() where i.version_id=v.id and connection_allowed(i.id)))
 ))) from versions v join apps a on a.id=v.app_id where a.organization_id=org and v.erased_at is null),'[]'::jsonb));
end $$;

commit;
