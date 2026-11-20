-- Use the existing public introduction ID; never create fake owner posts or new dates.
-- Preserve actor/session checks and hydrate only the selected (at most 20) UUIDs.
BEGIN;
CREATE OR REPLACE FUNCTION public.hydrate_explore_social_feed_items(p_actor_key text, p_cursor jsonb, p_keys text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE allowed text[]; actor_user_id uuid; result jsonb;
BEGIN
 IF coalesce(cardinality(p_keys),0)>20 THEN RAISE EXCEPTION 'Too many selected items'; END IF;
 allowed:=public.validate_explore_social_feed_items(p_actor_key,p_cursor,p_keys);
 IF left(p_actor_key,5)='user:' THEN actor_user_id:=substring(p_actor_key FROM 6)::uuid; END IF;
 WITH selected AS (
  SELECT x.key,x.ordinality,d.source_type,d.content_id,d.salon_id,d.profile_id,d.published_at,d.bookable
  FROM unnest(allowed) WITH ORDINALITY x(key,ordinality)
  LEFT JOIN explore_social_content_documents d ON d.content_key=x.key
 ), posts AS (
  SELECT s.*,jsonb_build_object('id',p.id,'title',p.title,'caption',left(p.caption,500),'authorName',p.author_display_name,
   'authorRole',CASE WHEN p.author_presentation_role='staff' AND EXISTS(SELECT 1 FROM users u WHERE u.id=p.author_user_id AND u.status='deleted') THEN 'salon' ELSE p.author_presentation_role END,
   'authorStaffId',p.author_staff_id,'serviceName',service.name,'serviceCategory',service.category,'postType','regular') AS post,
   jsonb_build_array(jsonb_build_object('id',coalesce(m.id,p.id),'objectPath',p.media_path,'bucket','salon-profile-media','role','image','width',m.width,'height',m.height)) AS media,
   p.service_id,p.duration_minutes,p.starting_price
  FROM selected s JOIN salon_profile_looks p ON s.source_type='salon_profile_look' AND p.id=s.content_id
  LEFT JOIN services service ON service.id=p.service_id AND service.salon_id=p.salon_id
  LEFT JOIN salon_profile_media_assets m ON m.salon_id=p.salon_id AND m.object_path=p.media_path AND m.status='active' AND m.deleted_at IS NULL
  UNION ALL
  SELECT s.*,jsonb_build_object('id',p.id,'title',p.title,'caption',left(coalesce(p.caption,p.summary),500),'authorName',p.author_display_name,
   'authorRole',CASE WHEN p.author_presentation_role='staff' AND EXISTS(SELECT 1 FROM users u WHERE u.id=p.author_user_id AND u.status='deleted') THEN 'salon' ELSE p.author_presentation_role END,
   'authorStaffId',p.author_staff_id,'serviceName',service.name,'serviceCategory',service.category,'postType','regular'),
   jsonb_build_array(jsonb_build_object('id',coalesce(m.id,p.id),'objectPath',p.media_path,'bucket','salon-profile-media','role','image','width',m.width,'height',m.height)),
   p.service_id,NULL::integer,NULL::numeric
  FROM selected s JOIN salon_profile_updates p ON s.source_type='salon_profile_update' AND p.id=s.content_id
  LEFT JOIN services service ON service.id=p.service_id AND service.salon_id=p.salon_id
  LEFT JOIN salon_profile_media_assets m ON m.salon_id=p.salon_id AND m.object_path=p.media_path AND m.status='active' AND m.deleted_at IS NULL
  UNION ALL
  SELECT s.*,jsonb_build_object('id',p.id,'caption',left(p.caption,500),'postType',p.post_type,
   'authorName',coalesce(nullif(btrim(u.display_name),''),nullif(btrim(concat_ws(' ',u.first_name,u.last_name)),''),'Reylumi customer'),
   'avatarUrl',u.avatar_url,'verificationState',v.state),
   coalesce((SELECT jsonb_agg(jsonb_build_object('id',m.id,'objectPath',m.object_path,'bucket',m.bucket,'role',m.role,'width',m.width,'height',m.height) ORDER BY m.display_order,m.created_at,m.id) FROM beauty_post_media m WHERE m.post_id=p.id),'[]'),
   NULL::uuid,NULL::integer,NULL::numeric
  FROM selected s JOIN beauty_posts p ON s.source_type='beauty_post' AND p.id=s.content_id
  JOIN users u ON u.id=p.author_user_id
  LEFT JOIN beauty_post_verifications v ON v.post_id=p.id
 ), rows AS (
  SELECT p.key,p.ordinality,p.source_type,p.content_id,p.salon_id,p.profile_id,p.published_at,
   jsonb_build_object('candidate',(SELECT e FROM explore_social_feed_sessions fs,jsonb_array_elements(fs.queue) e WHERE fs.id=(p_cursor->>'session')::uuid AND fs.actor_key=p_actor_key AND e->>'contentKey'=p.key LIMIT 1),
    'contentKey',p.key,'sourceType',p.source_type,'contentId',p.content_id,'profileId',p.profile_id,'publishedAt',p.published_at,
    'document',to_jsonb(d),'logoImagePath',settings.public_profile_logo_path,'post',p.post,'media',p.media,
    'booking',CASE WHEN p.source_type='beauty_post' THEN NULL ELSE jsonb_build_object(
      'content_id',p.content_id,'source_type',p.source_type,'content_type',CASE WHEN p.source_type='salon_profile_update' THEN 'update' ELSE 'look' END,
      'salon_id',p.salon_id,'title',p.post->>'title','caption',p.post->>'caption','media_path',p.media->0->>'objectPath','media_bucket','salon-profile-media',
      'credited_staff_id',cfg.credited_staff_id,'credited_staff_name',credited.display_name,
      'booking_cta_enabled',CASE WHEN cfg.id IS NULL THEN p.bookable ELSE cfg.booking_cta_enabled END,'booking_enabled',p.bookable,
      'booking_href',CASE WHEN p.bookable THEN '/book/'||p.salon_id||'?inspiration='||p.content_id||'&source=public_profile' ELSE NULL END,
      'booking_note',cfg.booking_note,'cta_label',coalesce(cfg.cta_label,'Book this look'),
      'readiness_state',CASE WHEN coalesce(cfg.primary_service_id,p.service_id) IS NULL THEN 'inspiration_only' ELSE 'service_ready' END,
      'readiness_message','Choose services and a professional.','primary_service_id',primary_service.id,
      'primary_service_name',primary_service.name,'primary_service_base_price',coalesce(primary_service.base_price,p.starting_price),
      'primary_service_duration_minutes',coalesce(primary_service.duration_minutes,p.duration_minutes),'add_ons','[]'::jsonb,'additional_services','[]'::jsonb) END,
    'bookable',p.bookable,
    'commentCount',(SELECT count(*) FROM salon_profile_comments c WHERE c.status='published' AND ((p.source_type='salon_profile_look' AND c.look_id=p.content_id) OR (p.source_type='salon_profile_update' AND c.update_id=p.content_id) OR (p.source_type='beauty_post' AND c.beauty_post_id=p.content_id))),
    'saved',actor_user_id IS NOT NULL AND (EXISTS(SELECT 1 FROM account_post_saves a WHERE a.user_id=actor_user_id AND a.source_type=p.source_type AND a.source_id=p.content_id) OR (p.source_type='salon_profile_look' AND EXISTS(SELECT 1 FROM salon_profile_look_saves a WHERE a.user_id=actor_user_id AND a.look_id=p.content_id))),
    'bookingCount',CASE WHEN p.source_type='beauty_post' AND p.post->>'verificationState'='verified' THEN (SELECT count(*) FROM bookings b WHERE b.source_reference_type='beauty_post' AND b.source_reference_id=p.content_id AND b.confirmation_status='confirmed' AND b.status IN ('confirmed','checked_in','in_service','completed')) ELSE 0 END) AS value
  FROM posts p LEFT JOIN explore_salon_documents d ON d.salon_id=p.salon_id
  LEFT JOIN salon_settings settings ON settings.salon_id=d.salon_id
  LEFT JOIN LATERAL(SELECT config.* FROM salon_profile_content_booking_configs config WHERE (config.look_id=p.content_id AND p.source_type='salon_profile_look') OR (config.update_id=p.content_id AND p.source_type='salon_profile_update') ORDER BY config.updated_at DESC,config.id DESC LIMIT 1) cfg ON true
  LEFT JOIN services primary_service ON primary_service.id=CASE WHEN cfg.id IS NULL THEN p.service_id ELSE cfg.primary_service_id END AND primary_service.salon_id=p.salon_id
  LEFT JOIN staff credited ON credited.id=cfg.credited_staff_id
  UNION ALL
  SELECT s.key,s.ordinality,'directory',d.salon_id,d.salon_id,NULL::uuid,NULL::timestamptz,
   jsonb_build_object('candidate',(SELECT e FROM explore_social_feed_sessions fs,jsonb_array_elements(fs.queue) e WHERE fs.id=(p_cursor->>'session')::uuid AND fs.actor_key=p_actor_key AND e->>'contentKey'=s.key LIMIT 1),
    'contentKey',s.key,'sourceType','directory','contentId',d.salon_id,'document',to_jsonb(d),'logoImagePath',settings.public_profile_logo_path,
    'referencePost',CASE WHEN intro.id IS NOT NULL THEN jsonb_build_object('id',intro.id,'caption',left(coalesce(intro.caption,intro.summary,intro.title),500),'publishedAt',intro.published_at,
      'commentCount',(SELECT count(*) FROM salon_profile_comments c WHERE c.update_id=intro.id AND c.status='published'),
      'saved',actor_user_id IS NOT NULL AND EXISTS(SELECT 1 FROM account_post_saves a WHERE a.user_id=actor_user_id AND a.source_type='salon_profile_update' AND a.source_id=intro.id)) END)
  FROM selected s JOIN explore_salon_documents d ON d.salon_id=CASE WHEN s.key ~ '^directory:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN substring(s.key FROM 11)::uuid END
  LEFT JOIN salon_settings settings ON settings.salon_id=d.salon_id
  LEFT JOIN salon_directory_listings listing ON listing.salon_id=d.salon_id
  LEFT JOIN salon_profile_updates intro ON intro.id=listing.reference_post_id AND intro.salon_id=d.salon_id
    AND intro.status='published' AND NOT intro.safety_hold AND intro.published_at<=now()
 ) SELECT coalesce(jsonb_agg(value ORDER BY ordinality),'[]') INTO result FROM rows;
 RETURN result;
END $function$
;
NOTIFY pgrst,'reload schema';
COMMIT;
