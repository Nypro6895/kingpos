begin;
-- Preserve prior terms, versions and minute ledgers. New settings describe service
-- benefits in practical units; no conversion of minutes to sessions is inferred.
update public.reylumi_membership_plans set config=config||jsonb_build_object('service',jsonb_build_object('setup','by_agreement','method','by_agreement','training_sessions',null,'support','standard')),revision=revision+1 where not(config?'service');
create table public.reylumi_membership_website (
 id boolean primary key default true check(id),revision integer not null default 1,
 draft jsonb not null,published jsonb
);
insert into public.reylumi_membership_website(id,draft) values(true,jsonb_build_object(
 'title','Your tools. Your team. More possibilities.',
 'intro','Give your salon room to grow. One membership brings together Reylumi plugins, service allowances and the right level of technical help.',
 'cta','Ask about membership',
 'future','New plugins released by Reylumi are included while your membership is active. Usage allowances and service terms still apply.',
 'faq','Membership is assigned per salon. Third-party plugins, advertising spend and provider fees are separate.'));
alter table public.reylumi_membership_website enable row level security;
revoke all on public.reylumi_membership_website from public,anon,authenticated;

alter function public.reylumi_membership_validate(jsonb) rename to reylumi_membership_validate_v1;
create function public.reylumi_membership_validate(c jsonb) returns void language plpgsql set search_path=public as $$
declare service jsonb;
begin
 perform reylumi_membership_validate_v1(c);
 service:=c->'service';
 if service is not null then
  if jsonb_typeof(service)<>'object' or coalesce(service->>'setup','') not in ('included','not_included','by_agreement') or coalesce(service->>'method','') not in ('remote','onsite','by_agreement') or coalesce(service->>'support','') not in ('standard','priority','dedicated') then raise exception 'Invalid service benefits';end if;
  if not(service?'training_sessions') or (service->'training_sessions'<>'null'::jsonb and (jsonb_typeof(service->'training_sessions')<>'number' or (service->>'training_sessions')!~'^\d{1,3}$' or (service->>'training_sessions')::integer>100)) then raise exception 'Invalid training session count';end if;
 end if;
end $$;
revoke all on function public.reylumi_membership_validate(jsonb) from public,anon,authenticated;

create function public.reylumi_membership_website_public() returns jsonb language sql stable security definer set search_path=public as $$select published from reylumi_membership_website where id$$;
revoke all on function public.reylumi_membership_website_public() from public;
grant execute on function public.reylumi_membership_website_public() to anon,authenticated;

