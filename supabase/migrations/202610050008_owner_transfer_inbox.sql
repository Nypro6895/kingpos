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

update public.app_notifications set href='/my-place' where notification_type='owner_transfer_invite';

create or replace function public.route_owner_transfer_notification() returns trigger
language plpgsql set search_path=public as $$
begin
 if new.notification_type='owner_transfer_invite' then new.href='/my-place'; end if;
 return new;
end;$$;
create trigger route_owner_transfer_notification before insert on public.app_notifications
for each row execute function public.route_owner_transfer_notification();

create or replace function public.notification_feed(p_kind text default 'customer',p_salon uuid default null,p_account uuid default null,p_unread boolean default false,p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 10)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=current_public_user_id(); items jsonb; unread_count integer;
begin
 if actor is null then raise exception 'Not authorized'; end if;
 if p_kind not in ('customer','staff','owner_manager') or p_limit not between 1 and 51 or ((p_before is null)<>(p_before_id is null)) then raise exception 'Invalid query'; end if;
 select count(*) into unread_count from app_notifications n where n.recipient_user_id=actor and n.read_at is null and
 ((n.recipient_kind=p_kind and (p_salon is null or n.salon_id=p_salon) and (p_account is null or n.account_id=p_account)) or notification_category(n.notification_type)='security' or n.notification_type='owner_transfer_invite');
 select coalesce(jsonb_agg(to_jsonb(rows) order by rows.created_at desc,rows.id desc),'[]') into items from (
 select n.id,n.salon_id,n.recipient_kind,n.notification_type,n.booking_id,n.title,n.body,n.href,n.read_at,n.created_at
 from app_notifications n where n.recipient_user_id=actor and
 ((n.recipient_kind=p_kind and (p_salon is null or n.salon_id=p_salon) and (p_account is null or n.account_id=p_account)) or notification_category(n.notification_type)='security' or n.notification_type='owner_transfer_invite')
 and (not p_unread or n.read_at is null) and (p_before is null or (n.created_at,n.id)<(p_before,p_before_id))
 order by n.created_at desc,n.id desc limit p_limit) rows;
 return jsonb_build_object('items',items,'unreadCount',unread_count);
end;$$;
revoke all on function public.notification_feed(text,uuid,uuid,boolean,timestamptz,uuid,integer) from public,anon;
grant execute on function public.notification_feed(text,uuid,uuid,boolean,timestamptz,uuid,integer) to authenticated;


-- Resolving an invitation also resolves its unread notification.
create or replace function public.resolve_owner_transfer_notification() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if old.status='pending' and new.status<>'pending' then
   update app_notifications set read_at=coalesce(read_at,now())
   where notification_type='owner_transfer_invite' and event_key='owner-transfer-invite:'||new.id::text;
 end if;
 return new;
end;$$;
revoke all on function public.resolve_owner_transfer_notification() from public,anon,authenticated;
create trigger resolve_owner_transfer_notification after update of status on public.salon_owner_transfer_invites
for each row execute function public.resolve_owner_transfer_notification();
