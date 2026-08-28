-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. Make the
-- lifecycle RPC surface explicit so service-only/internal helpers are not
-- exposed as direct RPC bypasses.

do $$
declare
  routine_oid regprocedure;
  routine_signature text;
begin
  foreach routine_signature in array array[
    'public.disable_salon(uuid, text)',
    'public.reactivate_salon(uuid, text)',
    'public.close_salon_permanently(uuid, text)',
    'public.request_account_deletion(boolean, boolean, text)',
    'public.cancel_account_deletion()',
    'public.create_salon_owner_transfer_invite(uuid, text, text, text, timestamptz, text, boolean)',
    'public.accept_salon_owner_transfer_invite(text)',
    'public.accept_salon_owner_transfer_invite_by_id(uuid)',
    'public.revoke_salon_owner_transfer_invite(uuid)',
    'public.relinquish_current_salon_ownership(uuid, text)',
    'public.recover_permanently_closed_salon(uuid, uuid, text)',
    'public.auth_identity_is_deleted(uuid)',
    'public.lifecycle_current_user_is_support_admin()',
    'public.lifecycle_user_is_salon_owner(uuid, uuid, boolean)',
    'public.lifecycle_active_owner_count(uuid, uuid)',
    'public.account_deletion_other_active_owner_exists(uuid, uuid)',
    'public.account_deletion_unresolved_owned_salon_count(uuid)',
    'public.lifecycle_remove_owner_access_from_salon(uuid, uuid, uuid, text)',
    'public.finalize_account_deletion(uuid)',
    'public.finalize_due_account_deletions(integer)',
    'public.record_lifecycle_export_created()',
    'public.record_salon_lifecycle_status_change()',
    'public.prevent_direct_user_lifecycle_write()',
    'public.prevent_direct_salon_lifecycle_write()'
  ]
  loop
    routine_oid := to_regprocedure(routine_signature);

    if routine_oid is not null then
      execute format(
        'revoke all on function %s from public, anon, authenticated',
        routine_oid
      );
    end if;
  end loop;

  foreach routine_signature in array array[
    'public.disable_salon(uuid, text)',
    'public.reactivate_salon(uuid, text)',
    'public.close_salon_permanently(uuid, text)',
    'public.request_account_deletion(boolean, boolean, text)',
    'public.cancel_account_deletion()',
    'public.create_salon_owner_transfer_invite(uuid, text, text, text, timestamptz, text, boolean)',
    'public.accept_salon_owner_transfer_invite(text)',
    'public.accept_salon_owner_transfer_invite_by_id(uuid)',
    'public.revoke_salon_owner_transfer_invite(uuid)',
    'public.relinquish_current_salon_ownership(uuid, text)',
    'public.recover_permanently_closed_salon(uuid, uuid, text)',
    'public.auth_identity_is_deleted(uuid)',
    'public.lifecycle_current_user_is_support_admin()',
    'public.lifecycle_user_is_salon_owner(uuid, uuid, boolean)'
  ]
  loop
    routine_oid := to_regprocedure(routine_signature);

    if routine_oid is not null then
      execute format('grant execute on function %s to authenticated', routine_oid);
    end if;
  end loop;

  foreach routine_signature in array array[
    'public.finalize_account_deletion(uuid)',
    'public.finalize_due_account_deletions(integer)'
  ]
  loop
    routine_oid := to_regprocedure(routine_signature);

    if routine_oid is not null then
      execute format('grant execute on function %s to service_role', routine_oid);
    end if;
  end loop;
end $$;