alter function public.reylumi_membership_workspace(text,text,integer) rename to reylumi_membership_workspace_v1;
revoke all on function public.reylumi_membership_workspace_v1(text,text,integer) from public,anon,authenticated;
create function public.reylumi_membership_workspace(p_query text default '',p_status text default 'all',p_page integer default 1,p_plan text default '') returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; rows jsonb; target uuid;
begin
 perform platform_admin_require_permission('admin.membership.read');
 if p_plan is null or p_plan not in ('','essential','growth','premium') then raise exception 'Invalid plan filter';end if;
 result:=reylumi_membership_workspace_v1(p_query,p_status,p_page);
 -- Select one representative term per salon: current access first, then scheduled,
 -- then latest historical term. All historical terms remain in detail/history.
 with latest as (select distinct on(x->>'salon_id') x from reylumi_membership_term_rows() x order by x->>'salon_id',case x->>'effective_status' when 'active' then 1 when 'scheduled' then 2 when 'expired' then 3 else 4 end,(x->>'starts_at')::timestamptz desc),
 filtered as(select x from latest where (coalesce(p_query,'')='' or x->>'salon_name' ilike '%'||p_query||'%' or x->>'salon_id'=p_query) and (p_plan='' or x->>'plan_key'=p_plan) and (p_status='all' or x->>'effective_status'=p_status or (p_status='expiring' and x->>'effective_status'='active' and (x->>'ends_at')::timestamptz<now()+interval '14 days'))),
 page as(select x from filtered order by lower(x->>'salon_name'),x->>'salon_id' offset (p_page-1)*25 limit 25)
 select jsonb_build_object('items',coalesce((select jsonb_agg(x) from page),'[]'::jsonb),'total',(select count(*) from filtered)) into rows;
 for target in select (value->>'id')::uuid from jsonb_array_elements(rows->'items') where value->>'effective_status'='active' loop perform reylumi_membership_sync(target);end loop;
 return result||jsonb_build_object('total',rows->'total','memberships',(select coalesce(jsonb_agg(x||jsonb_build_object(
  'renewal_starts_at',(select max(tt.ends_at) from reylumi_membership_terms tt where tt.salon_id=(x->>'salon_id')::uuid and tt.cancelled_at is null and tt.ends_at>now()),
  'sms_balance',case when x->>'effective_status'='active' then (select b.amount+coalesce((select sum(delta) from reylumi_membership_ledger where bucket_id=b.id),0) from reylumi_membership_buckets b where b.membership_id=(x->>'id')::uuid and resource='sms' and starts_at<=now() and ends_at>now()) end,
  'campaign_balance',case when x->>'effective_status'='active' then (select b.amount+coalesce((select sum(delta) from reylumi_membership_ledger where bucket_id=b.id),0) from reylumi_membership_buckets b where b.membership_id=(x->>'id')::uuid and resource='campaign' and starts_at<=now() and ends_at>now()) end
 )),'[]'::jsonb) from jsonb_array_elements(rows->'items')x),'website',(select jsonb_build_object('revision',revision,'draft',draft,'published',published) from reylumi_membership_website where id));
end $$;
revoke all on function public.reylumi_membership_workspace(text,text,integer,text) from public,anon;
grant execute on function public.reylumi_membership_workspace(text,text,integer,text) to authenticated;

