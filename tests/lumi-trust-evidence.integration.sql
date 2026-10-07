begin;
do $test$
declare
  a uuid; s uuid; hidden uuid; u uuid; au uuid; c uuid; duplicate_c uuid;
  other_u uuid; other_c uuid; young_u uuid; young_c uuid; insider_u uuid; insider_c uuid;
  ticket uuid; old_ticket uuid; latest_ticket uuid; r record; n integer;
begin
  insert into accounts(name,status) values('LUMI rollback QA','active') returning id into a;
  insert into locations(account_id,name,status) values(a,'LUMI public QA','active') returning id into s;
  insert into locations(account_id,name,status) values(a,'LUMI private QA','active') returning id into hidden;
  insert into salon_settings(salon_id,business_name,public_discovery_enabled) values(s,'LUMI public QA',true),(hidden,'LUMI private QA',false)
    on conflict(salon_id) do update set public_discovery_enabled=excluded.public_discovery_enabled;
  for n in 1..4 loop
    au:=gen_random_uuid(); u:=gen_random_uuid();
    insert into auth.users(id,email) values(au,'lumi-'||au||'@example.invalid');
    insert into users(id,auth_user_id,email) values(u,au,'lumi-'||au||'@example.invalid');
    insert into customers(location_id,name,customer_user_id) values(s,'LUMI QA',u) returning id into c;
    if n=1 then other_u:=u; other_c:=c;
    elsif n=2 then young_u:=u; young_c:=c;
    elsif n=3 then insider_u:=u; insider_c:=c;
    end if;
  end loop;
  -- u/c are the returning customer; a second customer row has the same identity.
  insert into customers(location_id,name,customer_user_id) values(s,'Duplicate linked profile',u) returning id into duplicate_c;
  insert into salon_memberships(account_id,salon_id,user_id,status) values(a,s,insider_u,'active');
  insert into pos_tickets(salon_id,customer_id,ticket_number,ticket_sequence,opened_at,closed_at,status)
    values(s,c,'LUMI-1',1,now()-interval '100 days',now()-interval '100 days','closed') returning id into old_ticket;
  insert into pos_ticket_items(salon_id,pos_ticket_id,service_name_snapshot,quantity,unit_price,line_total)
    values(s,old_ticket,'Pedicure',1,40,40);
  insert into customer_visit_experiences(salon_id,ticket_id,customer_id,author_user_id,feedback_state,issue_status)
    values(s,old_ticket,c,u,'good','resolved');
  insert into pos_tickets(salon_id,customer_id,ticket_number,ticket_sequence,opened_at,closed_at,status)
    values(s,c,'LUMI-2',2,now()-interval '10 days',now()-interval '10 days','closed') returning id into latest_ticket;
  insert into pos_ticket_items(salon_id,pos_ticket_id,service_name_snapshot,quantity,unit_price,line_total)
    values(s,latest_ticket,'Pedicure',1,40,40);
  insert into customer_visit_experiences(salon_id,ticket_id,customer_id,author_user_id,feedback_state,issue_status)
    values(s,latest_ticket,c,u,'issue','resolved');
  -- Same-day split, a customer who did not return, a new customer, and an insider.
  for n in 3..7 loop
    insert into pos_tickets(salon_id,customer_id,ticket_number,ticket_sequence,opened_at,closed_at,status)
      values(s,case n when 3 then duplicate_c when 4 then other_c when 5 then young_c else insider_c end,
        'LUMI-'||n,n,
        now()-make_interval(days=>case n when 4 then 100 when 5 then 1 when 6 then 100 else 10 end),
        now()-make_interval(days=>case n when 4 then 100 when 5 then 1 when 6 then 100 else 10 end),'closed') returning id into ticket;
    insert into pos_ticket_items(salon_id,pos_ticket_id,service_name_snapshot,quantity,unit_price,line_total)
      values(s,ticket,'Pedicure',1,40,40);
  end loop;
  -- A free correction must not convert other_c into a returning customer.
  insert into pos_tickets(salon_id,customer_id,ticket_number,ticket_sequence,opened_at,closed_at,status)
    values(s,other_c,'LUMI-8',8,now()-interval '1 day',now()-interval '1 day','closed') returning id into ticket;
  insert into pos_ticket_items(salon_id,pos_ticket_id,service_name_snapshot,quantity,unit_price,line_total)
    values(s,ticket,'Free correction',1,0,0);
  -- A mismatched author/customer is not eligible feedback.
  insert into customer_visit_experiences(salon_id,ticket_id,customer_id,author_user_id,feedback_state)
    values(s,old_ticket,c,other_u,'good');
  select * into r from get_public_lumi_trust_signals(array[s]);
  if r.verified_visit_count<>4 or r.unique_visitor_count<>3 then
    raise exception 'Visit deduplication/identity/insider filter failed: %',row_to_json(r);
  end if;
  if r.eligible_return_customer_count<>2 or r.returning_customer_count<>1 then
    raise exception 'Mature cohort/free correction/new customer handling failed: %',row_to_json(r);
  end if;
  if r.feedback_customer_count<>1 or r.good_feedback_count<>0 or r.issue_feedback_count<>1 then
    raise exception 'Independent feedback/resolved issue/author validation failed: %',row_to_json(r);
  end if;
  if exists(select 1 from get_public_lumi_trust_signals(array[hidden])) or
     exists(select 1 from get_public_lumi_trust_signals(array[]::uuid[])) then
    raise exception 'Private salon/empty request leaked evidence';
  end if;
  -- The anon grant is deliberate, but the response must contain aggregate data only.
  if not has_function_privilege('anon','get_public_lumi_trust_signals(uuid[])','execute') then
    raise exception 'Public aggregate RPC grant missing';
  end if;
  raise notice 'LUMI Trust evidence integration passed (fixtures rolled back)';
end;
$test$;
rollback;
