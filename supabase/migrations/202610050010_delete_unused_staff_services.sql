-- Protect history even for callers that delete directly through the table API.
create or replace function public.guard_used_salon_record_delete()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare ref record; used boolean;
begin
  -- Preserve the separately authorized salon/account lifecycle cascade.
  if not exists(select 1 from public.locations where id = OLD.salon_id) then return OLD; end if;
  -- Lock referencing tables before checking, so a concurrent insert cannot slip
  -- between the check and an ON DELETE CASCADE / SET NULL operation.
  for ref in
    select distinct c.conrelid
    from pg_constraint c where c.contype = 'f' and c.confrelid = TG_RELID
    order by c.conrelid
  loop
    execute format('lock table %s in share row exclusive mode', ref.conrelid::regclass);
  end loop;
  for ref in
    select c.conrelid, a.attname
    from pg_constraint c
    cross join lateral unnest(c.conkey, c.confkey) as k(child_num, parent_num)
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.child_num
    join pg_attribute p on p.attrelid = c.confrelid and p.attnum = k.parent_num
    where c.contype = 'f' and c.confrelid = TG_RELID and p.attname = 'id'
  loop
    execute format('select exists(select 1 from %s where %I = $1)', ref.conrelid::regclass, ref.attname)
      into used using OLD.id;
    if used then
      raise exception using errcode = '23503', message = 'Cannot delete: this record has linked data. Turn it off instead.';
    end if;
  end loop;
  if TG_TABLE_NAME = 'staff' then
    if OLD.account_user_id is not null or OLD.user_id is not null then
      raise exception using errcode = '23503', message = 'Cannot delete staff connected to an account. Turn it off instead.';
    end if;
  end if;
  return OLD;
end;
$$;
revoke all on function public.guard_used_salon_record_delete() from public, anon, authenticated;

drop trigger if exists guard_used_staff_delete on public.staff;
create trigger guard_used_staff_delete before delete on public.staff
for each row execute function public.guard_used_salon_record_delete();
drop trigger if exists guard_used_service_delete on public.services;
create trigger guard_used_service_delete before delete on public.services
for each row execute function public.guard_used_salon_record_delete();

create or replace function public.delete_unused_salon_record(p_kind text, p_id uuid, p_salon_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare affected integer;
begin
  if p_kind not in ('staff', 'services') or p_kind is null then
    raise exception 'Invalid record kind.';
  end if;
  if auth.uid() is null or not coalesce(public.user_has_salon_permission(p_salon_id, array[p_kind || '.manage']), false) then
    raise exception using errcode = '42501', message = 'Permission denied.';
  end if;
  execute format('delete from public.%I where id = $1 and salon_id = $2', p_kind) using p_id, p_salon_id;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Record not found in this salon.'; end if;
end;
$$;
revoke all on function public.delete_unused_salon_record(text, uuid, uuid) from public, anon;
grant execute on function public.delete_unused_salon_record(text, uuid, uuid) to authenticated;
notify pgrst, 'reload schema';