alter function public.reylumi_membership_command(jsonb) rename to reylumi_membership_command_v1;
revoke all on function public.reylumi_membership_command_v1(jsonb) from public,anon,authenticated;
create function public.reylumi_membership_command(p jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid; req uuid; act text; why text; result jsonb; item jsonb; k text; w reylumi_membership_website; pl reylumi_membership_plans;
 ticket reylumi_membership_support; target uuid; next_state text; st timestamptz;
begin
 act:=p->>'action';
 if act not in ('save_settings','save_website','update_support') then
  if act='adjust_credit' and coalesce(p->>'resource','') not in ('sms','email','campaign','ai') then raise exception 'Invalid usage resource. Technical support is not measured in minutes.';end if;
  return reylumi_membership_command_v1(p);
 end if;
 select actor_user_id into actor from platform_admin_require_permission(case when act='update_support' then 'admin.membership.manage' else 'admin.membership.configure' end);
 req:=(p->>'request_id')::uuid;why:=btrim(coalesce(p->>'reason',''));
 if req is null or length(why) not between 3 and 1000 or length(p::text)>100000 then raise exception 'Invalid request or reason';end if;
 perform pg_advisory_xact_lock(hashtextextended(req::text,0));
 select details into result from reylumi_membership_events where request_id=req and actor_user_id=actor and action=act;
 if found then if result->'input' is distinct from p-'request_id' then raise exception 'This request ID was already used with different values';end if;return result-'input';end if;
 if act='save_settings' then
  if jsonb_typeof(p->'plans') is distinct from 'array' or jsonb_typeof(p->'publish') is distinct from 'boolean' then raise exception 'Invalid settings batch';end if;
  if jsonb_array_length(p->'plans')>3 or (jsonb_array_length(p->'plans')=0 and not(p?'website')) or (select count(distinct value->>'key') from jsonb_array_elements(p->'plans'))<>jsonb_array_length(p->'plans') then raise exception 'Invalid settings batch';end if;
  -- Fixed lock order, all-or-nothing publication across the three columns.
  perform 1 from reylumi_membership_plans where key in(select value->>'key' from jsonb_array_elements(p->'plans')) order by key for update;
  for item in select value from jsonb_array_elements(p->'plans') order by value->>'key' loop
   perform reylumi_membership_command_v1(jsonb_build_object('action',case when (p->>'publish')::boolean then 'publish_plan' else 'save_plan' end,'request_id',gen_random_uuid(),'reason',why,'key',item->>'key','revision',item->'revision','config',item->'config'));
   select * into pl from reylumi_membership_plans where key=item->>'key';
   if jsonb_typeof(item->'selling') is distinct from 'boolean' then raise exception 'Invalid enrollment state';end if;
   if (p->>'publish')::boolean and pl.selling is distinct from (item->>'selling')::boolean then
    perform reylumi_membership_command_v1(jsonb_build_object('action','set_selling','request_id',gen_random_uuid(),'reason',why,'key',pl.key,'revision',pl.revision,'selling',item->'selling'));
   end if;
  end loop;
  if p?'website' then
   perform reylumi_membership_command(jsonb_build_object('action','save_website','request_id',gen_random_uuid(),'reason',why,'revision',p->'website'->'revision','config',p->'website'->'config','publish',p->'publish'));
  end if;
  result:=jsonb_build_object('saved',jsonb_array_length(p->'plans'),'published',p->'publish');
 elsif act='save_website' then
  select * into w from reylumi_membership_website where id for update;
  if w.revision is distinct from (p->>'revision')::integer then raise exception 'This website changed. Reload before saving.';end if;
  if jsonb_typeof(p->'config') is distinct from 'object' or jsonb_typeof(p->'publish') is distinct from 'boolean' then raise exception 'Invalid website content';end if;
  foreach k in array array['title','intro','cta','future','faq'] loop
   if jsonb_typeof(p->'config'->k) is distinct from 'string' or length(p->'config'->>k)>4000 then raise exception 'Invalid website text';end if;
  end loop;
  if length(btrim(p->'config'->>'title')) not between 3 and 160 or length(btrim(p->'config'->>'cta')) not between 2 and 60 then raise exception 'Invalid website title or button';end if;
  update reylumi_membership_website set draft=p->'config',published=case when (p->>'publish')::boolean then p->'config' else published end,revision=revision+1 where id;
  result:=jsonb_build_object('website',true,'published',p->'publish');
 else
  -- Practical job tracking: complete setup/training by task, never debit minutes.
  select membership_id into target from reylumi_membership_support where id=(p->>'support_id')::uuid;
  perform 1 from reylumi_membership_terms where id=target for update;
  select * into ticket from reylumi_membership_support where id=(p->>'support_id')::uuid for update;
  if not found or ticket.state in ('completed','cancelled') or ticket.revision is distinct from (p->>'revision')::integer then raise exception 'This service request changed or is closed. Reload.';end if;
  next_state:=p->>'state';st:=nullif(p->>'scheduled_at','')::timestamptz;
  if next_state is null or next_state not in ('requested','assigned','scheduled','in_progress','completed','cancelled') or length(coalesce(p->>'assignee',''))>120 or length(coalesce(p->>'note',''))>2000 then raise exception 'Invalid service update';end if;
  if next_state in ('assigned','scheduled','in_progress','completed') and length(btrim(coalesce(p->>'assignee','')))<2 then raise exception 'Assigned technician is required';end if;
  if next_state='scheduled' and st is null then raise exception 'Appointment time is required';end if;
  update reylumi_membership_support set state=next_state,assignee=btrim(coalesce(p->>'assignee','')),scheduled_at=st,note=coalesce(p->>'note',''),revision=revision+1 where id=ticket.id;
  result:=jsonb_build_object('membership_id',target,'support_id',ticket.id,'state',next_state);
 end if;
 insert into reylumi_membership_events(membership_id,actor_user_id,action,reason,details,request_id) values(target,actor,act,why,result||jsonb_build_object('input',p-'request_id'),req);
 insert into platform_admin_audit_logs(actor_user_id,action,target_type,target_id,reason,after_data) values(actor,'membership.'||act,'system',target,why,result);
 return result;
end $$;
revoke all on function public.reylumi_membership_command(jsonb) from public,anon;
grant execute on function public.reylumi_membership_command(jsonb) to authenticated;
commit;
