-- Publish one immutable, disclosure-scoped projection for Owner and Tax.
-- The preceding payroll migration owns tax_reporting_snapshot and its capture.
create or replace function public.tax_sanitize_report_snapshot(p_snapshot jsonb)
returns jsonb language plpgsql immutable set search_path=public as $$
declare
 keys text[]:=array['check_wage','cash_wage','tip','bonus'];
 amounts text[]:=array['gross','tax','net','check_gross','check_tax','check_net','cash_gross','cash_tax','cash_net'];
 component jsonb; result_components jsonb:='{}'; result_totals jsonb:='{}'; unknown_amounts jsonb:='{}';
 key text; field text; value numeric; expected numeric; masked boolean; valid boolean:=true;
begin
 foreach field in array amounts loop unknown_amounts:=unknown_amounts||jsonb_build_object(field,null); end loop;
 -- Validate before projecting. A malformed snapshot never falls back to guessed detail.
 if p_snapshot is null or jsonb_typeof(p_snapshot)<>'object' or p_snapshot->'version' is distinct from '1'::jsonb
 or jsonb_typeof(p_snapshot->'components') is distinct from 'object'
 or jsonb_typeof(p_snapshot->'totals') is distinct from 'object' then valid:=false; end if;
 if valid then
  foreach key in array keys loop
   component:=p_snapshot->'components'->key;
   if jsonb_typeof(component) is distinct from 'object' or jsonb_typeof(component->'shown') is distinct from 'boolean'
    or coalesce(component->>'payout_method','') not in ('check','cash','mixed')
    or jsonb_typeof(component->'tax_applied') not in ('boolean','null') or not component ? 'tax_applied'
    or jsonb_typeof(component->'tax_rate') not in ('number','null') or not component ? 'tax_rate'
   then valid:=false; exit; end if;
   if jsonb_typeof(component->'tax_rate')='number' and ((component->>'tax_rate')::numeric<0 or (component->>'tax_rate')::numeric>100) then valid:=false; exit; end if;
   foreach field in array amounts loop
    if jsonb_typeof(component->field) is distinct from 'number' then valid:=false; exit; end if;
    value:=(component->>field)::numeric;
    if abs(value)>1000000000000 or value<>round(value,2) then valid:=false; exit; end if;
   end loop;
   exit when not valid;
   if (key='check_wage' and component->>'payout_method'<>'check') or (key='cash_wage' and component->>'payout_method'<>'cash')
    or (component->>'gross')::numeric<>(component->>'tax')::numeric+(component->>'net')::numeric
    or (component->>'gross')::numeric<>(component->>'check_gross')::numeric+(component->>'cash_gross')::numeric
    or (component->>'tax')::numeric<>(component->>'check_tax')::numeric+(component->>'cash_tax')::numeric
    or (component->>'net')::numeric<>(component->>'check_net')::numeric+(component->>'cash_net')::numeric
    or (component->>'check_gross')::numeric<>(component->>'check_tax')::numeric+(component->>'check_net')::numeric
    or (component->>'cash_gross')::numeric<>(component->>'cash_tax')::numeric+(component->>'cash_net')::numeric
    or (component->>'tax_applied'='false' and (component->>'tax')::numeric<>0)
    or (component->>'payout_method'='check' and ((component->>'cash_gross')::numeric<>0 or (component->>'cash_tax')::numeric<>0 or (component->>'cash_net')::numeric<>0))
    or (component->>'payout_method'='cash' and ((component->>'check_gross')::numeric<>0 or (component->>'check_tax')::numeric<>0 or (component->>'check_net')::numeric<>0))
   then valid:=false; exit; end if;
  end loop;
 end if;
 if valid then
  foreach field in array amounts loop
   if jsonb_typeof(p_snapshot->'totals'->field) is distinct from 'number' then valid:=false; exit; end if;
   select sum((p_snapshot->'components'->item->>field)::numeric) into expected from unnest(keys) item;
   if (p_snapshot->'totals'->>field)::numeric<>expected then valid:=false; exit; end if;
  end loop;
 end if;
 if not valid then
  foreach key in array keys loop
   result_components:=result_components||jsonb_build_object(key,unknown_amounts||jsonb_build_object('shown',false,'tax_applied',null,'tax_rate',null,'payout_method',null));
  end loop;
  return jsonb_build_object('version',1,'state','historical_unavailable','components',result_components,'totals',unknown_amounts);
 end if;
 foreach key in array keys loop
  component:=p_snapshot->'components'->key;
  if (component->>'shown')::boolean then
   result_components:=result_components||jsonb_build_object(key,jsonb_build_object('shown',true,'tax_applied',component->'tax_applied','tax_rate',component->'tax_rate','payout_method',component->'payout_method'));
   foreach field in array amounts loop result_components:=jsonb_set(result_components,array[key,field],component->field); end loop;
  else
   result_components:=result_components||jsonb_build_object(key,unknown_amounts||jsonb_build_object('shown',false,'tax_applied',null,'tax_rate',null,'payout_method',null));
  end if;
 end loop;
 foreach field in array amounts loop
  select exists(select 1 from unnest(keys) item where not (p_snapshot->'components'->item->>'shown')::boolean and (p_snapshot->'components'->item->>field)::numeric<>0) into masked;
  result_totals:=result_totals||jsonb_build_object(field,case when masked then 'null'::jsonb else p_snapshot->'totals'->field end);
 end loop;
 return jsonb_build_object('version',1,'state','published','components',result_components,'totals',result_totals);
