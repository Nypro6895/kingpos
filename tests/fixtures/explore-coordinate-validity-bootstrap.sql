CREATE SCHEMA extensions;
CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
CREATE TABLE accounts(id uuid PRIMARY KEY,status text);
CREATE TABLE locations(id uuid PRIMARY KEY,account_id uuid REFERENCES accounts(id),name text,phone text,
 address_line1 text,address_line2 text,city text,state text,postal_code text,country text,status text,
 latitude float8,longitude float8,geocoded_at timestamptz,geocoding_address_fingerprint text,geocoding_error_code text,
 geocoding_place_id text,geocoding_provider text,geocoding_status text,created_at timestamptz DEFAULT now()-interval '1 day',updated_at timestamptz DEFAULT now());
CREATE TABLE salon_settings(salon_id uuid PRIMARY KEY REFERENCES locations(id) ON DELETE CASCADE,
 public_discovery_enabled boolean,public_discovery_published_at timestamptz,business_name text,phone text,
 address_line1 text,address_line2 text,city text,state text,postal_code text,country text,business_description text,public_profile_cover_path text);
CREATE TABLE salon_directory_listings(salon_id uuid PRIMARY KEY REFERENCES locations(id) ON DELETE CASCADE,
 listing_id text UNIQUE,claim_state text,source_categories text[] DEFAULT '{Nails}');
CREATE TABLE salon_directory_suppressions(listing_id text PRIMARY KEY,identity_key text,reason text);
CREATE INDEX suppression_identity_idx ON salon_directory_suppressions(identity_key);
CREATE FUNCTION directory_import_identity(text,text,text,text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT upper(btrim(coalesce($1,'')))||'|'||lower(btrim(coalesce($2,'')))||'|'||regexp_replace(coalesce($3,''),'[^0-9]','','g')||'|'||lower(btrim(coalesce($4,''))) $$;
CREATE TABLE users(id uuid PRIMARY KEY);
CREATE FUNCTION current_public_user_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.viewer',true),'')::uuid $$;
CREATE FUNCTION user_has_salon_permission(uuid,text[]) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT current_public_user_id()='30000000-0000-0000-0000-000000000001'::uuid $$;
CREATE FUNCTION normalize_search_text(value text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT nullif(btrim(regexp_replace(lower(coalesce(value,'')),'[^a-z0-9]+',' ','g')),'') $$;
CREATE FUNCTION explore_preferred_categories() RETURNS text[] LANGUAGE sql STABLE AS $$ SELECT '{}'::text[] $$;
CREATE TABLE services(id uuid PRIMARY KEY,salon_id uuid,name text,description text,category text,base_price numeric,is_active boolean,online_booking_enabled boolean);
CREATE TABLE booking_settings(salon_id uuid PRIMARY KEY,booking_enabled boolean,online_booking_visible boolean,guest_booking_enabled boolean);
CREATE TABLE salon_profile_media_assets(id uuid PRIMARY KEY,salon_id uuid,object_path text,purpose text,status text,deleted_at timestamptz,created_at timestamptz);
CREATE TABLE salon_profile_updates(id uuid PRIMARY KEY,salon_id uuid,status text,media_path text,published_at timestamptz);
CREATE TABLE salon_profile_looks(id uuid PRIMARY KEY,salon_id uuid,status text,media_path text,published_at timestamptz);
INSERT INTO accounts VALUES('10000000-0000-0000-0000-000000000001','active');
INSERT INTO locations(id,account_id,name,phone,address_line1,city,state,postal_code,country,status)
 SELECT ('20000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'10000000-0000-0000-0000-000000000001','Nail Salon '||n,
 '2620000000','420 6th St Suite 3','Racine','WI','53403','US','active' FROM generate_series(1,300)n;
INSERT INTO salon_settings(salon_id,public_discovery_enabled) SELECT id,true FROM locations;
INSERT INTO salon_directory_listings(salon_id,listing_id,claim_state) SELECT id,'listing-'||id,'unclaimed' FROM locations;
