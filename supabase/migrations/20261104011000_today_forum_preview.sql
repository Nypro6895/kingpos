begin;
-- Add a bounded preview to the existing authorized reader; keep every other mode unchanged.
do $migration$
declare source text; marker text := 'if mode=''context'' then';
begin
 source := pg_get_functiondef('public.forum_read(jsonb)'::regprocedure);
 if position(marker in source)=0 then raise exception 'Unexpected forum reader definition'; end if;
 source := replace(source, marker, $branch$
 if mode='latest_preview' then
   return coalesce((select jsonb_agg(to_jsonb(preview) order by preview.created_at desc,preview.id desc)
     from (select t.id,t.title,left(regexp_replace(t.body,'[[:space:]]+',' ','g'),160) excerpt,t.created_at
       from public.forum_topics t where t.deleted_at is null
       order by t.created_at desc,t.id desc limit 2) preview),'[]'::jsonb);
 elsif mode='context' then
 $branch$);
 execute source;
end $migration$;
notify pgrst,'reload schema';
commit;
