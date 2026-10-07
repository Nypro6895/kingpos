-- Restore the My Place inbox independently of unrelated notification migrations.
begin;
-- Recipient inbox works before the recipient has salon access.
create or replace function public.list_my_owner_transfer_invites()
returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'salonName',l.name,'mode',i.mode,'message',i.message,'expiresAt',i.expires_at) order by i.created_at desc),'[]'::jsonb)
 from salon_owner_transfer_invites i join locations l on l.id=i.salon_id
 join users u on u.id=current_public_user_id() and u.status='active'
 where i.status='pending' and i.expires_at>now()
 and (i.recipient_user_id=u.id or (i.recipient_user_id is null and i.target_email_normalized=normalize_lifecycle_email(u.email)));
$$;
revoke all on function public.list_my_owner_transfer_invites() from public,anon;
grant execute on function public.list_my_owner_transfer_invites() to authenticated;

create or replace function public.ignore_owner_transfer_invite(p_invite_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare actor uuid:=current_public_user_id(); invitation salon_owner_transfer_invites%rowtype;
begin
 select i.* into invitation from salon_owner_transfer_invites i
 join users u on u.id=actor and u.status='active'
 where i.id=p_invite_id and (i.recipient_user_id=actor or (i.recipient_user_id is null and i.target_email_normalized=normalize_lifecycle_email(u.email))) for update of i;
 if invitation.id is null then raise exception 'Owner invitation belongs to a different account.'; end if;
 if invitation.status<>'pending' or invitation.expires_at<=now() then raise exception 'Owner invitation is no longer pending.'; end if;
 update salon_owner_transfer_invites set status='revoked',revoked_at=now(),token_hash=null where id=invitation.id;
 update app_notifications set read_at=coalesce(read_at,now()) where recipient_user_id=actor and event_key='owner-transfer-invite:'||invitation.id::text;
end;$$;
revoke all on function public.ignore_owner_transfer_invite(uuid) from public,anon;
grant execute on function public.ignore_owner_transfer_invite(uuid) to authenticated;


-- The inbox uses the invitation id, while the existing acceptance routine
-- validates the recipient and performs the ownership transition by token hash.
create or replace function public.accept_salon_owner_transfer_invite_by_id(p_invite_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare invite_token_hash text;
begin
  select i.token_hash into invite_token_hash
  from public.salon_owner_transfer_invites i
  join public.users u on u.id=public.current_public_user_id() and u.status='active'
  where i.id=p_invite_id and i.status='pending' and i.expires_at>now()
    and (i.recipient_user_id=u.id or (i.recipient_user_id is null and i.target_email_normalized=public.normalize_lifecycle_email(u.email)));
  if invite_token_hash is null then raise exception 'Owner invitation was not found or is no longer pending.'; end if;
  return public.accept_salon_owner_transfer_invite(invite_token_hash);
end;
$$;
revoke all on function public.accept_salon_owner_transfer_invite_by_id(uuid) from public,anon;
grant execute on function public.accept_salon_owner_transfer_invite_by_id(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;

