begin;

-- No browser role may inspect these records or the private staging bucket.
-- A signed PUT is restricted to a random object; only fresh original handlers
-- can attach the bytes to a business record. No credentials or command bodies.
create table public.app_local_upload_sessions (
 id uuid primary key,
 actor_key text not null check(actor_key ~ '^(user|guest):[0-9a-f-]{36}$'),
 scope text not null check(scope ~ '^v3:[a-f0-9]{64}$'),
 action_name text not null check(action_name in ('action.8bf63c94a49e4c5fa9fe2817','action.54072c2407a11cc75bd91fe7','action.805ee4ab28a6954dd0389212','action.ee11d447d1154d3e1ff376fb','action.0b1e0a58e14816ae5b2c1e9a','action.0eda261451682b1c1ea01f54')),
 target jsonb not null check(jsonb_typeof(target)='object' and octet_length(target::text)<=32768),
 file_name text not null check(length(file_name) between 1 and 255),
 mime_type text not null check(mime_type in ('application/pdf','image/png','image/jpeg','image/webp')),
 size_bytes integer not null check(size_bytes between 1 and 15728640),
 file_sha256 text not null check(file_sha256 ~ '^[a-f0-9]{64}$'),
 object_path text not null unique check(object_path ~ '^v1/[0-9a-f-]{36}$'),
 file_manifest jsonb not null check(jsonb_typeof(file_manifest)='array' and jsonb_array_length(file_manifest) between 1 and 3 and octet_length(file_manifest::text)<=8192),
 status text not null default 'pending' check(status in ('pending','processing','succeeded','failed','uncertain','cancelled')),
 result jsonb check(result is null or (jsonb_typeof(result)='object' and octet_length(result::text)<=65536)),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '10 minutes',
 claimed_at timestamptz,
 -- Supabase signed upload tokens remain valid for two hours. Terminal cleanup
 -- runs again after that window so a late token PUT cannot leave an orphan.
 cleanup_after timestamptz not null default now()+interval '130 minutes',
 cleaned_at timestamptz
);
create index app_local_upload_actor_idx on public.app_local_upload_sessions(actor_key,created_at);
create index app_local_upload_cleanup_idx on public.app_local_upload_sessions(cleanup_after) where cleaned_at is null;
alter table public.app_local_upload_sessions enable row level security;
revoke all on public.app_local_upload_sessions from public,anon,authenticated;
grant select,insert,update,delete on public.app_local_upload_sessions to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('app-local-upload-stage','app-local-upload-stage',false,15728640,array['application/pdf','image/png','image/jpeg','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

-- Serializing preparation per actor bounds temporary storage even when several
-- tabs race. Claim never returns a previously claimed operation for execution.
create function public.prepare_app_local_upload(p_id uuid,p_actor text,p_scope text,p_action text,p_target jsonb,p_file_name text,p_mime text,p_size integer,p_sha256 text,p_files jsonb default null)
returns public.app_local_upload_sessions language plpgsql set search_path=public as $$
declare row public.app_local_upload_sessions; files jsonb; chosen jsonb; max_bytes integer; allowed_keys text[]; item jsonb; i integer:=0;
begin
 perform pg_advisory_xact_lock(hashtextextended('app-local-upload:'||p_actor,0));
 if (select count(*) from public.app_local_upload_sessions where actor_key=p_actor and created_at>now()-interval '1 hour')>=20
 or (select count(*) from public.app_local_upload_sessions where actor_key=p_actor and status='pending' and expires_at>now())>=4 then
 raise exception 'Please finish the current attachment before adding another.';
 end if;
 max_bytes:=case when p_action in ('action.8bf63c94a49e4c5fa9fe2817','action.ee11d447d1154d3e1ff376fb') then 5242880 when p_action in ('action.0b1e0a58e14816ae5b2c1e9a','action.0eda261451682b1c1ea01f54') then 15728640 else 10485760 end;
 allowed_keys:=case when p_action='action.8bf63c94a49e4c5fa9fe2817' then array['file'] when p_action='action.ee11d447d1154d3e1ff376fb' then array['image'] when p_action in ('action.0b1e0a58e14816ae5b2c1e9a','action.0eda261451682b1c1ea01f54') then array['customer_background_image_file','customer_left_ad_image_file','customer_right_ad_image_file'] else array['paystub_file'] end;
 chosen:=coalesce(p_files,jsonb_build_array(jsonb_build_object('key',allowed_keys[1],'name',p_file_name,'type',p_mime,'size',p_size,'sha256',p_sha256)));
 if jsonb_typeof(chosen)<>'array' or jsonb_array_length(chosen) not between 1 and array_length(allowed_keys,1) or octet_length(chosen::text)>8192 then raise exception 'Invalid attachment files.'; end if;
 files:='[]'::jsonb;
 for item in select value from jsonb_array_elements(chosen) loop
   if not (item->>'key'=any(allowed_keys)) or (item->>'size')::integer not between 1 and max_bytes or item->>'type' not in ('application/pdf','image/png','image/jpeg','image/webp') or (array_length(allowed_keys,1)=3 or p_action='action.ee11d447d1154d3e1ff376fb') and item->>'type'='application/pdf' or item->>'sha256' !~ '^[a-f0-9]{64}$' then raise exception 'Invalid attachment file (5 MB evidence,10 MB paystub,15 MB POS maximum).'; end if;
   if exists(select 1 from jsonb_array_elements(files) x where x->>'key'=item->>'key') then raise exception 'Duplicate attachment field.'; end if;
   files:=files||jsonb_build_array(item||jsonb_build_object('object_path','v1/'||p_id::text||case when i=0 then '' else '/'||i::text end));i:=i+1;
 end loop;
 insert into public.app_local_upload_sessions(id,actor_key,scope,action_name,target,file_name,mime_type,size_bytes,file_sha256,object_path,file_manifest)
 values(p_id,p_actor,p_scope,p_action,p_target,p_file_name,p_mime,p_size,p_sha256,'v1/'||p_id::text,files) returning * into row;
 return row;
end $$;
create function public.claim_app_local_upload(p_id uuid,p_actor text,p_scope text)
returns setof public.app_local_upload_sessions language sql set search_path=public as $$
 update public.app_local_upload_sessions set status='processing',claimed_at=now()
 where id=p_id and actor_key=p_actor and scope=p_scope and status='pending' and expires_at>now() returning *;
$$;
revoke all on function public.prepare_app_local_upload(uuid,text,text,text,jsonb,text,text,integer,text,jsonb),public.claim_app_local_upload(uuid,text,text) from public,anon,authenticated;
grant execute on function public.prepare_app_local_upload(uuid,text,text,text,jsonb,text,text,integer,text,jsonb),public.claim_app_local_upload(uuid,text,text) to service_role;
commit;
