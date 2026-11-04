create table public.abuse_system_settings (
 id boolean primary key default true check(id), signing_key text,
 require_signed_context boolean not null default false,
 enforce_signup_tickets boolean not null default false,
 email_delivery_ready boolean not null default false,
 policy jsonb not null default '{"new_account_days":7,"post_new_hour":3,"post_hour":10,"post_new_day":10,"post_day":50,"comment_new_window":10,"comment_window":30,"comment_new_day":40,"comment_day":200,"report_hour":10,"signup_device_hour":3,"signup_ip_hour":20}'
);
create table public.abuse_counters (
 scope text not null, identifier text not null, action text not null, window_start timestamptz not null,
 count integer not null default 1, expires_at timestamptz not null,
 primary key(scope,identifier,action,window_start)
);
create table public.abuse_restrictions (
 id uuid primary key default gen_random_uuid(), scope text not null check(scope in ('account','device','ip','country')),
 identifier text not null, mode text not null check(mode in ('warn','challenge','cooldown','review','deny')),
 reason text not null check(length(btrim(reason)) between 3 and 1000), source text not null default 'admin',
 created_by uuid references public.users(id), created_at timestamptz not null default now(),
 expires_at timestamptz not null, revoked_at timestamptz, revoked_by uuid references public.users(id)
);
create table public.abuse_events (
 id uuid primary key default gen_random_uuid(), user_id uuid references public.users(id) on delete set null,
 device_hash text, ip_hash text, country text, action text not null, reason text not null,
 severity text not null default 'warning', source_type text, source_id uuid,
 details jsonb not null default '{}', created_at timestamptz not null default now()
);
create table public.abuse_verification_passes (
 device_hash text primary key, ip_hash text, expires_at timestamptz not null
);
-- Canonical initial settings only: no signing key/configuration or signup trigger.
INSERT INTO public.abuse_system_settings(id) VALUES(true);
ALTER TABLE public.abuse_system_settings ENABLE ROW LEVEL SECURITY;REVOKE ALL ON public.abuse_system_settings FROM PUBLIC,anon,authenticated,service_role,qr_menu_qa_runtime;
ALTER TABLE public.abuse_counters ENABLE ROW LEVEL SECURITY;REVOKE ALL ON public.abuse_counters FROM PUBLIC,anon,authenticated,service_role,qr_menu_qa_runtime;
ALTER TABLE public.abuse_restrictions ENABLE ROW LEVEL SECURITY;REVOKE ALL ON public.abuse_restrictions FROM PUBLIC,anon,authenticated,service_role,qr_menu_qa_runtime;
ALTER TABLE public.abuse_events ENABLE ROW LEVEL SECURITY;REVOKE ALL ON public.abuse_events FROM PUBLIC,anon,authenticated,service_role,qr_menu_qa_runtime;
ALTER TABLE public.abuse_verification_passes ENABLE ROW LEVEL SECURITY;REVOKE ALL ON public.abuse_verification_passes FROM PUBLIC,anon,authenticated,service_role,qr_menu_qa_runtime;
