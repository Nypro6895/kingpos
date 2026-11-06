select version, name
from supabase_migrations.schema_migrations
where version in ('20261021040000','20261021050000','20261021060000','20261021070000','20261021080000','20261021090000','20261021100000','20261021110000','20261106140000')
order by version;

select pg_get_functiondef('public.campaign_credit_close_expired(uuid)'::regprocedure) as definition,
       has_function_privilege('anon','public.campaign_credit_close_expired(uuid)','execute') as anon_execute,
       has_function_privilege('authenticated','public.campaign_credit_close_expired(uuid)','execute') as authenticated_execute,
       has_function_privilege('service_role','public.campaign_credit_close_expired(uuid)','execute') as service_execute;
