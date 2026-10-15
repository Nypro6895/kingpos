-- Dedicated localhost database only. Minimal real source shapes for feed tests.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS cube WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS earthdistance WITH SCHEMA extensions;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE public.users(id uuid PRIMARY KEY,status text NOT NULL DEFAULT 'active',display_name text,first_name text,last_name text,avatar_url text);
CREATE TABLE public.locations(id uuid PRIMARY KEY,name text);
CREATE TABLE public.salon_settings(salon_id uuid PRIMARY KEY,public_profile_logo_path text);
CREATE TABLE public.salon_directory_listings(salon_id uuid PRIMARY KEY);
CREATE TABLE public.booking_settings(salon_id uuid PRIMARY KEY,booking_enabled boolean NOT NULL DEFAULT false,online_booking_visible boolean NOT NULL DEFAULT false,guest_booking_enabled boolean DEFAULT true);
CREATE TABLE public.services(id uuid PRIMARY KEY,salon_id uuid,name text,category text,base_price numeric,duration_minutes integer,is_active boolean DEFAULT true,online_booking_enabled boolean DEFAULT true);
CREATE INDEX services_salon_id_idx ON services(salon_id);
CREATE INDEX explore_active_services_idx ON services(salon_id,name) WHERE is_active;
CREATE TABLE public.staff(id uuid PRIMARY KEY,display_name text);
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
CREATE INDEX explore_doc_state_cursor_idx ON explore_salon_documents(state_code,salon_id);
CREATE INDEX explore_doc_city_cursor_idx ON explore_salon_documents(city_search,state_code,salon_id);
CREATE INDEX explore_doc_earth_idx ON explore_salon_documents USING gist(extensions.ll_to_earth(latitude,longitude)) WHERE latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180;
CREATE FUNCTION public.normalize_search_text(value text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT nullif(btrim(regexp_replace(lower(coalesce(value,'')),'[^a-z0-9]+',' ','g')),'') $$;
CREATE TABLE public.salon_profile_looks(id uuid PRIMARY KEY,salon_id uuid REFERENCES locations(id) ON DELETE CASCADE,author_user_id uuid,author_display_name text,author_staff_id uuid,author_presentation_role text DEFAULT 'salon',title text,caption text,service_id uuid,duration_minutes integer,starting_price numeric,media_path text,status text,published_at timestamptz,safety_hold boolean NOT NULL DEFAULT false);
CREATE INDEX looks_salon_idx ON salon_profile_looks(salon_id);
CREATE TABLE public.salon_profile_updates(id uuid PRIMARY KEY,salon_id uuid REFERENCES locations(id) ON DELETE CASCADE,author_user_id uuid,author_display_name text,author_staff_id uuid,author_presentation_role text DEFAULT 'salon',title text,caption text,summary text,service_id uuid,media_path text,status text,published_at timestamptz,safety_hold boolean NOT NULL DEFAULT false);
CREATE INDEX updates_salon_idx ON salon_profile_updates(salon_id);
CREATE TABLE public.salon_profile_media_assets(id uuid PRIMARY KEY,salon_id uuid,object_path text,status text,deleted_at timestamptz,width integer,height integer);
CREATE INDEX media_path_idx ON salon_profile_media_assets(salon_id,object_path);
CREATE TABLE public.salon_profile_content_booking_configs(id uuid PRIMARY KEY,salon_id uuid,source_type text,look_id uuid,update_id uuid,primary_service_id uuid,credited_staff_id uuid,booking_cta_enabled boolean,booking_note text,cta_label text,updated_at timestamptz DEFAULT now());
CREATE TABLE public.beauty_profiles(id uuid PRIMARY KEY,user_id uuid,visibility text);
CREATE TABLE public.beauty_posts(id uuid PRIMARY KEY,profile_id uuid REFERENCES beauty_profiles(id),author_user_id uuid,created_at timestamptz,caption text,post_type text,visibility text,moderation_status text,deleted_at timestamptz,safety_hold boolean NOT NULL DEFAULT false);
CREATE INDEX beauty_author_idx ON beauty_posts(author_user_id,created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX beauty_profile_idx ON beauty_posts(profile_id,created_at DESC,id) WHERE deleted_at IS NULL;
CREATE TABLE public.beauty_post_media(id uuid PRIMARY KEY,post_id uuid REFERENCES beauty_posts(id) ON DELETE CASCADE,object_path text,bucket text,role text,width integer,height integer,display_order integer,created_at timestamptz);
CREATE INDEX beauty_media_post_idx ON beauty_post_media(post_id);
CREATE TABLE public.beauty_post_attributions(post_id uuid PRIMARY KEY REFERENCES beauty_posts(id) ON DELETE CASCADE,salon_id uuid,staff_id uuid);
CREATE TABLE public.beauty_post_verifications(post_id uuid PRIMARY KEY REFERENCES beauty_posts(id) ON DELETE CASCADE,state text);
CREATE TABLE public.salon_profile_look_saves(look_id uuid,user_id uuid,created_at timestamptz);
CREATE INDEX saves_selected_idx ON salon_profile_look_saves(user_id,look_id);
CREATE TABLE public.account_post_saves(user_id uuid,source_type text,source_id uuid,created_at timestamptz);
CREATE INDEX account_saves_selected_idx ON account_post_saves(user_id,source_type,source_id);
CREATE TABLE public.salon_profile_comments(id uuid,look_id uuid,update_id uuid,beauty_post_id uuid,author_user_id uuid,status text,created_at timestamptz);
CREATE INDEX comments_look_idx ON salon_profile_comments(look_id,created_at DESC,id) WHERE look_id IS NOT NULL AND status IN ('published','visible');
CREATE INDEX comments_update_idx ON salon_profile_comments(update_id,created_at DESC,id) WHERE update_id IS NOT NULL AND status IN ('published','visible');
CREATE INDEX comments_beauty_idx ON salon_profile_comments(beauty_post_id,created_at DESC,id) WHERE beauty_post_id IS NOT NULL AND status IN ('published','visible');
CREATE TABLE public.bookings(id uuid,source_reference_type text,source_reference_id uuid,customer_user_id uuid,confirmation_status text,status text,created_at timestamptz);
CREATE INDEX bookings_beauty_post_reference_count_idx ON bookings(source_reference_id) WHERE source_reference_type='beauty_post' AND source_reference_id IS NOT NULL;
CREATE TABLE public.booking_inspirations(booking_id uuid,source_type text,source_content_id uuid,created_at timestamptz);
CREATE TABLE public.explore_user_preferences(user_id uuid,categories text[]);
CREATE UNIQUE INDEX prefs_user_idx ON explore_user_preferences(user_id);
CREATE TABLE public.salon_profile_follows(user_id uuid,salon_id uuid,created_at timestamptz);
CREATE INDEX follows_user_idx ON salon_profile_follows(user_id,created_at DESC);
CREATE TABLE public.beauty_profile_follows(user_id uuid,profile_id uuid,created_at timestamptz);
CREATE INDEX beauty_follows_user_idx ON beauty_profile_follows(user_id,created_at DESC);
