alter table public.pos_tickets
drop constraint if exists pos_tickets_status_check;

alter table public.pos_tickets
add constraint pos_tickets_status_check check (
  status in ('open', 'closed', 'cancelled', 'voided')
);

create table if not exists public.pos_ticket_audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  ticket_id uuid not null references public.pos_tickets(id) on delete cascade,
  action text not null,
  note text not null,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint pos_ticket_audit_logs_action_check check (
    action in (
      'ticket_cancelled',
      'ticket_voided',
      'ticket_reopened',
      'ticket_checked_out'
    )
  ),
  constraint pos_ticket_audit_logs_note_not_blank check (
    length(btrim(note)) > 0
  )
);

create index if not exists pos_ticket_audit_logs_ticket_created_at_idx
on public.pos_ticket_audit_logs(ticket_id, created_at desc);

create index if not exists pos_ticket_audit_logs_organization_id_idx
on public.pos_ticket_audit_logs(organization_id);

create index if not exists pos_ticket_audit_logs_salon_id_idx
on public.pos_ticket_audit_logs(salon_id);

create index if not exists pos_ticket_audit_logs_created_by_idx
on public.pos_ticket_audit_logs(created_by);

create or replace function public.validate_pos_ticket_audit_log_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.locations
    where locations.id = new.salon_id
      and locations.organization_id = new.organization_id
  ) then
    raise exception 'POS ticket audit log salon must belong to POS ticket audit log organization.';
  end if;

  if not exists (
    select 1
    from public.pos_tickets
    where pos_tickets.id = new.ticket_id
      and pos_tickets.organization_id = new.organization_id
      and pos_tickets.salon_id = new.salon_id
  ) then
    raise exception 'POS ticket audit log ticket must belong to POS ticket audit log salon.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_pos_ticket_audit_log_scope
on public.pos_ticket_audit_logs;

create trigger validate_pos_ticket_audit_log_scope
before insert or update on public.pos_ticket_audit_logs
for each row
execute function public.validate_pos_ticket_audit_log_scope();

alter table public.pos_ticket_audit_logs enable row level security;

drop policy if exists "Organization members can view salon POS ticket audit logs"
on public.pos_ticket_audit_logs;
create policy "Organization members can view salon POS ticket audit logs"
on public.pos_ticket_audit_logs
for select
to authenticated
using (
  public.user_belongs_to_organization(organization_id)
  and exists (
    select 1
    from public.locations
    where locations.id = pos_ticket_audit_logs.salon_id
      and locations.organization_id = pos_ticket_audit_logs.organization_id
  )
);

drop policy if exists "Organization members can create salon POS ticket audit logs"
on public.pos_ticket_audit_logs;
create policy "Organization members can create salon POS ticket audit logs"
on public.pos_ticket_audit_logs
for insert
to authenticated
with check (
  public.user_belongs_to_organization(organization_id)
  and exists (
    select 1
    from public.locations
    where locations.id = pos_ticket_audit_logs.salon_id
      and locations.organization_id = pos_ticket_audit_logs.organization_id
  )
);