end $$;

create or replace function public.tax_project_report_line(p_line jsonb,p_status text,p_work_version integer)
returns jsonb language plpgsql immutable set search_path=public as $$
declare
 breakdown jsonb:=tax_sanitize_report_snapshot(p_line->'tax_reporting_snapshot');
 components jsonb:=breakdown->'components'; totals jsonb:=breakdown->'totals';
 base jsonb; headlines jsonb; legacy boolean:=p_line->'tax_reporting_snapshot' is null or p_line->'tax_reporting_snapshot'='null'::jsonb;
begin
 base:=jsonb_build_object('id',p_line->'id','run_id',p_line->'payroll_run_id','staff_id',p_line->'staff_id','name',p_line->'staff_display_name_snapshot','legal_name',p_line->'staff_legal_name_snapshot',
  'mixed_settings',p_line->'is_mixed_rate','work_status',coalesce(p_status,'pending'),'work_version',coalesce(p_work_version,0),'breakdown',breakdown);
 if legacy then
  -- Existing snapshots retain their exact historical headline projection. No current settings or reconstructed component split.
  headlines:=jsonb_build_object('reported_wage',p_line->'tax_company_reported_wage_gross','reported_gross',p_line->'tax_company_taxable_gross','tax',p_line->'tax_withheld','actual_check',p_line->'final_check_amount','wage_check_net',p_line->'base_check_amount',
   'cash_reported',case when (p_line->>'cash_to_tax_company_snapshot')::boolean or ((p_line->>'tax_tips_snapshot')::boolean and p_line->>'tip_payout_method_snapshot'='cash') or ((p_line->>'tax_bonus_snapshot')::boolean and p_line->>'bonus_payout_method_snapshot'='cash') then p_line->'tax_company_cash_amount' else 'null'::jsonb end,
   'tip',case when (p_line->>'tax_tips_snapshot')::boolean then case when (p_line->>'tax_company_taxable_gross')::numeric-(p_line->>'tax_company_reported_wage_gross')::numeric-(case when (p_line->>'tax_bonus_snapshot')::boolean then (p_line->>'bonus_amount')::numeric else 0 end)>=0 then to_jsonb((p_line->>'tax_company_taxable_gross')::numeric-(p_line->>'tax_company_reported_wage_gross')::numeric-(case when (p_line->>'tax_bonus_snapshot')::boolean then (p_line->>'bonus_amount')::numeric else 0 end)) else 'null'::jsonb end else 'null'::jsonb end,
   'bonus',case when (p_line->>'tax_bonus_snapshot')::boolean then p_line->'bonus_amount' else 'null'::jsonb end,
   'tip_method',case when (p_line->>'tax_tips_snapshot')::boolean then case when (p_line->>'is_mixed_rate')::boolean then to_jsonb('historical settings'::text) else p_line->'tip_payout_method_snapshot' end else 'null'::jsonb end,
   'bonus_method',case when (p_line->>'tax_bonus_snapshot')::boolean then p_line->'bonus_payout_method_snapshot' else 'null'::jsonb end,
   'tax_rate',case when (p_line->>'is_mixed_rate')::boolean then 'null'::jsonb else p_line->'tax_rate_used' end);
 else
  -- Unknown or hidden values remain NULL, including every inferable aggregate.
  headlines:=jsonb_build_object('reported_wage',case when (components->'check_wage'->>'shown')::boolean and (components->'cash_wage'->>'shown')::boolean then to_jsonb((components->'check_wage'->>'gross')::numeric+(components->'cash_wage'->>'gross')::numeric) else 'null'::jsonb end,
   'reported_gross',totals->'gross','tax',totals->'tax','actual_check',totals->'check_net','wage_check_net',components->'check_wage'->'net','cash_reported',totals->'cash_gross',
   'tip',components->'tip'->'gross','bonus',components->'bonus'->'gross','tip_method',components->'tip'->'payout_method','bonus_method',components->'bonus'->'payout_method','tax_rate',components->'check_wage'->'tax_rate');
 end if;
 return base||headlines;
