begin;

-- Expose only issued identifiers to the same active salon Owner as Check Writer.
-- No bank data, snapshot payload, payment status or payroll source is written.
create function public.payroll_issued_check_references(p_salon uuid,p_start date,p_end date)
returns table(id uuid,staff_id uuid,number text,period_start date,period_end date)
language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
 if not coalesce(public.lifecycle_user_is_salon_owner(p_salon,public.current_public_user_id(),false),false)
 or not exists(select 1 from public.locations where locations.id=p_salon and status='active') then
  raise exception 'Active salon Owner access is required.' using errcode='42501';
 end if;
 if p_start is null or p_end is null or p_start>p_end then raise exception 'Invalid payroll period.'; end if;
 return query select c.id,c.payroll_staff_id,c.number::text,c.period_start,c.period_end
 from public.check_writer_checks c where c.salon_id=p_salon and c.status='issued'
 and c.payroll_staff_id is not null and c.period_start=p_start and c.period_end=p_end
 order by c.number;
end $$;
revoke all on function public.payroll_issued_check_references(uuid,date,date) from public,anon;
grant execute on function public.payroll_issued_check_references(uuid,date,date) to authenticated;

-- Serialize reference changes with plugin issuance; bonus-only saves remain unchanged.
create function public.payroll_check_reference_guard() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if tg_op='UPDATE' and new.check_number is not distinct from old.check_number then return new; end if;
 if nullif(btrim(new.check_number),'') is null then return new; end if;
 perform pg_advisory_xact_lock(hashtextextended('check-writer:'||new.salon_id,0));
 if exists(select 1 from public.check_writer_checks c where c.salon_id=new.salon_id
 and c.payroll_staff_id=new.staff_id and c.status='issued'
 and daterange(c.period_start,c.period_end,'[]') && daterange(new.period_start,new.period_end,'[]')
 and ltrim(btrim(new.check_number),'0')<>c.number::text) then
  raise exception 'The check number conflicts with an issued Check Writer check. Review Check Writer history.';
 end if;
 return new;
end $$;
revoke all on function public.payroll_check_reference_guard() from public,anon,authenticated;
create trigger payroll_check_reference_guard before insert or update of check_number
on public.payroll_period_staff_inputs for each row execute function public.payroll_check_reference_guard();

create function public.check_writer_manual_reference_guard() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.payroll_staff_id is null or new.status<>'issued' then return new; end if;
 perform pg_advisory_xact_lock(hashtextextended('check-writer:'||new.salon_id,0));
 if exists(select 1 from public.payroll_period_staff_inputs p where p.salon_id=new.salon_id
 and p.staff_id=new.payroll_staff_id and nullif(btrim(p.check_number),'') is not null
 and daterange(p.period_start,p.period_end,'[]') && daterange(new.period_start,new.period_end,'[]')
 and ltrim(btrim(p.check_number),'0')<>new.number::text) then
  raise exception 'Existing payroll check number conflicts. Review the next number.';
 end if;
 return new;
end $$;
revoke all on function public.check_writer_manual_reference_guard() from public,anon,authenticated;
create trigger check_writer_manual_reference_guard before insert
on public.check_writer_checks for each row execute function public.check_writer_manual_reference_guard();
commit;
