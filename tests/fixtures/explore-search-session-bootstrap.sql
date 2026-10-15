-- Isolated database only: reduced source schema for the real session migration.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE EXTENSION pg_trgm WITH SCHEMA extensions;
CREATE TABLE public.users(id uuid PRIMARY KEY);
CREATE TABLE public.booking_settings(salon_id uuid PRIMARY KEY,booking_enabled boolean NOT NULL DEFAULT false,online_booking_visible boolean NOT NULL DEFAULT false,guest_booking_enabled boolean DEFAULT true);
CREATE TABLE public.explore_salon_documents (
 salon_id uuid PRIMARY KEY,salon_name text,phone text,address_line1 text,address_line2 text,
 city text,state text,postal_code text,country text,latitude double precision,longitude double precision,
 description text,public_discovery_published_at timestamptz,profile_completeness integer NOT NULL DEFAULT 0,
 active_service_count bigint,service_categories text[],service_names text[],created_at timestamptz NOT NULL,
 updated_at timestamptz,cover_image_path text,latest_media_created_at timestamptz,featured_service_category text,
 featured_service_name text,has_public_profile boolean,starting_price numeric,salon_name_search text,
 description_search text,search_document text,location_search_text text,service_search_text text,
 service_category_search_text text,state_code text,city_search text
);
CREATE INDEX explore_document_search_idx ON public.explore_salon_documents USING gin(search_document extensions.gin_trgm_ops);
CREATE INDEX explore_document_name_idx ON public.explore_salon_documents USING gin(salon_name_search extensions.gin_trgm_ops);
CREATE INDEX explore_document_state_idx ON public.explore_salon_documents(state_code,profile_completeness DESC,salon_id);
CREATE INDEX explore_document_cursor_browse_idx ON public.explore_salon_documents(profile_completeness DESC,salon_id);
CREATE FUNCTION public.normalize_search_text(value text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT nullif(btrim(regexp_replace(lower(coalesce(value,'')),'[^a-z0-9]+',' ','g')),'')
$$;
CREATE FUNCTION public.current_public_user_id() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('test.viewer',true),'')::uuid
$$;
CREATE FUNCTION public.explore_preferred_categories() RETURNS text[] LANGUAGE sql STABLE AS $$ SELECT '{}'::text[] $$;
