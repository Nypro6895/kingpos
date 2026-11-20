begin;
-- Inclusive receipt inputs supersede, but never rewrite, historical service/tip inputs.
create table public.shop_daily_collections (
 salon_id uuid not null references public.locations(id), business_date date not null,
 cash numeric(14,2) not null check(cash>=0), card numeric(14,2) not null check(card>=0), other numeric(14,2) not null check(other>=0),
 note text not null default '', legacy_snapshot jsonb, revision integer not null default 1,
 updated_at timestamptz not null default now(), updated_by uuid not null,
 primary key(salon_id,business_date)
);
create table public.shop_expenses (
 id uuid primary key, salon_id uuid not null references public.locations(id), business_date date not null,
 paid_at timestamptz not null default now(), amount numeric(14,2) not null check(amount>0),
 category text not null check(category in ('supplies','rent','card_fee','other','tax_payment')),
 source text not null check(source in ('cash','bank','other')), note text not null default '',
 recurrence_key text, revision integer not null default 1, updated_at timestamptz not null default now(), updated_by uuid not null,
 unique(salon_id,recurrence_key)
);
create table public.shop_money_settings (
 salon_id uuid primary key references public.locations(id), rent numeric(14,2) not null default 0 check(rent>=0),
 rent_day integer not null default 1 check(rent_day between 1 and 28), fee_rate numeric(6,3) not null default 0 check(fee_rate between 0 and 100),
 fee_each numeric(10,2) not null default 0 check(fee_each>=0), revision integer not null default 1
);
create table public.shop_money_openings (
 salon_id uuid not null references public.locations(id), business_date date not null,
 cash numeric(14,2) not null default 0, bank numeric(14,2) not null default 0, other numeric(14,2) not null default 0,
 tax numeric(14,2) not null default 0 check(tax>=0), revision integer not null default 1,
 primary key(salon_id,business_date)
);
create table public.shop_money_history (
 id uuid primary key default gen_random_uuid(), salon_id uuid not null references public.locations(id),
 business_date date not null, kind text not null, object_id text not null, before_value jsonb, after_value jsonb not null,
 actor_id uuid not null, created_at timestamptz not null default now()
);
create index shop_expenses_date on public.shop_expenses(salon_id,business_date);
create index shop_money_history_date on public.shop_money_history(salon_id,business_date,created_at);
do $$declare n text;begin foreach n in array array['shop_daily_collections','shop_expenses','shop_money_settings','shop_money_openings','shop_money_history'] loop
 execute format('alter table public.%I enable row level security',n);
 execute format('revoke all on public.%I from public,anon,authenticated',n);
end loop;end $$;

