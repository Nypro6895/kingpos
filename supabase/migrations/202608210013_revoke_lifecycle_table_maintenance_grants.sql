-- RLS does not protect TRUNCATE/TRIGGER/REFERENCES privileges. Keep lifecycle
-- tables limited to the application grants they actually need.

revoke truncate, trigger, references on table
  public.account_lifecycle_events,
  public.salon_lifecycle_events,
  public.lifecycle_exports,
  public.deleted_auth_identities,
  public.lifecycle_support_admins,
  public.salon_owner_transfer_invites
from anon, authenticated;

revoke insert, update, delete on table
  public.account_lifecycle_events,
  public.salon_lifecycle_events,
  public.deleted_auth_identities,
  public.lifecycle_support_admins,
  public.salon_owner_transfer_invites
from anon, authenticated;

revoke all privileges on table
  public.deleted_auth_identities,
  public.lifecycle_support_admins
from anon, authenticated;

grant select on table public.account_lifecycle_events to authenticated;
grant select on table public.salon_lifecycle_events to authenticated;
grant select, insert, update on table public.lifecycle_exports to authenticated;
grant select on table public.salon_owner_transfer_invites to authenticated;
