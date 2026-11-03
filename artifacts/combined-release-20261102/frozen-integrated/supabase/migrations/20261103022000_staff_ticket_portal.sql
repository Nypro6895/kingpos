-- Read-only staff ticket portal. Staff identity is derived from auth, never a caller-supplied staff ID.
create table public.staff_ticket_edit_history (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  ticket_id uuid not null references public.pos_tickets(id) on delete cascade,
  work_date date not null,
  source text not null,
  actor_id uuid,
  actor_name text,
  before_values jsonb not null,
  after_values jsonb not null,
  created_at timestamptz not null default now()
);
create index staff_ticket_edit_history_day on public.staff_ticket_edit_history(salon_id,staff_id,work_date,ticket_id);
create index staff_ticket_edit_history_ticket on public.staff_ticket_edit_history(salon_id,staff_id,ticket_id,created_at);
alter table public.staff_ticket_edit_history enable row level security;
revoke all on public.staff_ticket_edit_history from public,anon,authenticated;

create function public.capture_staff_ticket_edit() returns trigger
language plpgsql security definer set search_path=public as $$
declare
  b jsonb := to_jsonb(old); a jsonb := case when tg_op='DELETE' then '{}'::jsonb else to_jsonb(new) end;
  before_data jsonb; after_data jsonb; keys text[]; sid uuid; tid uuid; day date; actor uuid;
  owner_staff uuid; zone text;
begin
  if tg_table_name='pos_ticket_items' then
    keys:=array['service_name_snapshot','quantity','unit_price','line_total','is_removed','assigned_staff_id'];
    tid:=(b->>'pos_ticket_id')::uuid;
  elsif tg_table_name='pos_ticket_staff_earnings' then
    keys:=array['service_total','tip_amount','total_earning','big_turn_count','small_turn_count','work_date'];
    tid:=(b->>'ticket_id')::uuid;
  else
    keys:=array['status','customer_id','opened_at','closed_at']; tid:=(b->>'id')::uuid;
  end if;
  select coalesce(jsonb_object_agg(key,value),'{}') into before_data from jsonb_each(b) where key=any(keys);
  select coalesce(jsonb_object_agg(key,value),'{}') into after_data from jsonb_each(a) where key=any(keys);
  if before_data=after_data then return null; end if;
  sid:=(b->>'salon_id')::uuid;
  -- Parent deletion cascades must not be blocked by a new audit record.
  if not exists(select 1 from public.locations where id=sid)
    or not exists(select 1 from public.pos_tickets where id=tid and salon_id=sid) then return null; end if;
  zone:=public.get_salon_business_timezone(sid);
  actor:=public.current_public_user_id();
  for owner_staff in
    select distinct v from (
      select (b->>'assigned_staff_id')::uuid as v where tg_table_name='pos_ticket_items'
      union select (a->>'assigned_staff_id')::uuid where tg_table_name='pos_ticket_items'
      union select (b->>'staff_id')::uuid where tg_table_name='pos_ticket_staff_earnings'
      union select (a->>'staff_id')::uuid where tg_table_name='pos_ticket_staff_earnings'
      union select i.assigned_staff_id from public.pos_ticket_items i where tg_table_name='pos_tickets' and i.pos_ticket_id=tid and i.salon_id=sid
      union select e.staff_id from public.pos_ticket_staff_earnings e where tg_table_name='pos_tickets' and e.ticket_id=tid and e.salon_id=sid
    ) x where v is not null
  loop
    if not exists(select 1 from public.staff where id=owner_staff and salon_id=sid) then continue; end if;
    day:=coalesce((b->>'work_date')::date,
      (select min(e.work_date) from public.pos_ticket_staff_earnings e where e.ticket_id=tid and e.staff_id=owner_staff and e.salon_id=sid),
      (coalesce(b->>'created_at',b->>'opened_at')::timestamptz at time zone zone)::date);
    insert into public.staff_ticket_edit_history(salon_id,staff_id,ticket_id,work_date,source,actor_id,actor_name,before_values,after_values)
      values(sid,owner_staff,tid,day,tg_table_name,actor,(select display_name from public.users where id=actor),before_data,after_data);
  end loop;
  return null;
end $$;
create trigger staff_ticket_item_edits after update or delete on public.pos_ticket_items for each row execute function public.capture_staff_ticket_edit();
create trigger staff_ticket_earning_edits after update or delete on public.pos_ticket_staff_earnings for each row execute function public.capture_staff_ticket_edit();
create trigger staff_ticket_header_edits after update on public.pos_tickets for each row execute function public.capture_staff_ticket_edit();
revoke all on function public.capture_staff_ticket_edit() from public,anon,authenticated;

