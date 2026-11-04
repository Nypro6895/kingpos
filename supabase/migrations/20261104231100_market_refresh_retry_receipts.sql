begin;
-- The app supplies a fresh high-entropy retry key per refresh attempt. Only its
-- digest is stored. The receipt is AES-GCM ciphertext produced by the API with
-- that key; PostgreSQL never stores the returned plaintext token pair.
create table market_platform.refresh_receipts(
 client_id uuid not null references market_platform.apps(id),request_id uuid not null,
 old_refresh_hash text not null,retry_hash text not null,
 installation_id uuid not null,synthetic boolean not null,
 credential_generation integer not null,connection_generation bigint not null,version_id uuid not null,
 access_hash text not null,refresh_hash text not null,
 receipt jsonb not null,info jsonb not null,
 expires_at timestamptz not null default now()+interval '120 seconds',
 primary key(client_id,request_id)
);
create index market_refresh_receipt_expiry on market_platform.refresh_receipts(client_id,expires_at);
alter table market_platform.refresh_receipts enable row level security;
revoke all on market_platform.refresh_receipts from public,anon,authenticated,service_role;

create function market_platform.refresh_receipt_current(p_client uuid,p_installation uuid,p_synthetic boolean,p_access_hash text,p_refresh_hash text,p_credential_generation integer,p_connection_generation bigint,p_version uuid) returns boolean language sql stable security definer set search_path=pg_catalog,market_platform as $$
 select case when p_synthetic then exists(
 select 1 from synthetic_connections g join sandboxes s on s.id=g.sandbox_id
 join versions v on v.id=s.version_id join app_credentials c on c.app_id=v.app_id and c.generation=g.credential_generation
 where s.id=p_installation and v.app_id=p_client and c.generation=p_credential_generation and s.connection_epoch=p_connection_generation and v.id=p_version and g.access_hash=p_access_hash and g.refresh_hash=p_refresh_hash
 and g.access_until>now() and g.refresh_until>now() and g.sandbox_epoch=s.connection_epoch and g.sandbox_digest=s.token_hash and synthetic_allowed(s.id))
 else exists(select 1 from installations i join app_credentials c on c.app_id=i.app_id and c.generation=p_credential_generation join tokens t on t.installation_id=i.id and t.generation=i.generation and t.expires_at>now()
 join refresh_grants g on g.installation_id=i.id and g.generation=i.generation and g.expires_at>now()
 where i.id=p_installation and i.app_id=p_client and i.generation=p_connection_generation and i.version_id=p_version and t.token_hash=p_access_hash and g.token_hash=p_refresh_hash and connection_allowed(i.id)) end
$$;
revoke all on function market_platform.refresh_receipt_current(uuid,uuid,boolean,text,text,integer,bigint,uuid) from public,anon,authenticated,service_role;

create function public.market_platform_refresh_client_retry(p_client uuid,p_client_secret text,p_refresh_token text,p_request uuid,p_retry_hash text,p_receipt jsonb,p_access_hash text,p_refresh_hash text) returns jsonb language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare saved refresh_receipts;info jsonb;old_hash text;owned installations;client_gen integer;connection_gen bigint;version uuid;
begin
 if p_client_secret is null or p_client_secret !~ '^rmc_[A-Za-z0-9_-]{43}$' or p_refresh_token is null or p_refresh_token !~ '^rmr_[A-Za-z0-9_-]{43}$'
 or p_request is null or p_retry_hash is null or p_retry_hash !~ '^[a-f0-9]{64}$'
 or p_access_hash is null or p_access_hash !~ '^[a-f0-9]{64}$' or p_refresh_hash is null or p_refresh_hash !~ '^[a-f0-9]{64}$'
 or p_receipt is null or jsonb_typeof(p_receipt)<>'object' or (select count(*) from jsonb_object_keys(p_receipt))<>3 or not(p_receipt ?& array['iv','tag','data'])
 or char_length(p_receipt::text)>4096 or jsonb_typeof(p_receipt->'iv')<>'string' or jsonb_typeof(p_receipt->'tag')<>'string' or jsonb_typeof(p_receipt->'data')<>'string'
 or p_receipt->>'iv' !~ '^[A-Za-z0-9_-]{16}$' or p_receipt->>'tag' !~ '^[A-Za-z0-9_-]+$' or char_length(p_receipt->>'tag')<>22
 or p_receipt->>'data' !~ '^[A-Za-z0-9_-]+$' or char_length(p_receipt->>'data') not between 32 and 2048
 then raise exception using errcode='42501',message='Invalid retryable application connection.';end if;
 perform 1 from apps where id=p_client for share;
 select generation into client_gen from app_credentials where app_id=p_client and secret_hash=encode(sha256(convert_to(p_client_secret,'UTF8')),'hex') for share;
 if not found then raise exception using errcode='42501',message='Invalid application credentials.';end if;
 -- Serialize only the exact attempt, not every salon belonging to the app.
 perform pg_advisory_xact_lock(hashtextextended(p_client::text||':'||p_request::text,0));
 old_hash:=encode(sha256(convert_to(p_refresh_token,'UTF8')),'hex');
 select * into saved from refresh_receipts where client_id=p_client and request_id=p_request;
 if saved.client_id is not null then
  if saved.synthetic then perform 1 from sandboxes where id=saved.installation_id for share;
  else perform 1 from installations where id=saved.installation_id for share;end if;
  if saved.expires_at<=now() or saved.old_refresh_hash<>old_hash or saved.retry_hash<>p_retry_hash
  or not refresh_receipt_current(p_client,saved.installation_id,saved.synthetic,saved.access_hash,saved.refresh_hash,saved.credential_generation,saved.connection_generation,saved.version_id)
  then raise exception using errcode='42501',message='Refresh receipt expired, changed or revoked.';end if;
  return saved.info||jsonb_build_object('receipt',saved.receipt);
 end if;
 info:=public.market_platform_refresh_client(p_client,p_client_secret,p_refresh_token,p_access_hash,p_refresh_hash);
 if not coalesce((info->>'synthetic')::boolean,false) then
  select i.* into owned from installations i join refresh_grants g on g.installation_id=i.id where i.app_id=p_client and g.token_hash=p_refresh_hash for share of i;
  if owned.id is null then raise exception using errcode='42501',message='Refresh installation could not be confirmed.';end if;
  info:=info||jsonb_build_object('installationId',owned.id,'versionId',owned.version_id,'salonId',owned.salon_id,'synthetic',false);
  connection_gen:=owned.generation;version:=owned.version_id;
 else
  select s.connection_epoch,s.version_id into connection_gen,version from sandboxes s where s.id=(info->>'installationId')::uuid for share;
 end if;
 insert into refresh_receipts(client_id,request_id,old_refresh_hash,retry_hash,installation_id,synthetic,credential_generation,connection_generation,version_id,access_hash,refresh_hash,receipt,info)
 values(p_client,p_request,old_hash,p_retry_hash,(info->>'installationId')::uuid,coalesce((info->>'synthetic')::boolean,false),client_gen,connection_gen,version,p_access_hash,p_refresh_hash,p_receipt,info);
 delete from refresh_receipts where client_id=p_client and expires_at<=now();
 return info||jsonb_build_object('receipt',p_receipt);
end $$;
revoke all on function public.market_platform_refresh_client_retry(uuid,text,text,uuid,text,jsonb,text,text) from public,anon,authenticated,service_role;
grant execute on function public.market_platform_refresh_client_retry(uuid,text,text,uuid,text,jsonb,text,text) to anon,authenticated;
commit;
