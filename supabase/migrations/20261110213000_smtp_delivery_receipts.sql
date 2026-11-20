-- SMTP has no provider idempotency key. Keep a durable claim before sending.
create table public.smtp_delivery_receipts (
  delivery_key text primary key check (length(delivery_key) between 1 and 200),
  status text not null check (status in ('sending','sent','failed','unknown')),
  provider_id text,
  updated_at timestamptz not null default now()
);
alter table public.smtp_delivery_receipts enable row level security;
revoke all on public.smtp_delivery_receipts from public, anon, authenticated;

create function public.claim_smtp_delivery(p_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare current_state text;
begin
  if p_key is null or length(p_key) not between 1 and 200 then raise exception 'Invalid delivery key'; end if;
  perform pg_advisory_xact_lock(hashtextextended('smtp:' || p_key, 0));
  select status into current_state from smtp_delivery_receipts where delivery_key = p_key;
  if current_state is null then
    insert into smtp_delivery_receipts(delivery_key,status) values(p_key,'sending');
  elsif current_state = 'failed' then
    update smtp_delivery_receipts set status='sending',updated_at=now() where delivery_key=p_key;
  else
    return jsonb_build_object('should_send',false,'status',current_state);
  end if;
  return jsonb_build_object('should_send',true,'status','sending');
end; $$;

create function public.finish_smtp_delivery(p_key text,p_status text,p_provider_id text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('sent','failed','unknown') or p_status is null then raise exception 'Invalid delivery outcome'; end if;
  update smtp_delivery_receipts set status=p_status,provider_id=left(p_provider_id,500),updated_at=now()
  where delivery_key=p_key and status='sending';
  if not found then raise exception 'Delivery claim unavailable'; end if;
end; $$;
revoke all on function public.claim_smtp_delivery(text),public.finish_smtp_delivery(text,text,text) from public,anon,authenticated;
grant execute on function public.claim_smtp_delivery(text),public.finish_smtp_delivery(text,text,text) to service_role;
