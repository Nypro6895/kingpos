begin;
alter table public.pos_tickets add column if not exists workspace_revision bigint not null default 0;
create or replace function public.advance_pos_workspace_ticket_revision() returns trigger language plpgsql set search_path=public as $$begin new.workspace_revision:=old.workspace_revision+1;return new;end;$$;
drop trigger if exists pos_workspace_ticket_revision on public.pos_tickets;
create trigger pos_workspace_ticket_revision before update on public.pos_tickets for each row execute function public.advance_pos_workspace_ticket_revision();
-- Preserve the established correction transaction and payroll/date checks.
do $patch$
declare definition text; start_at int; end_at int;
begin
 definition:=pg_get_functiondef('public.correct_pos_portable_closed_ticket(uuid,text,uuid,jsonb,jsonb,jsonb,jsonb,numeric,text)'::regprocedure);
 definition:=replace(definition,'public.correct_pos_portable_closed_ticket(', 'public.correct_pos_workspace_ticket_core(');
 start_at:=position('  target_salon_id :=' in definition);
 end_at:=position('  if p_ticket_id is null then' in definition);
 if start_at=0 or end_at<=start_at then raise exception 'Ticket correction core needs review';end if;
 definition:=overlay(definition placing '  target_salon_id := p_key_id;'||chr(10)||chr(10) from start_at for end_at-start_at);
 definition:=replace(definition,'    before_snapshot,'||chr(10)||'    null,','    before_snapshot,'||chr(10)||'    (select id from public.users where auth_user_id=auth.uid() limit 1),');
 execute definition;
 definition:=pg_get_functiondef('public.get_pos_portable_ticket_data(uuid,text,date)'::regprocedure);
 if position('''workspaceRevision''' in definition)=0 then
   definition:=replace(definition,'''createdAt'', ticket_calculations.created_at,','''createdAt'', ticket_calculations.created_at, ''workspaceRevision'', ticket_calculations.workspace_revision,');
   execute definition;
 end if;
end;$patch$;
revoke all on function public.correct_pos_workspace_ticket_core(uuid,text,uuid,jsonb,jsonb,jsonb,jsonb,numeric,text) from public,anon,authenticated;

create or replace function public.correct_pos_workspace_ticket(
 p_key uuid,p_signature text,p_salon uuid,p_ticket uuid,p_expected bigint,
 p_item_updates jsonb,p_item_parts jsonb,p_added_items jsonb,p_staff_tip_overrides jsonb,p_tip_total numeric,p_reason text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare salon uuid; current_version bigint; result jsonb;
begin
 if p_key is not null then
   salon:=pos_portable_access_salon_id(p_key,p_signature);
   if salon is null or not pos_portable_access_has_capability(p_key,p_signature,'portable.today.view') or not pos_portable_access_has_capability(p_key,p_signature,'portable.pos.use') then raise exception 'Not authorized';end if;
 else
   salon:=p_salon;
   if auth.uid() is null or salon is null or not user_has_salon_permission(salon,array['tickets.manage','tickets.void']::text[]) then raise exception 'Not authorized';end if;
 end if;
 if not salon_is_operational(salon) then raise exception 'This salon is not active.';end if;
 select workspace_revision into current_version from pos_tickets where id=p_ticket and salon_id=salon for update;
 if not found then raise exception 'Ticket not found';end if;
 if p_expected is null or current_version is distinct from p_expected then raise exception 'This ticket changed on another screen. Open the latest ticket and review your changes.';end if;
 result:=correct_pos_workspace_ticket_core(salon,null,p_ticket,p_item_updates,p_item_parts,p_added_items,p_staff_tip_overrides,p_tip_total,p_reason);
 update pos_tickets set updated_at=clock_timestamp() where id=p_ticket and salon_id=salon;
 return result;
end;$$;
revoke all on function public.correct_pos_workspace_ticket(uuid,text,uuid,uuid,bigint,jsonb,jsonb,jsonb,jsonb,numeric,text) from public;
grant execute on function public.correct_pos_workspace_ticket(uuid,text,uuid,uuid,bigint,jsonb,jsonb,jsonb,jsonb,numeric,text) to anon,authenticated;
-- Old clients must refresh before editing instead of bypassing the revision guard.
revoke all on function public.correct_pos_portable_closed_ticket(uuid,text,uuid,jsonb,jsonb,jsonb,jsonb,numeric,text) from public,anon,authenticated;
commit;
