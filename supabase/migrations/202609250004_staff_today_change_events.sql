-- Earnings/items can change independently of the ticket row (tip corrections,
-- staff reassignment, removed services). Publish invalidations after commit.
do $$
declare entry record;
begin
  for entry in select * from (values
    ('pos_ticket_staff_earnings','tickets','ticket_id'),
    ('pos_ticket_items','tickets','pos_ticket_id'),
    ('pos_financial_adjustments','report','staff_id'),
    ('staff_payroll_settings','settings','staff_id'),
    ('salon_payroll_settings','settings','salon_id'),
    ('payroll_period_staff_inputs','settings','staff_id'),
    ('payroll_runs','settings','id'),
    ('payroll_staff_lines','settings','staff_id'),
    ('payroll_staff_daily_totals','settings','staff_id'),
    ('payroll_paystubs','settings','staff_id')
  ) as updates(table_name,resource,id_column) loop
    execute format('drop trigger if exists staff_today_changed on public.%I',entry.table_name);
    execute format('create trigger staff_today_changed after insert or update or delete on public.%I for each row execute function public.notify_pos_workspace_change(%L,%L)',entry.table_name,entry.resource,entry.id_column);
  end loop;
end $$;
notify pgrst,'reload schema';
