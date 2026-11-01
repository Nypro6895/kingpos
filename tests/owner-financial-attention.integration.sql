\set ON_ERROR_STOP on
begin;
insert into locations values('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002');
insert into users values('20000000-0000-4000-8000-000000000001'),('20000000-0000-4000-8000-000000000002');
select set_config('test.user_id','20000000-0000-4000-8000-000000000001',true);
insert into customers values('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Anna');
insert into pos_tickets(id,salon_id,customer_id,ticket_number,opened_at,status,facts) values
('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','T001','2026-10-31 15:00-05','closed','{"ticket_number":"T001","status":"closed","service_total":50,"discount_amount":10,"discount_type":"fixed_amount","discount_value":10,"recorded_payment_total":40,"tip_amount":0,"tax_rate":0}'),
('40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','T002','2026-11-01 10:00-06','open','{"ticket_number":"T002","status":"open","service_total":50,"discount_amount":0,"recorded_payment_total":0,"tip_amount":0,"tax_rate":0}');
insert into customer_visits values
('50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',null,'2026-10-31 15:00-05',null,'waiting'),
('50000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',null,'2026-11-01 10:00-06',null,'in_service'),
('50000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','2026-10-31 15:00-05',null,'completed');
insert into financial_input_events values
('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','ticket','2026-10-31','40000000-0000-4000-8000-000000000001','{}','{"status":"closed","ticket_number":"T001","discount_amount":10,"discount_type":"fixed_amount","discount_value":10}','Sale','Counter device','2026-10-31 15:30-05','created'),
('60000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','ticket','2026-10-31','40000000-0000-4000-8000-000000000001','{"status":"closed","ticket_number":"T001","discount_amount":10,"discount_type":"fixed_amount","discount_value":10}','{"status":"closed","ticket_number":"T001","discount_amount":0,"discount_type":"fixed_amount","discount_value":0}','Discount removed','Counter device','2026-11-01 09:00-06','updated'),
('60000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','ticket','2026-11-01','40000000-0000-4000-8000-000000000002','{}','{"status":"open","discount_amount":5}','','Counter device','2026-11-01 10:00-06','draft');
do $$declare sid uuid:='10000000-0000-4000-8000-000000000001'; r jsonb; k text;begin
 r:=owner_financial_attention(sid);
 if (r->>'total')::int<>4 then raise exception 'Expected closing, two discounts and one unmatched visit: %',r;end if;
 if exists(select 1 from jsonb_array_elements(r->'items') x where x->>'item_key' like '%60000000-0000-4000-8000-000000000003%') then raise exception 'Draft sale became alert';end if;
 if exists(select 1 from jsonb_array_elements(r->'items') x where x->>'item_key' like '%50000000-0000-4000-8000-000000000002%') then raise exception 'In-service client flagged';end if;
 if exists(select 1 from jsonb_array_elements(r->'items') x where x->>'item_key' like '%50000000-0000-4000-8000-000000000003%') then raise exception 'Settled linked visit flagged';end if;
 if exists(select 1 from jsonb_array_elements(r->'items') x where x?'facts') then raise exception 'List exposes full facts';end if;
 k:='discount:60000000-0000-4000-8000-000000000002';
 perform owner_financial_attention_action(sid,k,'ignore');perform owner_financial_attention_action(sid,k,'ignore');
 r:=owner_financial_attention(sid);if (r->>'total')::int<>3 then raise exception 'Ignore did not persist idempotently';end if;
 r:=owner_financial_attention(sid,k);if not (r->'items'->0->>'ignored')::boolean or r->'items'->0->'facts'->>'note'<>'Discount removed' then raise exception 'Exact ignored details lost';end if;
 perform set_config('test.user_id','20000000-0000-4000-8000-000000000002',true);
 if (owner_financial_attention(sid)->>'total')::int<>4 then raise exception 'Ignore leaked across owners';end if;
 perform set_config('test.user_id','20000000-0000-4000-8000-000000000001',true);
 select item_key into k from owner_attention_candidates(sid) where kind='closing';
 begin perform owner_financial_attention_action(sid,k,'review_closing');raise exception 'Unentered collections accepted';exception when invalid_parameter_value then null;end;
 insert into pos_daily_closings(salon_id,report_date,cash_amount,live_report_entered_at) values(sid,'2026-10-31',40,now());
 select item_key into k from owner_attention_candidates(sid) where kind='closing';
 perform owner_financial_attention_action(sid,k,'review_closing');
 if exists(select 1 from owner_attention_candidates(sid) where kind='closing') then raise exception 'Reviewed day still flagged';end if;
 update pos_tickets set facts=jsonb_set(facts,'{recorded_payment_total}','35') where id='40000000-0000-4000-8000-000000000001';
 if not exists(select 1 from owner_attention_candidates(sid) where kind='closing' and item_key<>k) then raise exception 'Changed figures did not reopen review';end if;
 begin perform owner_financial_attention_action(sid,k,'review_closing');raise exception 'Stale review accepted';exception when serialization_failure then null;end;
 if not exists(select 1 from owner_attention_candidates(sid) where kind='checkin' and facts->>'ticketId'='40000000-0000-4000-8000-000000000001') then raise exception 'Closed but short receipt not flagged';end if;
 begin perform owner_financial_attention('10000000-0000-4000-8000-000000000002');raise exception 'Cross-salon access';exception when insufficient_privilege then null;end;
 perform set_config('test.user_id','30000000-0000-4000-8000-000000000001',true);
 begin perform owner_financial_attention(sid);raise exception 'Manager read allowed';exception when insufficient_privilege then null;end;
 begin perform owner_financial_attention_action(sid,k,'ignore');raise exception 'Manager mutation allowed';exception when insufficient_privilege then null;end;
 if has_table_privilege('authenticated','owner_attention_ignored','INSERT') or has_function_privilege('anon','owner_financial_attention(uuid,text,integer)','EXECUTE') or has_function_privilege('authenticated','owner_attention_candidates(uuid)','EXECUTE') then raise exception 'Direct privilege leak';end if;
 perform set_config('test.user_id','20000000-0000-4000-8000-000000000001',true);
 select item_key into k from owner_attention_candidates(sid) where kind='checkin' and facts->>'visitId'='50000000-0000-4000-8000-000000000001';
 perform owner_financial_attention_action(sid,k,'ignore');
 update customer_visits set status='checkout' where id='50000000-0000-4000-8000-000000000001';
 if not exists(select 1 from owner_attention_candidates(sid) where item_key=k) then raise exception 'Visit status changed matching identity';end if;
 if exists(select 1 from jsonb_array_elements(owner_financial_attention(sid)->'items') x where x->>'item_key'=k) then raise exception 'Ignored visit reappeared on status-only update';end if;
 insert into financial_input_events(id,salon_id,kind,business_date,source_id,before_values,after_values,note,actor_name,created_at,event_action)
 select ('70000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,sid,'ticket','2026-11-01','40000000-0000-4000-8000-000000000001','{"service_total":50}','{"service_total":49}','','Counter',now(),'updated' from generate_series(1,60) n;
 r:=owner_financial_attention(sid);
 if jsonb_array_length(r->'items')<>50 or (r->>'total')::int<=50 then raise exception 'List silently truncated its total';end if;
 if jsonb_array_length(owner_financial_attention(sid,null,1)->'items')<>(r->>'total')::int-50 then raise exception 'Pagination lost events';end if;
 raise notice 'PASS: persistent per-owner ignore, exact details, discount removal, draft suppression, check-in matching, stale review, fresh figures and cross-salon/role isolation';
end;$$;
rollback;
