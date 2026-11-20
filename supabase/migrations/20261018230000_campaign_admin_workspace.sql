begin;
alter table public.owner_campaigns add column archived_at timestamptz;
create index owner_campaign_admin_list on public.owner_campaigns(status,created_at desc,id) where archived_at is null;
create view public.admin_campaign_list as select c.*,l.name as salon_name from public.owner_campaigns c left join public.locations l on l.id=c.salon_id;
revoke all on public.admin_campaign_list from public,anon,authenticated;
grant select on public.admin_campaign_list to service_role;
create function public.admin_manage_campaign(p_id uuid,p_expected timestamptz,p_action text,p_title text default null,p_caption text default null,p_reason text default null) returns void language plpgsql security definer set search_path=public as $$
declare actor record;c owner_campaigns;creative_id uuid;begin
 select * into actor from platform_admin_require_permission('admin.advertising.review');
 -- Match the wallet-first order used by funding, review, release and renewal.
 perform 1 from campaign_wallets where salon_id=(select salon_id from owner_campaigns where id=p_id) for update;
 select * into c from owner_campaigns where id=p_id for update;
 if c.id is null or c.archived_at is not null then raise exception 'Ad is unavailable.';end if;
 if p_expected is null or c.updated_at is distinct from p_expected then raise exception 'This ad changed. Refresh before trying again.';end if;
 if p_action in ('approve','reject') then
  perform admin_review_campaign(p_id,p_action='approve',case when p_action='approve' then coalesce(nullif(btrim(p_reason),''),'Approved after ad review') else p_reason end);
  return;
 elsif p_action='resume' then
  perform owner_campaign_change(c.id,c.salon_id,c.owner_id,'resume');
 elsif p_action='pause' then
  if c.status<>'running' then raise exception 'Only running ads can be paused.';end if;
  update owner_campaigns set status='paused',keep_running=false,updated_at=now() where id=p_id;
 elsif p_action='edit' then
  if c.status not in ('pending_review','awaiting_payment') then raise exception 'Only ads not yet approved can be edited.';end if;
  if length(btrim(coalesce(p_title,''))) not between 1 and 120 then raise exception 'Add a title (1Ã¢â‚¬â€œ120 characters).';end if;
  if p_caption is not null and (c.source_type<>'custom' or length(btrim(p_caption)) not between 1 and 2200) then raise exception 'Edit the source post from its business workspace.';end if;
  update owner_campaigns set title=btrim(p_title),updated_at=now() where id=p_id;
  if c.source_type='custom' then
   creative_id:=gen_random_uuid();
   insert into owner_campaign_creatives(id,salon_id,author_user_id,title,caption,media_path)
   select creative_id,salon_id,author_user_id,btrim(p_title),coalesce(btrim(p_caption),caption),media_path from owner_campaign_creatives where id=c.source_id and salon_id=c.salon_id;
   if not found then raise exception 'Ad content is unavailable.';end if;
   update owner_campaigns set source_id=creative_id where id=p_id;
  end if;
 elsif p_action='archive' then
  update owner_campaigns set status=case when status in ('completed','cancelled','rejected') then status else 'cancelled' end,keep_running=false,archived_at=now(),updated_at=now() where id=p_id;
 else raise exception 'Choose a valid ad action.';end if;
 insert into platform_admin_audit_logs(actor_user_id,action,target_type,target_id,reason,metadata)
 values(actor.actor_user_id,'campaign.'||p_action,'system',p_id,coalesce(nullif(btrim(p_reason),''),'Admin campaign action'),jsonb_build_object('campaign_id',p_id,'previous_status',c.status));
end $$;
revoke all on function public.admin_manage_campaign(uuid,timestamptz,text,text,text,text) from public,anon,authenticated;
grant execute on function public.admin_manage_campaign(uuid,timestamptz,text,text,text,text) to authenticated;
commit;