end $$;
revoke all on function public.tax_sanitize_report_snapshot(jsonb),public.tax_project_report_line(jsonb,text,integer) from public,anon,authenticated;

create or replace function public.tax_report_data(p_salon uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
 perform tax_actor();
 if not tax_can_work(p_salon) then raise exception 'This salon connection is inactive.'; end if;
 return jsonb_build_object(
  'salon',(select jsonb_build_object('id',id,'name',name,'phone',phone,'city',city,'state',state,'address_line1',address_line1) from locations where id=p_salon),
  'runs',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'period_start',r.period_start,'period_end',r.period_end,'version',r.version,'status',r.status,'cycle_type',r.cycle_type) order by r.period_start desc,r.version desc) from payroll_runs r where r.salon_id=p_salon and r.status in ('printed','paid')),'[]'::jsonb),
  'lines',coalesce((select jsonb_agg(tax_project_report_line(to_jsonb(l),w.status,w.version) order by l.staff_display_name_snapshot,l.payroll_run_id)
   from payroll_staff_lines l join payroll_runs r on r.id=l.payroll_run_id and r.salon_id=l.salon_id
   left join tax_work_items w on w.payroll_run_id=l.payroll_run_id and w.staff_id=l.staff_id
   where l.salon_id=p_salon and r.status in ('printed','paid') and
   (l.tax_reporting_snapshot is not null or l.tax_company_enabled_snapshot or l.final_check_amount<>0 or l.tax_company_taxable_gross>0 or l.tax_withheld>0)),'[]'::jsonb));
end $$;
revoke all on function public.tax_report_data(uuid) from public,anon;
grant execute on function public.tax_report_data(uuid) to authenticated;

create or replace function public.tax_workspace_data(p_salon uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare report jsonb:=tax_report_data(p_salon);
begin
 return report||jsonb_build_object(
  'people',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.display_name) order by s.display_name) from staff s where s.salon_id=p_salon),'[]'::jsonb),
  'documents',coalesce((select jsonb_agg(to_jsonb(d)-'path'-'bucket' order by d.created_at desc) from tax_documents d where d.salon_id=p_salon and d.owner_deleted_at is null),'[]'::jsonb),
  'messages',coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at) from tax_messages m where m.salon_id=p_salon),'[]'::jsonb),
  'receipts',coalesce((select jsonb_agg(to_jsonb(c) order by c.receipt_date desc) from tax_receipts c where c.salon_id=p_salon),'[]'::jsonb),
  'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc) from (select * from tax_events where salon_id=p_salon order by created_at desc limit 200) e),'[]'::jsonb));
end $$;
