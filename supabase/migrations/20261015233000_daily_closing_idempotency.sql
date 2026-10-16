-- A receipt and closing update commit together. Retrying a request never writes twice.
alter table public.pos_daily_closings add column if not exists save_revision integer not null default 0;

create or replace function public.bump_daily_closing_save_revision()
returns trigger language plpgsql set search_path=public as $$
begin
  new.save_revision := case when tg_op='INSERT' then 1 else old.save_revision+1 end;
  return new;
end; $$;
create trigger bump_daily_closing_save_revision before insert or update on public.pos_daily_closings
for each row execute function public.bump_daily_closing_save_revision();

create table public.daily_closing_save_receipts (
  salon_id uuid not null references public.locations(id) on delete cascade,
  actor_scope text not null,
  request_id uuid not null,
  report_date date not null,
  payload jsonb not null,
  before_values jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(salon_id,actor_scope,request_id)
);
alter table public.daily_closing_save_receipts enable row level security;
revoke all on public.daily_closing_save_receipts from public,anon,authenticated;

create or replace function public.daily_closing_actor_scope(p_salon uuid,p_key uuid,p_signature text,p_write boolean)
returns text language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=current_public_user_id();
begin
  if p_key is not null then
    if pos_portable_access_salon_id(p_key,p_signature) is distinct from p_salon
       or not pos_portable_access_has_capability(p_key,p_signature,'portable.report.view') then
      raise exception 'Not authorized' using errcode='42501';
    end if;
    return 'pos:'||p_key::text;
  end if;
  if actor is null or not user_has_salon_permission(p_salon,array['reports.view']) then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  -- Preserve both the app edit permission and the existing table write policy.
  if p_write and (not user_has_salon_permission(p_salon,array['payroll.manage'])
      or not user_has_salon_permission(p_salon,array['tickets.manage','financial_corrections.apply'])) then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  return 'user:'||actor::text;
end; $$;
revoke all on function public.daily_closing_actor_scope(uuid,uuid,text,boolean) from public,anon,authenticated;

create or replace function public.daily_closing_save_state(p_salon uuid,p_date date)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r pos_daily_closings%rowtype; business_today date;
begin
  select * into r from pos_daily_closings where salon_id=p_salon and report_date=p_date;
  business_today:=(now() at time zone get_salon_business_timezone(p_salon))::date;
  return jsonb_build_object('revision',coalesce(r.save_revision,0),'reportDate',p_date,
    'locked',p_date<business_today or r.locked_at is not null or coalesce(r.status,'draft') in ('auto_locked','locked','approved','payroll_locked'),
    'closingInputs',jsonb_build_object('approvedAt',r.approved_at,'cashAmount',coalesce(r.cash_amount,0),'closedAt',r.closed_at,
      'creditCardAmount',coalesce(r.credit_card_amount,0),'note',r.note,'otherAmount',coalesce(r.other_amount,0),'status',coalesce(r.status,'draft')));
end; $$;
revoke all on function public.daily_closing_save_state(uuid,date) from public,anon,authenticated;

