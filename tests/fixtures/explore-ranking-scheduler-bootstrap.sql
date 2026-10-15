-- Isolated scheduler contract only. No real network, Vault or cron action occurs.
DO $$ DECLARE role_name text;BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('CREATE ROLE %I',role_name);END IF;
 END LOOP;
END $$;
CREATE SCHEMA vault;
CREATE SCHEMA net;
CREATE SCHEMA cron;
CREATE TABLE public.explore_search_rank_jobs(salon_id uuid PRIMARY KEY,next_attempt_at timestamptz NOT NULL DEFAULT now(),lease uuid,leased_at timestamptz);
CREATE TABLE public.explore_search_rank_sources(salon_id uuid PRIMARY KEY,ready boolean NOT NULL DEFAULT false,refresh_after timestamptz);
CREATE TABLE vault.secrets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text UNIQUE NOT NULL,secret text NOT NULL);
CREATE VIEW vault.decrypted_secrets AS SELECT id,name,secret AS decrypted_secret FROM vault.secrets;
CREATE TABLE net.requests(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,url text,headers jsonb,body jsonb,timeout_milliseconds integer);
CREATE FUNCTION net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE request_id bigint;BEGIN
 INSERT INTO net.requests(url,headers,body,timeout_milliseconds) VALUES(url,headers,body,timeout_milliseconds) RETURNING id INTO request_id;
 RETURN request_id;
END $$;
CREATE FUNCTION vault.create_secret(secret text,name text,description text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE secret_id uuid;BEGIN INSERT INTO vault.secrets(name,secret) VALUES(name,secret) RETURNING id INTO secret_id;RETURN secret_id;END $$;
CREATE FUNCTION vault.update_secret(secret_id uuid,secret text,name text,description text) RETURNS void LANGUAGE sql AS $$
 UPDATE vault.secrets SET secret=$2,name=$3 WHERE id=$1;
$$;
CREATE FUNCTION cron.schedule(job_name text,schedule text,command text) RETURNS bigint LANGUAGE sql AS $$ SELECT 129::bigint $$;
