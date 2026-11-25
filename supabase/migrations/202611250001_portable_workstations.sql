-- Enrollment is independent of a daily staff login. Only the application server
-- may operate these records; neither Owner auth nor an anonymous RPC is a grant.
begin;
create table public.portable_workstations (
 id uuid primary key default gen_random_uuid(),
 salon_id uuid not null references public.locations(id),
 key_id uuid not null references public.pos_portable_access_keys(id),
 draft_id uuid not null unique references public.pos_live_drafts(id),
 label text not null check (length(label) between 1 and 64),
 generation integer not null default 1,
 event_sequence bigint not null default 0,
 topic text not null default ('portable-workstation:'||replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','')),
 writer_hash text not null check (writer_hash ~ '^[a-f0-9]{64}$'),
 writer_device uuid not null,
 lease_until timestamptz,
 heartbeat_at timestamptz,
 dirty boolean not null default true,
 pending boolean not null default true,
 cart_id text,
 revision text,
 customer_hash text check (customer_hash is null or customer_hash ~ '^[a-f0-9]{64}$'),
 code_hash text unique,
 code_expires_at timestamptz,
 latest_envelope jsonb,
 customer_selection jsonb,
 created_at timestamptz not null default clock_timestamp()
);
create table public.portable_workstation_pair_limits (
 identifier_hash text primary key,
 attempts integer not null,
 window_started_at timestamptz not null
);
create table public.portable_workstation_intents (
 id uuid primary key,
 workstation_id uuid not null references public.portable_workstations(id),
 generation integer not null,
 cart_id text not null,
 revision text not null,
 payload jsonb not null,
 acknowledged boolean not null default false,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.portable_workstations enable row level security;
alter table public.portable_workstation_pair_limits enable row level security;
alter table public.portable_workstation_intents enable row level security;
revoke all on public.portable_workstations,public.portable_workstation_pair_limits,public.portable_workstation_intents from public,anon,authenticated;
grant all on public.portable_workstations,public.portable_workstation_pair_limits,public.portable_workstation_intents to service_role;

create function public.portable_workstation_command(p_action text,p_actor jsonb,p_input jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 w public.portable_workstations%rowtype;
 d public.pos_live_drafts%rowtype;
 actor_role text := p_actor->>'role';
 actor_hash text := p_actor->>'credentialHash';
 station_id uuid;
 target_key uuid;
 target_salon uuid;
 device uuid;
 stamp timestamptz := clock_timestamp();
 limits public.portable_workstation_pair_limits%rowtype;
 identifier text;
 summary jsonb;
 rows_json jsonb;
 kind text;
 intent public.portable_workstation_intents%rowtype;
begin
 -- Also fence SECURITY DEFINER execution if a future grant is accidentally added.
 if coalesce(current_setting('request.jwt.claim.role',true),'') <> 'service_role'
    and coalesce(current_setting('request.jwt.claims',true),'{}')::jsonb->>'role' is distinct from 'service_role'
 then raise exception 'Server authority required' using errcode='42501'; end if;

 if p_action='pair' then
   if actor_role is distinct from 'pair' then return jsonb_build_object('error','Invalid enrollment','status',403);end if;
   foreach identifier in array array[p_actor->>'attemptHash',p_actor->>'networkHash'] loop
     if identifier is null or identifier !~ '^[a-f0-9]{64}$' then return jsonb_build_object('error','Invalid enrollment','status',400);end if;
     insert into portable_workstation_pair_limits values(identifier,1,stamp)
     on conflict(identifier_hash) do update set
       attempts=case when portable_workstation_pair_limits.window_started_at<stamp-interval '15 minutes' then 1 else portable_workstation_pair_limits.attempts+1 end,
       window_started_at=case when portable_workstation_pair_limits.window_started_at<stamp-interval '15 minutes' then stamp else portable_workstation_pair_limits.window_started_at end
     returning * into limits;
     if limits.attempts>20 then return jsonb_build_object('error','Too many pairing attempts. Try again later.','status',429);end if;
   end loop;
   select * into w from portable_workstations where code_hash=p_input->>'codeHash' and code_expires_at>stamp for update;
   if w.id is null or w.customer_hash is not null then return jsonb_build_object('error','Pairing code is invalid or expired.','status',400);end if;
   if coalesce(p_input->>'customerHash','') !~ '^[a-f0-9]{64}$' then return jsonb_build_object('error','Invalid enrollment','status',400);end if;
   update portable_workstations set customer_hash=p_input->>'customerHash',customer_selection=null,code_hash=null,code_expires_at=null where id=w.id returning * into w;
   return to_jsonb(w);
 end if;

 if actor_role='staff' then
   target_key:=(p_actor->>'keyId')::uuid;target_salon:=(p_actor->>'salonId')::uuid;device:=(p_actor->>'deviceId')::uuid;
   if actor_hash is null or actor_hash !~ '^[a-f0-9]{64}$' or device is null
      or not exists(select 1 from pos_portable_access_keys where id=target_key and salon_id=target_salon and is_active)
   then return jsonb_build_object('error','Portable POS login required.','status',401);end if;
   if p_action='list' then
     select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'label',s.label,'generation',s.generation,
       'customerPaired',s.customer_hash is not null,'staffOnline',coalesce(s.lease_until>stamp,false),
       'canHandover',coalesce(s.heartbeat_at>stamp-interval '20 seconds' and not s.dirty and not s.pending and s.cart_id is not null and s.revision is not null,false)) order by s.created_at),'[]'::jsonb)
       into rows_json from portable_workstations s where s.key_id=target_key and s.salon_id=target_salon;
     return rows_json;
   end if;
   if p_action='create' then
     if length(btrim(coalesce(p_input->>'label','')))<1 or length(btrim(p_input->>'label'))>64 then return jsonb_build_object('error','Enter a workstation name (1–64 characters).','status',400);end if;
     perform pg_advisory_xact_lock(hashtextextended('portable-workstation:'||target_key::text,0));
     select * into d from pos_live_drafts where token=p_input->>'draftToken' and salon_id=target_salon for update;
     if d.id is null then return jsonb_build_object('error','Open the staff POS before creating a workstation.','status',409);end if;
     if exists(select 1 from portable_workstations where draft_id=d.id) then
       insert into pos_live_drafts(salon_id,token) values(target_salon,replace(gen_random_uuid()::text,'-','')) returning * into d;
     else
       -- Retire previously copied legacy display links before this draft gains
       -- revocable customer enrollment. Keep the actual cart and its row ID.
       update pos_live_drafts set token=replace(gen_random_uuid()::text,'-','') where id=d.id returning * into d;
     end if;
     insert into portable_workstations(salon_id,key_id,draft_id,label,writer_hash,writer_device)
       values(target_salon,target_key,d.id,btrim(p_input->>'label'),actor_hash,device) returning * into w;
     insert into pos_workspace_drafts(key_id,device_id,draft_id) values(target_key,device,d.id)
       on conflict(key_id,device_id) do update set draft_id=excluded.draft_id;
     return to_jsonb(w);
   end if;
   station_id:=nullif(coalesce(p_input->>'workstationId',p_actor->>'workstationId'),'')::uuid;
   select * into w from portable_workstations where id=station_id and key_id=target_key and salon_id=target_salon for update;
   if w.id is null then return jsonb_build_object('error','Workstation not found.','status',404);end if;
   if p_action='select' then
     if w.writer_hash<>actor_hash or w.writer_device<>device then
       if w.heartbeat_at is null or w.heartbeat_at<stamp-interval '20 seconds' or w.dirty or w.pending or w.cart_id is null or w.revision is null
          or w.latest_envelope is null or w.latest_envelope->'payload'->>'cartId' is distinct from w.cart_id
          or w.latest_envelope->'payload'->>'revision' is distinct from w.revision
          or jsonb_array_length(coalesce(w.latest_envelope->'payload'->'payload'->'staffLines','[]'::jsonb))<>0
          or coalesce((w.latest_envelope->'payload'->'payload'->>'total')::numeric,0)<>0
          or coalesce(w.latest_envelope->'payload'->'payload'->'customer','null'::jsonb)<>'null'::jsonb then
         return jsonb_build_object('error','The current workstation must be online with a saved, empty cart before handover.','status',409);
       end if;
       update portable_workstations set writer_hash=actor_hash,writer_device=device,generation=generation+1,event_sequence=0,
         topic='portable-workstation:'||replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),
         lease_until=null,heartbeat_at=null,dirty=true,pending=true,latest_envelope=null,customer_selection=null where id=w.id returning * into w;
       -- Handover is allowed only for a confirmed empty cart. A retired staff
       -- device's legacy customer bearer must also stop authorizing that draft.
       update pos_live_drafts set token=replace(gen_random_uuid()::text,'-','') where id=w.draft_id;
     end if;
     -- A draft belongs to this station, and the device mapping follows a claim.
     delete from pos_workspace_drafts where draft_id=w.draft_id and not(key_id=target_key and device_id=device);
     insert into pos_workspace_drafts(key_id,device_id,draft_id) values(target_key,device,w.draft_id)
       on conflict(key_id,device_id) do update set draft_id=excluded.draft_id;
     return to_jsonb(w);
   end if;
   if w.writer_hash<>actor_hash or w.writer_device<>device then return jsonb_build_object('error','This workstation is open on another staff device.','status',409);end if;
 elsif actor_role='customer' then
   station_id:=(p_actor->>'workstationId')::uuid;
   select * into w from portable_workstations where id=station_id and customer_hash=actor_hash for update;
   if w.id is null then return jsonb_build_object('error','Customer screen disconnected. Pair it again.','status',401);end if;
 else return jsonb_build_object('error','Portable POS login or customer pairing required.','status',401);
 end if;

 if p_action='current' then return to_jsonb(w);end if;
 if p_action='allowCustomer' and actor_role='customer' then
   update portable_workstations set customer_selection=p_input||jsonb_build_object('expiresAt',stamp+interval '2 minutes','credentialHash',actor_hash) where id=w.id returning * into w;
   return to_jsonb(w);
 end if;
 if p_action='heartbeat' and actor_role='staff' then
   if jsonb_typeof(p_input->'dirty') is distinct from 'boolean' or jsonb_typeof(p_input->'pending') is distinct from 'boolean'
     or length(coalesce(p_input->>'cartId',''))>128 or length(coalesce(p_input->>'revision',''))>128
   then return jsonb_build_object('error','Invalid workstation heartbeat.','status',400);end if;
   update portable_workstations set lease_until=stamp+interval '20 seconds',heartbeat_at=stamp,
     dirty=(p_input->>'dirty')::boolean,pending=(p_input->>'pending')::boolean,
     cart_id=nullif(p_input->>'cartId',''),revision=nullif(p_input->>'revision','') where id=w.id returning * into w;
   return to_jsonb(w);
 end if;
 if p_action='logout' and actor_role='staff' then
   update portable_workstations set lease_until=null,heartbeat_at=null,dirty=true,pending=true where id=w.id returning * into w;
   return to_jsonb(w);
 end if;
 if p_action in ('code','revoke') and actor_role='staff' then
   if p_action='code' and w.customer_hash is not null and coalesce((p_input->>'replace')::boolean,false)=false then
     return jsonb_build_object('error','A customer screen is paired. Choose Replace to disconnect it first.','status',409);
   end if;
   update portable_workstations set customer_hash=null,customer_selection=null,generation=generation+1,event_sequence=0,
     topic='portable-workstation:'||replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),latest_envelope=null,
     code_hash=case when p_action='code' then p_input->>'codeHash' else null end,
     code_expires_at=case when p_action='code' then stamp+interval '5 minutes' else null end where id=w.id returning * into w;
   return to_jsonb(w);
 end if;
 if p_action='reserveEvent' then
   kind:=p_input->>'kind';
   if (actor_role='staff' and kind not in ('preview','ack','presence')) or (actor_role='customer' and kind<>'intent') then
     return jsonb_build_object('error','This screen cannot send that event.','status',403);
   end if;
   if kind='intent' then
     if w.lease_until is null or w.lease_until<=stamp then return jsonb_build_object('error','The staff POS is disconnected.','status',409);end if;
     if w.latest_envelope is null or w.latest_envelope->'payload'->>'cartId' is distinct from p_input->'payload'->>'cartId'
        or w.latest_envelope->'payload'->>'revision' is distinct from p_input->'payload'->>'revision'
        or coalesce((w.latest_envelope->'payload'->>'busy')::boolean,false)
        or (w.latest_envelope->'payload'->>'completedAt' is not null and p_input->'payload'->>'kind'<>'dismiss') then
       return jsonb_build_object('error','The receipt changed. Please try again.','status',409);
     end if;
     if p_input->'payload'->>'kind'='customer' and (w.customer_selection is null
        or w.customer_selection->>'credentialHash' is distinct from actor_hash
        or (w.customer_selection->>'expiresAt')::timestamptz<=stamp
        or w.customer_selection->>'cartId' is distinct from p_input->'payload'->>'cartId'
        or w.customer_selection->>'revision' is distinct from p_input->'payload'->>'revision'
        or w.customer_selection->'customer' is distinct from p_input->'payload'->'customer') then
       return jsonb_build_object('error','Confirm the customer phone number again.','status',403);
     end if;
     select * into intent from portable_workstation_intents where id=(p_input->'payload'->>'id')::uuid;
     if intent.id is not null then
       if intent.workstation_id<>w.id or intent.generation<>w.generation or intent.payload<>p_input->'payload' then return jsonb_build_object('error','Intent identity was reused.','status',409);end if;
       if intent.acknowledged then return jsonb_build_object('error','This customer action was already acknowledged.','status',409);end if;
     else
       if (select count(*) from portable_workstation_intents where workstation_id=w.id and not acknowledged and created_at>stamp-interval '1 minute')>=20 then return jsonb_build_object('error','Too many pending customer actions.','status',429);end if;
       insert into portable_workstation_intents(id,workstation_id,generation,cart_id,revision,payload)
         values((p_input->'payload'->>'id')::uuid,w.id,w.generation,p_input->'payload'->>'cartId',p_input->'payload'->>'revision',p_input->'payload');
     end if;
   elsif kind='ack' then
     update portable_workstation_intents set acknowledged=true where id=(p_input->'payload'->>'id')::uuid and workstation_id=w.id and generation=w.generation
       and cart_id=p_input->'payload'->>'cartId' and revision=p_input->'payload'->>'revision';
     if not found then return jsonb_build_object('error','Customer action expired.','status',409);end if;
   end if;
   update portable_workstations set event_sequence=event_sequence+1,
     lease_until=case when actor_role='staff' and kind='preview' then stamp+interval '20 seconds' else lease_until end
     where id=w.id returning * into w;
   return to_jsonb(w);
 end if;
 if p_action='commitEvent' then
   if (p_input->'envelope'->>'generation')::integer<>w.generation or (p_input->'envelope'->>'sequence')::bigint>w.event_sequence then
     return jsonb_build_object('error','Workstation pairing changed.','status',409);end if;
   kind:=p_input->'envelope'->>'kind';
   if actor_role='staff' and kind='preview' and coalesce((w.latest_envelope->>'sequence')::bigint,0)<(p_input->'envelope'->>'sequence')::bigint then
     update portable_workstations set latest_envelope=p_input->'envelope' where id=w.id returning * into w;
   elsif actor_role='customer' and kind<>'intent' then return jsonb_build_object('error','Invalid customer event.','status',403);end if;
   return to_jsonb(w);
 end if;
 return jsonb_build_object('error','Unknown workstation action.','status',400);
