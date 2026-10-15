DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
CREATE TABLE public.locations(id uuid PRIMARY KEY,account_id uuid,name text,status text,created_at timestamptz DEFAULT now());
CREATE TABLE public.salon_settings(salon_id uuid PRIMARY KEY,public_discovery_enabled boolean,public_discovery_published_at timestamptz,operating_timezone_iana text);
CREATE FUNCTION public.normalize_salon_lifecycle_status(value text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT lower(value) $$;
CREATE FUNCTION public.salon_profile_public_salon_exists(value uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
 SELECT EXISTS(SELECT 1 FROM public.locations l JOIN public.salon_settings s ON s.salon_id=l.id WHERE l.id=value AND l.status='active' AND s.public_discovery_enabled)
$$;
CREATE TABLE public.salon_operating_hours(id uuid PRIMARY KEY,salon_id uuid,day_of_week integer,opens_at_local time,closes_at_local time,sort_order integer,is_active boolean);
CREATE INDEX operating_active_idx ON public.salon_operating_hours(salon_id,day_of_week,sort_order) WHERE is_active;
CREATE TABLE public.salon_special_hours(id uuid PRIMARY KEY,salon_id uuid,local_date date,status text,opens_at_local time,closes_at_local time,reason text,is_active boolean);
CREATE INDEX special_active_idx ON public.salon_special_hours(salon_id,local_date) WHERE is_active;
CREATE TABLE public.customers(id uuid PRIMARY KEY,location_id uuid,customer_user_id uuid);
CREATE INDEX customers_location_user_idx ON public.customers(location_id,customer_user_id);
CREATE TABLE public.pos_tickets(id uuid PRIMARY KEY,salon_id uuid,customer_id uuid,status text,closed_at timestamptz);
CREATE INDEX pos_tickets_salon_idx ON public.pos_tickets(salon_id);
CREATE TABLE public.pos_ticket_items(id uuid PRIMARY KEY,pos_ticket_id uuid,salon_id uuid,line_total numeric);
CREATE INDEX pos_ticket_items_ticket_idx ON public.pos_ticket_items(pos_ticket_id);
CREATE TABLE public.salon_memberships(salon_id uuid,user_id uuid,status text,PRIMARY KEY(salon_id,user_id));
CREATE TABLE public.account_memberships(account_id uuid,user_id uuid,status text,PRIMARY KEY(account_id,user_id));
CREATE TABLE public.staff(id uuid PRIMARY KEY,salon_id uuid,account_user_id uuid,user_id uuid);
CREATE TABLE public.customer_visit_experiences(id uuid PRIMARY KEY,ticket_id uuid,salon_id uuid,customer_id uuid,author_user_id uuid,feedback_state text,issue_status text,created_at timestamptz);
CREATE INDEX experiences_ticket_idx ON public.customer_visit_experiences(ticket_id);
CREATE TABLE public.services(id uuid PRIMARY KEY,salon_id uuid,name text,is_active boolean,online_booking_enabled boolean);
CREATE TABLE public.booking_lines(id uuid PRIMARY KEY,service_id uuid,salon_id uuid,booking_id uuid,line_type text,line_status text);
