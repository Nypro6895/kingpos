create policy "users_self_read" on public.users
for select to authenticated
using (auth_user_id = auth.uid() or id = public.current_public_user_id());
create policy "users_self_update" on public.users
for update to authenticated
using (id = public.current_public_user_id())
with check (id = public.current_public_user_id() and auth_user_id = auth.uid());
create policy "account_member_read_accounts" on public.accounts
for select to authenticated
using (public.user_belongs_to_account(id));
create policy "account_member_read_locations" on public.locations
for select to authenticated
using (public.user_belongs_to_account(account_id));
create policy "account_member_read_roles" on public.roles
for select to authenticated
using (public.user_belongs_to_account(account_id));
create policy "public_read_permissions" on public.permissions
for select to authenticated
using (auth.role() = 'authenticated');
create policy "account_member_read_role_permissions" on public.role_permissions
for select to authenticated
using (exists (
  select 1 from public.roles
  where roles.id = role_permissions.role_id
    and public.user_belongs_to_account(roles.account_id)
));
create policy "member_read_account_memberships" on public.account_memberships
for select to authenticated
using (public.user_belongs_to_account(account_id));
create policy "member_read_salon_memberships" on public.salon_memberships
for select to authenticated
using (public.user_belongs_to_account(account_id) or user_id = public.current_public_user_id());
create policy "salon_member_read_staff" on public.staff
for select to authenticated
using (public.user_can_manage_salon(salon_id) or account_user_id = public.current_public_user_id());
create policy "salon_member_read_settings" on public.salon_settings
for select to authenticated
using (public.user_can_manage_salon(salon_id));
create policy "salon_member_read_accounts" on public.accounts
for select to authenticated
using (
  exists (
    select 1
    from public.salon_memberships memberships
    where memberships.account_id = accounts.id
      and memberships.user_id = public.current_public_user_id()
      and memberships.status = 'active'
  )
);
create policy "salon_member_read_locations_by_membership" on public.locations
for select to authenticated
using (
  exists (
    select 1
    from public.salon_memberships memberships
    where memberships.salon_id = locations.id
      and memberships.user_id = public.current_public_user_id()
      and memberships.status = 'active'
  )
);
create policy "salon_member_read_roles" on public.roles
for select to authenticated
using (
  exists (
    select 1
    from public.salon_memberships memberships
    where memberships.account_id = roles.account_id
      and memberships.user_id = public.current_public_user_id()
      and memberships.status = 'active'
  )
);
create policy "salon_member_read_own_role_permissions" on public.role_permissions
for select to authenticated
using (
  exists (
    select 1
    from public.salon_memberships memberships
    where memberships.role_id = role_permissions.role_id
      and memberships.user_id = public.current_public_user_id()
      and memberships.status = 'active'
  )
);
create policy "salon_member_read_account_memberships_for_salon_account" on public.account_memberships
for select to authenticated
using (
  exists (
    select 1
    from public.salon_memberships memberships
    where memberships.account_id = account_memberships.account_id
      and memberships.user_id = public.current_public_user_id()
      and memberships.status = 'active'
  )
);
-- QA restricted column grants; canonical policy bodies above are unchanged.
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;REVOKE ALL ON TABLE public.users FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;REVOKE ALL ON TABLE public.accounts FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;REVOKE ALL ON TABLE public.locations FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;REVOKE ALL ON TABLE public.roles FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;REVOKE ALL ON TABLE public.permissions FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;REVOKE ALL ON TABLE public.role_permissions FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE public.account_memberships ENABLE ROW LEVEL SECURITY;REVOKE ALL ON TABLE public.account_memberships FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE public.salon_memberships ENABLE ROW LEVEL SECURITY;REVOKE ALL ON TABLE public.salon_memberships FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;REVOKE ALL ON TABLE public.staff FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE public.salon_settings ENABLE ROW LEVEL SECURITY;REVOKE ALL ON TABLE public.salon_settings FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE public.deleted_auth_identities ENABLE ROW LEVEL SECURITY;REVOKE ALL ON TABLE public.deleted_auth_identities FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE public.salon_profile_media_assets ENABLE ROW LEVEL SECURITY;REVOKE ALL ON TABLE public.salon_profile_media_assets FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.users TO authenticated;
GRANT SELECT ON public.accounts TO authenticated;
GRANT SELECT ON public.locations TO authenticated;
GRANT SELECT ON public.roles TO authenticated;
GRANT SELECT ON public.account_memberships TO authenticated;
GRANT SELECT ON public.salon_memberships TO authenticated;
GRANT SELECT(id,code) ON public.permissions TO authenticated;GRANT SELECT(role_id,permission_id) ON public.role_permissions TO authenticated;
GRANT SELECT(id,salon_id,account_user_id,is_active) ON public.staff TO authenticated;GRANT SELECT(salon_id,public_profile_logo_path) ON public.salon_settings TO authenticated;
GRANT UPDATE(display_name,first_name,last_name,language,timezone) ON public.users TO authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.current_public_user_id(),public.user_belongs_to_account(uuid),public.user_has_account_permission(uuid,text[]),public.user_can_manage_salon(uuid),public.user_has_salon_permission(uuid,text[]),public.auth_identity_is_deleted(uuid),public.ensure_personal_account_for_current_user(text) TO authenticated;