create or replace function public.read_daily_closing_save_state(p_salon uuid,p_date date,p_request uuid default null,p_key uuid default null,p_signature text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor text; receipt jsonb;
begin
  actor:=daily_closing_actor_scope(p_salon,p_key,p_signature,false);
  if p_date is null then raise exception 'Report date is required'; end if;
  if p_request is not null then
    select result into receipt from daily_closing_save_receipts where salon_id=p_salon and actor_scope=actor and request_id=p_request and report_date=p_date;
  end if;
  return jsonb_build_object('scope',p_salon::text||':'||actor,'current',daily_closing_save_state(p_salon,p_date),'receipt',receipt);
end; $$;
revoke all on function public.read_daily_closing_save_state(uuid,date,uuid,uuid,text) from public;
grant execute on function public.read_daily_closing_save_state(uuid,date,uuid,uuid,text) to anon,authenticated;

create or replace function public.save_daily_closing_once(p_salon uuid,p_date date,p_request uuid,p_expected_revision integer,p_values jsonb,p_key uuid default null,p_signature text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor text; payload jsonb; previous daily_closing_save_receipts%rowtype; before_state jsonb; after_state jsonb;
  cash_value numeric; card_value numeric; other_value numeric; field text; amount numeric; saved_id uuid;
begin
  actor:=daily_closing_actor_scope(p_salon,p_key,p_signature,true);
  if p_date is null or p_request is null or p_expected_revision is null or p_expected_revision<0 then raise exception 'Reopen this report before saving'; end if;
  if p_values is null or jsonb_typeof(p_values)<>'object' or not p_values ?& array['cashAmount','creditCardAmount','otherAmount','note']
      or p_values-array['cashAmount','creditCardAmount','otherAmount','note']<>'{}'::jsonb then raise exception 'Invalid closing values'; end if;
  foreach field in array array['cashAmount','creditCardAmount','otherAmount'] loop
    if jsonb_typeof(p_values->field)<>'number' then raise exception 'Amounts must be numbers'; end if;
    amount:=(p_values->>field)::numeric;
    if amount<0 or amount>9999999999.99 or amount<>round(amount,2) then raise exception 'Enter an amount of 0 or more, with up to 2 decimal places.'; end if;
  end loop;
  if jsonb_typeof(p_values->'note') not in ('string','null') or length(coalesce(p_values->>'note',''))>4000 then raise exception 'Invalid closing note'; end if;
  payload:=jsonb_build_object('date',p_date,'revision',p_expected_revision,'values',p_values);
  perform pg_advisory_xact_lock(hashtextextended('closing-request:'||p_salon::text||actor||p_request::text,0));
  select * into previous from daily_closing_save_receipts where salon_id=p_salon and actor_scope=actor and request_id=p_request;
  if found then
    if previous.payload<>payload then raise exception 'This request ID belongs to different closing values' using errcode='22023'; end if;
    return jsonb_build_object('requestId',p_request,'receipt',previous.result,'current',daily_closing_save_state(p_salon,p_date),'replayed',true);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('pos-closing:'||p_salon::text||p_date::text,0));
  perform 1 from pos_daily_closings where salon_id=p_salon and report_date=p_date for update;
  before_state:=daily_closing_save_state(p_salon,p_date);
  if (before_state->>'locked')::boolean then raise exception 'This business date is locked. Please submit a correction request.' using errcode='55000'; end if;
  if (before_state->>'revision')::integer<>p_expected_revision then raise exception 'Closing amounts changed on another screen. Review the saved amounts before saving.' using errcode='PT409'; end if;
  cash_value:=(p_values->>'cashAmount')::numeric;card_value:=(p_values->>'creditCardAmount')::numeric;other_value:=(p_values->>'otherAmount')::numeric;
  -- Equal values are a no-op: no duplicate update/broadcast/audit side effects.
  if (before_state->'closingInputs'->>'cashAmount')::numeric<>cash_value
      or (before_state->'closingInputs'->>'creditCardAmount')::numeric<>card_value
      or (before_state->'closingInputs'->>'otherAmount')::numeric<>other_value
      or (before_state->'closingInputs'->>'note') is distinct from nullif(btrim(p_values->>'note'),'') then
    insert into pos_daily_closings(salon_id,report_date,cash_amount,credit_card_amount,other_amount,note,created_by,updated_by)
    values(p_salon,p_date,cash_value,card_value,other_value,nullif(btrim(p_values->>'note'),''),case when p_key is null then current_public_user_id() end,case when p_key is null then current_public_user_id() end)
    on conflict(salon_id,report_date) do update set cash_amount=excluded.cash_amount,credit_card_amount=excluded.credit_card_amount,
      other_amount=excluded.other_amount,note=excluded.note,updated_by=excluded.updated_by
    where pos_daily_closings.save_revision=p_expected_revision
      and pos_daily_closings.locked_at is null and pos_daily_closings.status not in ('auto_locked','locked','approved','payroll_locked')
    returning id into saved_id;
    if saved_id is null then raise exception 'Closing amounts changed on another screen. Review the saved amounts before saving.' using errcode='PT409'; end if;
  end if;
  after_state:=daily_closing_save_state(p_salon,p_date);
  insert into daily_closing_save_receipts(salon_id,actor_scope,request_id,report_date,payload,before_values,result)
  values(p_salon,actor,p_request,p_date,payload,before_state,after_state);
  return jsonb_build_object('requestId',p_request,'receipt',after_state,'current',after_state,'replayed',false);
end; $$;
revoke all on function public.save_daily_closing_once(uuid,date,uuid,integer,jsonb,uuid,text) from public;
grant execute on function public.save_daily_closing_once(uuid,date,uuid,integer,jsonb,uuid,text) to anon,authenticated;
