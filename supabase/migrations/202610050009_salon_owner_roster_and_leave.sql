-- Only current owners may inspect the ownership roster.
create or replace function public.get_salon_owner_roster(p_salon_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=current_public_user_id(); payload jsonb;
begin
 if actor is null or not lifecycle_user_is_salon_owner(p_salon_id,actor,true) then
   raise exception 'Only a current Owner can view salon ownership.';
 end if;
 with owner_ids as (
   select m.user_id from account_memberships m join locations l on l.account_id=m.account_id
   join roles r on r.id=m.role_id where l.id=p_salon_id and m.status='active' and upper(r.code)='OWNER'
   union
   select m.user_id from salon_memberships m join roles r on r.id=m.role_id
   where m.salon_id=p_salon_id and m.status='active' and upper(r.code)='OWNER'
 )
 select jsonb_build_object(
   'owners',coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',u.display_name,'email',u.email,'status',u.status,'isCurrentUser',u.id=actor) order by u.created_at,u.id),'[]'::jsonb),
   'canLeave',count(*) filter(where u.status='active' and u.id<>actor)>0
 ) into payload from owner_ids ids join users u on u.id=ids.user_id where u.status in ('active','pending_deletion');
 return payload;
end;$$;
revoke all on function public.get_salon_owner_roster(uuid) from public,anon;
grant execute on function public.get_salon_owner_roster(uuid) to authenticated;

-- Serialize departures on the salon so simultaneous departures cannot remove the last owner.
create or replace function public.relinquish_current_salon_ownership(p_salon_id uuid,p_reason text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=current_public_user_id();
begin
 if actor is null then raise exception 'Sign in before leaving salon ownership.'; end if;
 perform 1 from locations where id=p_salon_id for update;
 if not found then raise exception 'Salon was not found.'; end if;
 if not lifecycle_user_is_salon_owner(p_salon_id,actor,true) then raise exception 'Only a current Owner can relinquish ownership.'; end if;
 if lifecycle_active_owner_count(p_salon_id,actor)=0 then
   raise exception 'Another active Owner must remain. Invite a new Owner and wait for acceptance before leaving.';
 end if;
 return lifecycle_remove_owner_access_from_salon(p_salon_id,actor,actor,p_reason);
end;$$;
revoke all on function public.relinquish_current_salon_ownership(uuid,text) from public,anon;
grant execute on function public.relinquish_current_salon_ownership(uuid,text) to authenticated;
