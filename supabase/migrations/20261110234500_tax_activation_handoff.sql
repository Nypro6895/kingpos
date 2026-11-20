-- Retain only the business label for an expired, otherwise valid connection.
-- Revoked credentials, generation mismatch and inactive identities disappear entirely.
-- Freeze the new return destination only for new Tax card reservations. Existing
-- reservations keep their original provider payload and idempotency key.
create function public.tax_activation_checkout_snapshot() returns trigger language plpgsql set search_path=public as $$
begin
 if new.plugin_id='tax-company' then new.snapshot:=new.snapshot || jsonb_build_object('tax_activation_setup',true); end if;
 return new;
end $$;
revoke all on function public.tax_activation_checkout_snapshot() from public,anon,authenticated;
create trigger tax_activation_checkout_return before insert on public.market_card_purchases for each row execute function public.tax_activation_checkout_snapshot();

create or replace function public.tax_businesses() returns jsonb language sql stable security definer set search_path=public as $$
 with connected as (select l.id,l.name,l.city,l.state,tax_company_has_access(l.id) active from tax_company_connections c join locations l on l.id=c.salon_id join tax_company_credentials k on k.salon_id=c.salon_id join users u on u.id=c.user_id
 where c.user_id=current_public_user_id() and u.status='active' and l.status='active' and k.enabled and c.generation=k.generation),
 latest as (select distinct on (r.salon_id,r.period_start,r.period_end) r.* from payroll_runs r join connected c on c.id=r.salon_id where c.active and r.status in ('printed','paid') order by r.salon_id,r.period_start,r.period_end,r.version desc),
 actionable as (select l.salon_id,l.staff_id,l.payroll_run_id,coalesce(w.status,'pending') status from payroll_staff_lines l join latest r on r.id=l.payroll_run_id left join tax_work_items w on w.payroll_run_id=l.payroll_run_id and w.staff_id=l.staff_id
 where l.tax_company_enabled_snapshot or l.final_check_amount<>0 or l.tax_company_taxable_gross>0 or l.tax_withheld>0)
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'city',c.city,'state',c.state,'active',c.active,'inactive_reason',case when not c.active then 'Owner needs to renew Tax Company access.' else null end,
 'pending_count',case when c.active then (select count(*) from actionable a where a.salon_id=c.id and not exists(select 1 from tax_documents d where d.salon_id=a.salon_id and d.staff_id=a.staff_id and d.payroll_run_id=a.payroll_run_id and d.kind='paystub' and d.archived_at is null and d.owner_deleted_at is null)) else null end,
 'missing_paystubs',case when c.active then (select count(*) from actionable a where a.salon_id=c.id and not exists(select 1 from tax_documents d where d.salon_id=a.salon_id and d.staff_id=a.staff_id and d.payroll_run_id=a.payroll_run_id and d.kind='paystub' and d.archived_at is null and d.owner_deleted_at is null)) else null end) order by c.name),'[]'::jsonb) from connected c;
$$;



notify pgrst,'reload schema';
