-- Reference favorites belong to the mapped public user, not the auth UUID.
BEGIN;
CREATE FUNCTION public.get_my_explore_reference_favorites(p_before_created_at timestamptz DEFAULT NULL,p_before_item_key text DEFAULT NULL,p_limit integer DEFAULT 20)
RETURNS TABLE(item_key text,created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public SET plan_cache_mode=force_custom_plan SET jit=off AS $$
DECLARE actor uuid:=public.current_public_user_id(); page_size integer:=least(20,greatest(1,coalesce(p_limit,20)))+1;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Sign in to view favorites' USING ERRCODE='28000'; END IF;
 IF p_before_created_at IS NULL THEN
  RETURN QUERY SELECT f.item_key,f.created_at FROM explore_reference_favorites f WHERE f.user_id=actor ORDER BY f.created_at DESC,f.item_key DESC LIMIT page_size;
 ELSE
  IF p_before_item_key IS NULL OR length(p_before_item_key) NOT BETWEEN 1 AND 180 THEN RAISE EXCEPTION 'Invalid favorites cursor' USING ERRCODE='22023'; END IF;
  RETURN QUERY SELECT f.item_key,f.created_at FROM explore_reference_favorites f
   WHERE f.user_id=actor AND ROW(f.created_at,f.item_key)<ROW(p_before_created_at,p_before_item_key)
   ORDER BY f.created_at DESC,f.item_key DESC LIMIT page_size;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.get_my_explore_reference_favorites(timestamptz,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_explore_reference_favorites(timestamptz,text,integer) TO authenticated,service_role;
COMMIT;
