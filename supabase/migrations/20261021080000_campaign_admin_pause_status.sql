BEGIN;
-- View stars were expanded when the original admin view was created. Append
-- only the pause fields; retain every existing column, expression and ACL.
DO $migration$
DECLARE
 definition text;
 columns_before text[];
 columns_after text[];
 pause_columns constant text[] := ARRAY['owner_paused_at','pause_episode_id','pause_origin'];
 present integer;
 acl_before aclitem[];
 owner_before oid;
 options_before text[];
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.admin_campaign_list'::regclass AND relkind='v') THEN
  RAISE EXCEPTION 'Campaign admin pause status: expected an existing view';
 END IF;
 SELECT array_agg(attname::text ORDER BY attnum),count(*) FILTER(WHERE attname=ANY(pause_columns))
 INTO columns_before,present FROM pg_attribute
 WHERE attrelid='public.admin_campaign_list'::regclass AND attnum>0 AND NOT attisdropped;
 definition := rtrim(pg_get_viewdef('public.admin_campaign_list'::regclass,true),E'; \n\r\t');
 IF present=3 AND columns_before[cardinality(columns_before)-2:cardinality(columns_before)]=pause_columns
  AND strpos(definition,'campaign_pause.owner_paused_at')>0
  AND strpos(definition,'campaign_pause.pause_episode_id')>0
  AND strpos(definition,'campaign_pause.pause_origin')>0 THEN
  RETURN; -- Retry of this exact additive view migration.
 END IF;
 IF present<>0 OR NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.admin_campaign_list'::regclass
  AND attname='id' AND atttypid='uuid'::regtype AND attnum>0 AND NOT attisdropped) THEN
  RAISE EXCEPTION 'Campaign admin pause status: unsupported existing projection';
 END IF;
 SELECT relacl,relowner,reloptions INTO acl_before,owner_before,options_before
 FROM pg_class WHERE oid='public.admin_campaign_list'::regclass;
 -- The preserved subquery supplies the exact prior column order (including
 -- salon_name). A left join on the campaign PK cannot remove or multiply rows.
 EXECUTE 'CREATE OR REPLACE VIEW public.admin_campaign_list AS SELECT existing_campaigns.*,
  campaign_pause.owner_paused_at,campaign_pause.pause_episode_id,campaign_pause.pause_origin
  FROM ('||definition||') existing_campaigns
  LEFT JOIN public.owner_campaigns campaign_pause ON campaign_pause.id=existing_campaigns.id';
 SELECT array_agg(attname::text ORDER BY attnum) INTO columns_after FROM pg_attribute
 WHERE attrelid='public.admin_campaign_list'::regclass AND attnum>0 AND NOT attisdropped;
 IF columns_after IS DISTINCT FROM columns_before||pause_columns
  OR EXISTS(SELECT 1 FROM pg_class WHERE oid='public.admin_campaign_list'::regclass
   AND (relacl IS DISTINCT FROM acl_before OR relowner<>owner_before OR reloptions IS DISTINCT FROM options_before)) THEN
  RAISE EXCEPTION 'Campaign admin pause status: projection or access changed';
 END IF;
END
$migration$;
NOTIFY pgrst,'reload schema';
COMMIT;
