begin;
create function public.pos_service_relay_project_staff(p_salon uuid,p_payload jsonb) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare member jsonb; projected jsonb:='[]'; pending bigint; working boolean;
begin
 if p_payload is null or jsonb_typeof(p_payload->'staff')<>'array' then return p_payload; end if;
 for member in select value from jsonb_array_elements(p_payload->'staff') loop
  pending:=pos_service_relay_pending_turns(p_salon,(member->>'id')::uuid);
  select exists(select 1 from service_relay_offers o join service_relay_tickets t on t.visit_id=o.visit_id where t.salon_id=p_salon and o.staff_id=(member->>'id')::uuid and o.status='working' and t.status='in_service') into working;
  member:=member||jsonb_build_object('service_status',case when working then 'working' else 'ready' end,
   'turns',coalesce(member->'turns','{}'::jsonb)||jsonb_build_object('pendingTurns',pending,
    'queueTurns',coalesce((member->'turns'->>'queueTurns')::numeric,0)+pending,
    'largeTurns',coalesce((member->'turns'->>'largeTurns')::numeric,0)+pending,
    'totalTurns',coalesce((member->'turns'->>'totalTurns')::numeric,0)+pending));
  projected:=projected||jsonb_build_array(member);
 end loop;
 return jsonb_set(p_payload,'{staff}',projected);
end $$;
revoke all on function public.pos_service_relay_project_staff(uuid,jsonb) from public,anon,authenticated;

-- Preserve the installed POS reader and layer the pending-work projection on it.
alter function public.pos_workspace_staff_snapshot(uuid,uuid,uuid[]) rename to pos_workspace_staff_snapshot_without_service_relay;
create function public.pos_workspace_staff_snapshot(p_salon uuid,p_key uuid,p_ids uuid[]) returns jsonb
language sql stable security definer set search_path=public as $$
 select pos_service_relay_project_staff(p_salon,pos_workspace_staff_snapshot_without_service_relay(p_salon,p_key,p_ids))
$$;
revoke all on function public.pos_workspace_staff_snapshot(uuid,uuid,uuid[]),public.pos_workspace_staff_snapshot_without_service_relay(uuid,uuid,uuid[]) from public,anon,authenticated;

alter function public.get_pos_portable_desk_data(uuid,text,date) rename to get_pos_portable_desk_data_without_service_relay;
create function public.get_pos_portable_desk_data(p_key_id uuid,p_session_signature text,p_work_date date default current_date) returns jsonb
language plpgsql security definer set search_path=public as $$
declare salon uuid; payload jsonb;
begin
 salon:=pos_portable_access_salon_id(p_key_id,p_session_signature);
 payload:=get_pos_portable_desk_data_without_service_relay(p_key_id,p_session_signature,p_work_date);
 if payload is null or salon is null then return null; end if;
 return pos_service_relay_project_staff(salon,payload);
end $$;
revoke all on function public.get_pos_portable_desk_data_without_service_relay(uuid,text,date),public.get_pos_portable_desk_data(uuid,text,date) from public,anon,authenticated;
grant execute on function public.get_pos_portable_desk_data(uuid,text,date) to anon,authenticated;

-- Uninstall never strands accepted work. Unaccepted offers can be discarded.
create function public.service_relay_remove_guard() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if old.plugin_id<>'service-relay' then return old; end if;
 perform pg_advisory_xact_lock(hashtextextended('service-relay:'||old.salon_id::text,0));
 if exists(select 1 from service_relay_tickets where salon_id=old.salon_id and status in ('in_service','checkout')) then raise exception 'Finish open service tickets before removing Service Relay.'; end if;
 update service_relay_offers o set status='expired' from service_relay_tickets t where t.visit_id=o.visit_id and t.salon_id=old.salon_id and o.status='offered';
 update service_relay_tickets set status='cancelled' where salon_id=old.salon_id and status='waiting';
 return old;
end $$;
create trigger service_relay_remove_guard before delete on salon_market_plugins for each row execute function service_relay_remove_guard();
revoke all on function public.service_relay_remove_guard() from public,anon,authenticated;
commit;