create function public.shop_money_write(p_salon uuid,p_op text,p_args jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare d date; old jsonb; result jsonb; oid text; rev integer; field text; amount numeric; uid uuid:=current_public_user_id();
begin
 if not coalesce(lifecycle_user_is_salon_owner(p_salon,uid,false),false) then raise exception 'Owner access required';end if;
 if jsonb_typeof(p_args) is distinct from 'object' then raise exception 'Invalid money input';end if;
 foreach field in array case p_op when 'collection' then array['cash','card','other'] when 'expense' then array['amount'] when 'opening' then array['cash','bank','other','tax'] when 'settings' then array['rent','feeEach'] else array[]::text[] end loop
  amount:=(p_args->>field)::numeric;
  if amount is null or amount>9999999999.99 or amount<>round(amount,2) then raise exception 'Use valid amounts with at most two decimals';end if;
 end loop;
 d:=coalesce((p_args->>'date')::date,get_salon_business_date(p_salon));
 if d>get_salon_business_date(p_salon) then raise exception 'Cannot record future receipts or payments';end if;
 if length(coalesce(p_args->>'note',''))>1000 then raise exception 'Note is too long';end if;
 perform pg_advisory_xact_lock(hashtextextended('shop-money:'||p_salon::text,0));
 rev:=coalesce((p_args->>'revision')::integer,0);
 if p_op='collection' then
  oid:=d::text;select to_jsonb(c) into old from shop_daily_collections c where salon_id=p_salon and business_date=d for update;
  if coalesce((old->>'revision')::integer,0)<>rev then raise exception 'This day changed. Reload before saving';end if;
  insert into shop_daily_collections(salon_id,business_date,cash,card,other,note,updated_by) values(p_salon,d,(p_args->>'cash')::numeric,(p_args->>'card')::numeric,(p_args->>'other')::numeric,coalesce(p_args->>'note',''),uid)
  on conflict(salon_id,business_date) do update set cash=excluded.cash,card=excluded.card,other=excluded.other,note=excluded.note,revision=shop_daily_collections.revision+1,updated_at=now(),updated_by=uid returning to_jsonb(shop_daily_collections.*) into result;
 elsif p_op='expense' then
  oid:=(p_args->>'id')::uuid::text; select to_jsonb(e) into old from shop_expenses e where id=oid::uuid and salon_id=p_salon for update;
  if coalesce((old->>'revision')::integer,0)<>rev then raise exception 'This expense changed. Reload before saving';end if;
  if p_args->>'recurrence' is not null and (p_args->>'category'<>'rent' or p_args->>'recurrence'<>to_char(d,'YYYY-MM')) then raise exception 'Invalid rent month';end if;
  insert into shop_expenses(id,salon_id,business_date,paid_at,amount,category,source,note,recurrence_key,updated_by)
  values(oid::uuid,p_salon,d,coalesce((p_args->>'paidAt')::timestamptz,now()),(p_args->>'amount')::numeric,p_args->>'category',p_args->>'source',coalesce(p_args->>'note',''),p_args->>'recurrence',uid)
  on conflict(id) do update set business_date=excluded.business_date,paid_at=excluded.paid_at,amount=excluded.amount,category=excluded.category,source=excluded.source,note=excluded.note,revision=shop_expenses.revision+1,updated_at=now(),updated_by=uid
  where shop_expenses.salon_id=p_salon returning to_jsonb(shop_expenses.*) into result;
  if result is null then raise exception 'Expense unavailable';end if;
 elsif p_op='settings' then
  oid:='settings';select to_jsonb(s) into old from shop_money_settings s where salon_id=p_salon for update;
  if coalesce((old->>'revision')::integer,0)<>rev then raise exception 'Settings changed. Reload before saving';end if;
  insert into shop_money_settings(salon_id,rent,rent_day,fee_rate,fee_each) values(p_salon,(p_args->>'rent')::numeric,(p_args->>'rentDay')::integer,(p_args->>'feeRate')::numeric,(p_args->>'feeEach')::numeric)
  on conflict(salon_id) do update set rent=excluded.rent,rent_day=excluded.rent_day,fee_rate=excluded.fee_rate,fee_each=excluded.fee_each,revision=shop_money_settings.revision+1 returning to_jsonb(shop_money_settings.*) into result;
 elsif p_op='opening' then
  oid:=d::text;select to_jsonb(s) into old from shop_money_openings s where salon_id=p_salon and business_date=d for update;
  if coalesce((old->>'revision')::integer,0)<>rev then raise exception 'Opening balance changed. Reload before saving';end if;
  insert into shop_money_openings(salon_id,business_date,cash,bank,other,tax) values(p_salon,d,(p_args->>'cash')::numeric,(p_args->>'bank')::numeric,(p_args->>'other')::numeric,(p_args->>'tax')::numeric)
  on conflict(salon_id,business_date) do update set cash=excluded.cash,bank=excluded.bank,other=excluded.other,tax=excluded.tax,revision=shop_money_openings.revision+1 returning to_jsonb(shop_money_openings.*) into result;
 else raise exception 'Unknown money action';end if;
 if p_op='collection' and old is null then
  select jsonb_build_object('cash',cash_amount,'card',credit_card_amount,'other',other_amount,'legacyTip',coalesce(tip_input,0),'legacy',true) into old from pos_daily_closings where salon_id=p_salon and report_date=d and live_report_entered_at is not null;
 end if;
 if p_op='collection' then
  update shop_daily_collections set legacy_snapshot=(select jsonb_build_object('cash',cash_amount,'card',credit_card_amount,'other',other_amount,'tip',coalesce(tip_input,0),'entered',live_report_entered_at is not null) from pos_daily_closings where salon_id=p_salon and report_date=d) where salon_id=p_salon and business_date=d returning to_jsonb(shop_daily_collections.*) into result;
 end if;
 insert into shop_money_history(salon_id,business_date,kind,object_id,before_value,after_value,actor_id) values(p_salon,d,p_op,oid,old,result,uid);
 return result;
end $$;
revoke all on function public.shop_money_write(uuid,text,jsonb) from public,anon;
grant execute on function public.shop_money_write(uuid,text,jsonb) to authenticated;

create function public.shop_money_read(p_salon uuid,p_start date,p_end date) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare z text; a timestamptz;b timestamptz; result jsonb;days jsonb:='[]';d date;facts jsonb;flow jsonb;
begin
 if not coalesce(lifecycle_user_is_salon_owner(p_salon,current_public_user_id(),false),false) then raise exception 'Owner access required';end if;
 if p_start is null or p_end is null or p_end<p_start or p_end-p_start>366 then raise exception 'Choose at most 367 days';end if;
 z:=get_salon_business_timezone(p_salon);a:=p_start::timestamp at time zone z;b:=(p_end+1)::timestamp at time zone z;
 for d in select generate_series(p_start,least(p_end,get_salon_business_date(p_salon)),interval '1 day')::date loop
  facts:=get_daily_input_reconciliation(p_salon,d);
  flow:=gift_card_day_cashflow(p_salon,d);
  -- expectedService is already net of gift-service redemption; exclude gift-tip redemption once.
  days:=days||jsonb_build_array(jsonb_build_object('date',d,'expected',round(coalesce((facts->>'expectedService')::numeric,0)+coalesce((facts->>'expectedTip')::numeric,0)+coalesce((flow->>'counterSales')::numeric,0)/100-coalesce((flow->>'tipRedeemed')::numeric,0)/100,2)));
 end loop;
 select jsonb_build_object(
 'today',get_salon_business_date(p_salon),'timezone',z,'days',days,
 'cardTransactions',(select count(*) from pos_payments p join pos_tickets t on t.id=p.ticket_id and t.salon_id=p.salon_id where p.salon_id=p_salon and t.status='closed' and t.opened_at>=a and t.opened_at<b and p.payment_method in ('card','credit_card') and p.amount>0),
 'collections',coalesce((select jsonb_agg(to_jsonb(c) order by business_date) from shop_daily_collections c where salon_id=p_salon and business_date between p_start and p_end),'[]'),
 'legacy',coalesce((select jsonb_agg(jsonb_build_object('business_date',report_date,'cash',cash_amount,'card',credit_card_amount,'other',other_amount,'tip',coalesce(tip_input,0),'entered',live_report_entered_at is not null,'updated_at',updated_at)) from pos_daily_closings where salon_id=p_salon and report_date between p_start and p_end),'[]'),
 'expenses',coalesce((select jsonb_agg(to_jsonb(e) order by business_date desc,paid_at desc) from shop_expenses e where salon_id=p_salon and business_date between p_start and p_end),'[]'),
 'settings',(select to_jsonb(s) from shop_money_settings s where salon_id=p_salon),
 'opening',(select to_jsonb(s) from shop_money_openings s where salon_id=p_salon and business_date=p_start),
 'giftOpening',coalesce((select sum(delta) from gift_card_ledger where salon_id=p_salon and created_at<a),0)/100.0,
 'giftClosing',coalesce((select sum(delta) from gift_card_ledger where salon_id=p_salon and created_at<b),0)/100.0,
 'giftActivity',coalesce((select jsonb_agg(x order by x.created_at desc) from (select l.id,l.created_at,l.kind,l.delta,l.ticket_id,c.last4 from gift_card_ledger l join gift_cards c on c.id=l.card_id where l.salon_id=p_salon and l.created_at>=a and l.created_at<b and l.delta<>0 order by l.created_at desc limit 500)x),'[]'),
 'rewardOpening',coalesce((select sum(delta) from reward_ledger where salon_id=p_salon and created_at<a),0),
 'rewardClosing',coalesce((select sum(delta) from reward_ledger where salon_id=p_salon and created_at<b),0),
 'rewardActivity',coalesce((select jsonb_agg(x order by x.created_at desc) from (select l.id,l.created_at,l.delta,l.reason,l.ticket_id,l.user_id,
 (select name from customers c where c.location_id=l.salon_id and c.customer_user_id=l.user_id order by c.id limit 1) customer_name,
 (select ticket_number from pos_tickets t where t.id=l.ticket_id and t.salon_id=l.salon_id) ticket_number
 from reward_ledger l where salon_id=p_salon and created_at>=a and created_at<b order by created_at desc limit 500)x),'[]'),
 'rewardCredits',coalesce((select sum(greatest(delta,0)) from reward_ledger where salon_id=p_salon and created_at>=a and created_at<b),0),
 'rewardDebits',coalesce((select -sum(least(delta,0)) from reward_ledger where salon_id=p_salon and created_at>=a and created_at<b),0),
 'rewardSummary',(select jsonb_build_object('issued',coalesce(sum(greatest(delta,0)) filter(where reason not in ('Reward returned','Reward adjustment')),0),'spent',coalesce(-sum(least(delta,0)) filter(where reason in ('Reward used','Reward adjustment')),0),'adjustments',coalesce(sum(delta) filter(where reason like '%adjust%' or reason='Reward returned'),0)) from reward_ledger where salon_id=p_salon and created_at>=a and created_at<b),
 'discounts',coalesce((select jsonb_agg(x order by x.opened_at desc) from (select t.id,t.ticket_number,t.opened_at,t.discount_type,t.discount_value,
 round(case when t.discount_type='percentage' then coalesce((select sum(line_total) from pos_ticket_items i where i.pos_ticket_id=t.id and not i.is_removed),0)*least(t.discount_value,100)/100 else t.discount_value end,2) as total,
 coalesce((select sum((r.offer->>'valueCents')::numeric)/100 from reward_requests r where r.ticket_id=t.id and r.salon_id=p_salon and r.status='redeemed'),0) as reward
 from pos_tickets t where t.salon_id=p_salon and t.status='closed' and t.opened_at>=a and t.opened_at<b and t.discount_value>0 order by t.opened_at desc limit 500)x),'[]'),
 'history',coalesce((select jsonb_agg(to_jsonb(h) order by created_at desc) from shop_money_history h where salon_id=p_salon and business_date between p_start and p_end),'[]')
 ) into result;
 return result;
end $$;
revoke all on function public.shop_money_read(uuid,date,date) from public,anon;
grant execute on function public.shop_money_read(uuid,date,date) to authenticated;

create function public.shop_payroll_collections(p_salon uuid,p_start date,p_end date) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
 if not coalesce(lifecycle_user_is_salon_owner(p_salon,current_public_user_id(),false),false) then raise exception 'Owner access required';end if;
 if p_end<p_start or p_end-p_start>366 then raise exception 'Invalid collection range';end if;
 select coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('expected',round((facts.v->>'expectedService')::numeric+(facts.v->>'expectedTip')::numeric+coalesce((flow.v->>'counterSales')::numeric,0)/100-coalesce((flow.v->>'tipRedeemed')::numeric,0)/100,2))),'[]') into result
 from shop_daily_collections c
 cross join lateral(select get_daily_input_reconciliation(p_salon,c.business_date) v) facts
 cross join lateral(select gift_card_day_cashflow(p_salon,c.business_date) v) flow
 where c.salon_id=p_salon and c.business_date between p_start and p_end
 and c.legacy_snapshot is not distinct from (select jsonb_build_object('cash',cash_amount,'card',credit_card_amount,'other',other_amount,'tip',coalesce(tip_input,0),'entered',live_report_entered_at is not null) from pos_daily_closings where salon_id=p_salon and report_date=c.business_date);
 return result;
end $$;
revoke all on function public.shop_payroll_collections(uuid,date,date) from public,anon;
grant execute on function public.shop_payroll_collections(uuid,date,date) to authenticated;
commit;