create function public.get_my_staff_tickets(p_salon_id uuid,p_work_date date) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare own_staff uuid; matches integer; zone text; result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_work_date is null or not isfinite(p_work_date) then raise exception 'Valid work date required'; end if;
  select count(*),min(s.id::text)::uuid into matches,own_staff from public.staff s
    where s.salon_id=p_salon_id and s.is_active and s.account_user_id=public.current_public_user_id();
  if matches=0 then
    select count(*),min(s.id::text)::uuid into matches,own_staff from public.staff s
      where s.salon_id=p_salon_id and s.is_active and s.account_user_id is null and s.user_id=auth.uid();
  end if;
  if matches<>1 then raise exception 'A unique active staff account link is required'; end if;
  zone:=public.get_salon_business_timezone(p_salon_id);
  with scope as (
    select e.ticket_id id from public.pos_ticket_staff_earnings e where e.salon_id=p_salon_id and e.staff_id=own_staff and e.work_date=p_work_date
    union select i.pos_ticket_id from public.pos_ticket_items i where i.salon_id=p_salon_id and i.assigned_staff_id=own_staff
      and i.created_at >= (p_work_date::timestamp at time zone zone) and i.created_at < ((p_work_date+1)::timestamp at time zone zone)
    union select h.ticket_id from public.staff_ticket_edit_history h where h.salon_id=p_salon_id and h.staff_id=own_staff and h.work_date=p_work_date
  )
  select jsonb_build_object('date',p_work_date,'staffId',own_staff,'tickets',coalesce(jsonb_agg(jsonb_build_object(
    'id',t.id,'ticketNumber',t.ticket_number,'openedAt',t.opened_at,'closedAt',t.closed_at,'status',t.status,
    'customerName',c.name,
    'services',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'name',coalesce(nullif(i.service_name_snapshot,''),s.name,'Service'),
      'quantity',i.quantity,'unitPrice',i.unit_price,'price',i.line_total,'removed',i.is_removed) order by i.created_at,i.id)
      from public.pos_ticket_items i left join public.services s on s.id=i.service_id
      where i.salon_id=p_salon_id and i.pos_ticket_id=t.id and i.assigned_staff_id=own_staff),'[]'::jsonb),
    'serviceTotal',coalesce((select sum(e.service_total) from public.pos_ticket_staff_earnings e where e.salon_id=p_salon_id and e.staff_id=own_staff and e.ticket_id=t.id and e.work_date=p_work_date),
      (select sum(i.line_total) from public.pos_ticket_items i where i.salon_id=p_salon_id and i.pos_ticket_id=t.id and i.assigned_staff_id=own_staff and not i.is_removed),0),
    'tip', (select sum(e.tip_amount) from public.pos_ticket_staff_earnings e where e.salon_id=p_salon_id and e.staff_id=own_staff and e.ticket_id=t.id and e.work_date=p_work_date),
    'history',coalesce((select jsonb_agg(jsonb_build_object('id',h.id,'at',h.created_at,'actor',coalesce(h.actor_name,'System'),
      'source',h.source,'before',h.before_values,'after',h.after_values) order by h.created_at desc,h.id)
      from public.staff_ticket_edit_history h where h.salon_id=p_salon_id and h.staff_id=own_staff and h.ticket_id=t.id),'[]'::jsonb),
    -- Legacy logs lack reliable before/after values. Expose event labels only;
    -- freeform notes may contain another staff member's private amounts.
    'activity',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'at',l.created_at,'actor',coalesce(u.display_name,'System'),'action',l.action) order by l.created_at desc,l.id)
      from public.pos_ticket_audit_logs l left join public.users u on u.id=l.created_by where l.salon_id=p_salon_id and l.ticket_id=t.id),'[]'::jsonb)
  ) order by t.opened_at desc,t.id),'[]'::jsonb)) into result
  from scope x join public.pos_tickets t on t.id=x.id and t.salon_id=p_salon_id
    left join public.customers c on c.id=t.customer_id and c.location_id=p_salon_id;
  return result;
end $$;
revoke all on function public.get_my_staff_tickets(uuid,date) from public,anon;
grant execute on function public.get_my_staff_tickets(uuid,date) to authenticated;