end;$$;
revoke all on function public.portable_workstation_command(text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.portable_workstation_command(text,jsonb,jsonb) to service_role;

-- A former writer cannot drop its enrollment cookie and call a legacy Portable
-- draft RPC directly. Unmanaged Windows/browser drafts keep their old contract.
create function public.portable_workstation_assert_legacy_draft(p_token text)
returns void language plpgsql security definer set search_path=public as $$begin
 if p_token is not null and exists(select 1 from portable_workstations w join pos_live_drafts d on d.id=w.draft_id where d.token=p_token)
    and coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role'
    and coalesce(current_setting('request.jwt.claims',true),'{}')::jsonb->>'role' is distinct from 'service_role'
 then raise exception 'Workstation enrollment required for this receipt' using errcode='42501';end if;
end;$$;
revoke all on function public.portable_workstation_assert_legacy_draft(text) from public,anon,authenticated;
grant execute on function public.portable_workstation_assert_legacy_draft(text) to service_role;
do $fence$
declare f record;source text;patched text;definition text;argument text;
begin
 for f in select p.oid,p.proname,p.prosrc,p.proargnames from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname in (
     'sync_pos_portable_draft','update_pos_portable_live_draft','update_pos_portable_live_draft_customer',
     'select_pos_portable_customer_visit_for_live_draft','finalize_pos_portable_live_draft',
     'submit_pos_portable_receipt','replay_pos_portable_operation')
 loop
   argument:=case when 'p_token'=any(f.proargnames) then 'p_token'
     when f.proname='submit_pos_portable_receipt' then '(p_receipt->>''liveDraftToken'')'
     when f.proname='replay_pos_portable_operation' then '(p_payload->>''liveDraftToken'')' else null end;
   if argument is null then raise exception 'Review workstation fence for %',f.proname;end if;
   source:=f.prosrc;
   patched:=regexp_replace(source,'\m[Bb][Ee][Gg][Ii][Nn]\M','begin perform public.portable_workstation_assert_legacy_draft('||argument||');');
   if patched=source then raise exception 'Review workstation function body for %',f.proname;end if;
   definition:=pg_get_functiondef(f.oid);
   execute replace(definition,source,patched);
   -- Existing Portable RPCs may grant only anon/authenticated. The validated
   -- station server proxy calls these exact functions as service_role.
   -- Preserve every legacy ACL and add only this existing server role.
   execute format('grant execute on function %s to service_role',f.oid::regprocedure);
 end loop;
end;$fence$;
notify pgrst,'reload schema';
commit;
