-- Setup is disposable; financial records and live operations are protected.
begin;
create or replace function public.guard_used_salon_record_delete()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare ref record; used boolean; reason text;
begin
  if not exists(select 1 from public.locations where id=OLD.salon_id) then return OLD; end if;
  for ref in select distinct c.conrelid from pg_constraint c
    where c.contype='f' and c.confrelid=TG_RELID order by c.conrelid
  loop
    execute format('lock table %s in share row exclusive mode',ref.conrelid::regclass);
  end loop;
  for ref in
    select c.conrelid,a.attname,n.nspname,t.relname
    from pg_constraint c
    cross join lateral unnest(c.conkey,c.confkey) k(child_num,parent_num)
    join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.child_num
    join pg_attribute p on p.attrelid=c.confrelid and p.attnum=k.parent_num
    join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
    where c.contype='f' and c.confrelid=TG_RELID and p.attname='id'
  loop
    -- These rows are setup or nonfinancial presentation. Existing FK actions
    -- remove the setup or unlink the staff/service while retaining posts/users.
    if ref.nspname='public' and ref.relname=any(array[
      'staff_service_assignments','service_add_on_links','staff_availability_rules',
      'staff_time_blocks','staff_payroll_settings','staff_workdays',
      'staff_passcode_attempts','staff_attendance_events','staff_salon_connection_requests',
      'booking_status_events','salon_profile_looks','salon_profile_updates',
      'salon_profile_content_booking_configs','salon_profile_content_booking_services',
      'booking_inspirations','beauty_post_attributions'
    ]) then continue; end if;
    reason:='protected_history';
    if ref.nspname='public' and ref.relname='bookings' then
      execute format('select exists(select 1 from public.bookings where %I=$1 and status not in (''cancelled'',''no_show''))',ref.attname) into used using OLD.id;
      reason:='booking_history';
    elsif ref.nspname='public' and ref.relname='booking_lines' then
      execute format('select exists(select 1 from public.booking_lines l join public.bookings b on b.id=l.booking_id where l.%I=$1 and l.line_status<>''cancelled'' and b.status not in (''cancelled'',''no_show''))',ref.attname) into used using OLD.id;
      reason:='booking_history';
    else
      execute format('select exists(select 1 from %s where %I=$1)',ref.conrelid::regclass,ref.attname) into used using OLD.id;
      if ref.relname=any(array['pos_ticket_items','pos_ticket_item_turn_parts',
        'pos_ticket_staff_earnings','pos_daily_closing_staff_snapshots','pos_financial_adjustments',
        'payroll_period_staff_inputs','payroll_period_staff_input_history',
        'payroll_staff_lines','payroll_staff_daily_totals','payroll_paystubs']) then reason:='financial_history'; end if;
    end if;
    if used then
      raise exception using errcode='23503', message='Cannot delete: protected data exists. Hide this record instead.', detail=reason;
    end if;
  end loop;
  if TG_TABLE_NAME='staff' then
    -- Retire pending invitations; deleting a salon staff profile never deletes
    -- the linked person's login account or their memberships/financial records.
    update public.staff_salon_connection_requests set status='revoked',revoked_at=now(),token_hash=null
      where staff_id=OLD.id and direction='salon_invite' and status='pending';
  end if;
  return OLD;
end;
$$;
revoke all on function public.guard_used_salon_record_delete() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
