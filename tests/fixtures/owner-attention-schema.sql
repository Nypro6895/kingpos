-- Dedicated disposable PostgreSQL database only; no production connections.
create table public.locations(id uuid primary key);
create table public.users(id uuid primary key);
create table public.customers(id uuid primary key,location_id uuid,name text);
create table public.pos_tickets(id uuid primary key,salon_id uuid,customer_id uuid,ticket_number text,opened_at timestamptz,updated_at timestamptz default now(),status text,facts jsonb);
create table public.customer_visits(id uuid primary key,salon_id uuid,customer_id uuid,ticket_id uuid,checked_in_at timestamptz,checkout_started_at timestamptz,status text);
create table public.pos_daily_closings(salon_id uuid,report_date date,cash_amount numeric default 0,credit_card_amount numeric default 0,other_amount numeric default 0,tip_input numeric default 0,live_report_entered_at timestamptz,closed_at timestamptz,approved_at timestamptz);
create table public.shop_daily_collections(salon_id uuid,business_date date,cash numeric,card numeric,other numeric,revision integer,updated_at timestamptz,updated_by uuid);
create table public.financial_input_events(id uuid primary key,salon_id uuid,kind text,business_date date,source_id uuid,before_values jsonb,after_values jsonb,note text,actor_name text,created_at timestamptz,event_action text);
create function public.get_salon_business_timezone(uuid) returns text language sql stable as $$select 'America/Chicago'::text$$;
create function public.get_salon_business_date(uuid) returns date language sql stable as $$select '2026-11-01'::date$$;
create function public.current_public_user_id() returns uuid language sql stable as $$select nullif(current_setting('test.user_id',true),'')::uuid$$;
create function public.lifecycle_user_is_salon_owner(uuid,uuid,boolean) returns boolean language sql stable as $$select $1='10000000-0000-4000-8000-000000000001'::uuid and $2 in ('20000000-0000-4000-8000-000000000001'::uuid,'20000000-0000-4000-8000-000000000002'::uuid)$$;
create function public.pos_ticket_input_snapshot(uuid,uuid) returns jsonb language sql stable as $$select facts from public.pos_tickets where salon_id=$1 and id=$2$$;
create function public.classify_financial_input_event(uuid,text,uuid,jsonb,jsonb,timestamptz,uuid) returns text language sql stable as $$select case when $4='{}'::jsonb then 'created' else 'updated' end$$;
create function public.financial_notice_money(jsonb) returns text language sql immutable as $$select '$'||coalesce($1#>>'{}','—')$$;
