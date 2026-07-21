create table if not exists public.pos_display_channels (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  token text not null unique,
  pos_message jsonb,
  pos_message_version integer not null default 0,
  customer_message jsonb,
  customer_message_version integer not null default 0,
  status text not null default 'waiting',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_display_channels_status_check check (
    status in ('waiting', 'receipt_sent', 'customer_confirmed', 'finalized')
  ),
  constraint pos_display_channels_versions_not_negative check (
    pos_message_version >= 0 and customer_message_version >= 0
  )
);

create index if not exists pos_display_channels_salon_status_idx
on public.pos_display_channels(salon_id, status);

create index if not exists pos_display_channels_token_idx
on public.pos_display_channels(token);

drop trigger if exists update_pos_display_channels_updated_at on public.pos_display_channels;
create trigger update_pos_display_channels_updated_at
before update on public.pos_display_channels
for each row
execute function public.update_updated_at_column();

alter table public.pos_display_channels enable row level security;

drop policy if exists "Organization members can view POS display channels" on public.pos_display_channels;
create policy "Organization members can view POS display channels"
on public.pos_display_channels
for select
to authenticated
using (
  exists (
    select 1
    from public.locations
    where locations.id = pos_display_channels.salon_id
      and public.user_belongs_to_organization(locations.organization_id)
  )
);

drop policy if exists "Organization members can create POS display channels" on public.pos_display_channels;
create policy "Organization members can create POS display channels"
on public.pos_display_channels
for insert
to authenticated
with check (
  exists (
    select 1
    from public.locations
    where locations.id = pos_display_channels.salon_id
      and public.user_belongs_to_organization(locations.organization_id)
  )
);

drop policy if exists "Organization members can update POS display channels" on public.pos_display_channels;
create policy "Organization members can update POS display channels"
on public.pos_display_channels
for update
to authenticated
using (
  exists (
    select 1
    from public.locations
    where locations.id = pos_display_channels.salon_id
      and public.user_belongs_to_organization(locations.organization_id)
  )
)
with check (
  exists (
    select 1
    from public.locations
    where locations.id = pos_display_channels.salon_id
      and public.user_belongs_to_organization(locations.organization_id)
  )
);

create or replace function public.get_pos_display_channel_by_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  channel_row public.pos_display_channels%rowtype;
begin
  select *
  into channel_row
  from public.pos_display_channels
  where token = p_token
  limit 1;

  if channel_row.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'id', channel_row.id,
    'salon_id', channel_row.salon_id,
    'token', channel_row.token,
    'pos_message', channel_row.pos_message,
    'pos_message_version', channel_row.pos_message_version,
    'customer_message', channel_row.customer_message,
    'customer_message_version', channel_row.customer_message_version,
    'status', channel_row.status,
    'updated_at', channel_row.updated_at
  );
end;
$$;

create or replace function public.confirm_pos_display_channel_tip(
  p_token text,
  p_customer_message jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  channel_row public.pos_display_channels%rowtype;
  tip_amount numeric := coalesce((p_customer_message ->> 'tipAmount')::numeric, 0);
begin
  if tip_amount < 0 then
    raise exception 'Tip must be zero or greater.';
  end if;

  update public.pos_display_channels
  set customer_message = p_customer_message,
      customer_message_version = customer_message_version + 1,
      status = 'customer_confirmed'
  where token = p_token
  returning * into channel_row;

  if channel_row.id is null then
    return null;
  end if;

  update public.pos_desk_sessions
  set tip_amount = round(tip_amount, 2),
      customer_confirmed_at = coalesce((p_customer_message ->> 'confirmedAt')::timestamptz, now()),
      last_activity_at = now(),
      expires_at = now() + interval '10 minutes'
  where customer_display_token = p_token
    and status = 'active'
    and expires_at > now();

  return public.get_pos_display_channel_by_token(p_token);
end;
$$;

grant execute on function public.get_pos_display_channel_by_token(text) to anon, authenticated;
grant execute on function public.confirm_pos_display_channel_tip(text, jsonb) to anon, authenticated;
