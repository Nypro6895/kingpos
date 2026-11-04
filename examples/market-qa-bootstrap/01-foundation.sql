-- Minimal synthetic Market RPC contract fixture, NOT the full KingPOS schema.
-- Auth identity is resolved through provider auth.uid(), never a posted actor ID.
CREATE SCHEMA qa_bootstrap;
REVOKE ALL ON SCHEMA qa_bootstrap FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE qa_bootstrap.marker(id boolean PRIMARY KEY CHECK(id),scope text NOT NULL CHECK(scope='synthetic-market-contract-only'));
INSERT INTO qa_bootstrap.marker VALUES(true,'synthetic-market-contract-only');
CREATE TABLE public.users(id uuid PRIMARY KEY,auth_user_id uuid UNIQUE REFERENCES auth.users(id),email text NOT NULL,display_name text NOT NULL,status text NOT NULL CHECK(status IN('active','suspended','deleted')));
CREATE TABLE public.accounts(id uuid PRIMARY KEY,name text NOT NULL,status text NOT NULL DEFAULT 'active');
CREATE TABLE public.roles(id uuid PRIMARY KEY,account_id uuid NOT NULL REFERENCES public.accounts(id),code text NOT NULL CHECK(code IN('OWNER','STAFF')));
CREATE TABLE public.account_memberships(account_id uuid NOT NULL REFERENCES public.accounts(id),user_id uuid NOT NULL REFERENCES public.users(id),role_id uuid NOT NULL REFERENCES public.roles(id),status text NOT NULL,PRIMARY KEY(account_id,user_id));
CREATE TABLE public.locations(id uuid PRIMARY KEY,account_id uuid NOT NULL REFERENCES public.accounts(id),name text NOT NULL,status text NOT NULL DEFAULT 'active');
CREATE TABLE public.salon_profile_media_assets(id uuid PRIMARY KEY,salon_id uuid NOT NULL REFERENCES public.locations(id),bucket text,object_path text,purpose text,mime_type text,processed_bytes bigint,status text,deleted_at timestamptz,quarantined_at timestamptz);
CREATE SCHEMA market_private;
REVOKE ALL ON SCHEMA market_private FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE market_private.reviewers(user_id uuid PRIMARY KEY REFERENCES public.users(id),active boolean NOT NULL DEFAULT true);
CREATE TABLE qa_bootstrap.financial_admins(user_id uuid PRIMARY KEY REFERENCES public.users(id));
-- Empty by default: fixture users are not made financial administrators.
CREATE FUNCTION public.current_public_user_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$SELECT id FROM public.users WHERE auth_user_id=auth.uid() LIMIT 1$$;
CREATE FUNCTION public.lifecycle_user_is_salon_owner(s uuid,u uuid,include_suspended boolean) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.locations l JOIN public.accounts a ON a.id=l.account_id AND a.status='active'
 JOIN public.account_memberships m ON m.account_id=a.id AND m.user_id=u AND m.status='active'
 JOIN public.roles r ON r.id=m.role_id AND r.account_id=a.id AND r.code='OWNER'
 JOIN public.users usr ON usr.id=m.user_id AND usr.status='active' WHERE l.id=s AND l.status='active')
$$;
CREATE FUNCTION public.market_billing_require_admin() RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,qa_bootstrap AS $$
DECLARE actor uuid:=public.current_public_user_id();
BEGIN IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM qa_bootstrap.financial_admins WHERE user_id=actor) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Separate financial administrator approval required';END IF;RETURN actor;END $$;
REVOKE ALL ON FUNCTION public.current_public_user_id(),public.lifecycle_user_is_salon_owner(uuid,uuid,boolean),public.market_billing_require_admin() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.current_public_user_id(),public.lifecycle_user_is_salon_owner(uuid,uuid,boolean) TO authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC,anon,authenticated,service_role;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
GRANT SELECT(id,auth_user_id,email,display_name,status) ON public.users TO authenticated;
CREATE POLICY qa_users_read_self ON public.users FOR SELECT TO authenticated USING(auth_user_id=auth.uid());
