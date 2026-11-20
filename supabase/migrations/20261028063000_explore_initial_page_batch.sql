-- Compose the original actor-bound feed operations in one database transaction.
-- Ranking stays in the server; no client-selected identity or new public access.
create or replace function public.start_explore_social_feed_page_v1(p_actor_key text,p_filters jsonb,p_as_of timestamptz,p_region jsonb,p_queue jsonb,p_limit integer default 12)
returns jsonb language plpgsql volatile security invoker set search_path=public,pg_temp as $$
declare session_value jsonb; page_value jsonb; rows_value jsonb; keys_value text[]; ids uuid[]; metadata jsonb;
begin
 if p_limit is null or p_limit<1 or p_limit>12 then raise exception 'Invalid initial page limit' using errcode='22023';end if;
 session_value:=public.create_explore_social_feed_session(p_actor_key,p_filters,p_as_of,p_region,p_queue);
 page_value:=public.get_explore_social_feed_page(p_actor_key,p_filters,jsonb_build_object('version',1,'session',session_value->>'id','after',0),p_limit);
 keys_value:=array(select item->>'contentKey' from jsonb_array_elements(page_value->'keys') item);
 rows_value:=public.hydrate_explore_social_feed_items(p_actor_key,page_value->'cursor',keys_value);
 ids:=array(select distinct id from (
   select (item->>'salonId')::uuid id from jsonb_array_elements(page_value->'keys') item where item->>'salonId' is not null
   union select (item->'document'->>'salon_id')::uuid from jsonb_array_elements(rows_value) item where item->'document'->>'salon_id' is not null
 ) salons order by id);
 metadata:=public.get_public_explore_card_metadata_v1(ids);
 return jsonb_build_object('version',1,'page',page_value,'rows',rows_value,'metadata',metadata);
end $$;
revoke all on function public.start_explore_social_feed_page_v1(text,jsonb,timestamptz,jsonb,jsonb,integer) from public,anon,authenticated;
grant execute on function public.start_explore_social_feed_page_v1(text,jsonb,timestamptz,jsonb,jsonb,integer) to service_role;
