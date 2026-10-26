begin;
-- Keep the receipt core on the exact customer visit associated with this relay.
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.service_relay_submit(uuid,uuid,integer,numeric,numeric,uuid,text)'::regprocedure);
 if position('''customerVisitId''' in definition)=0 then
  if position('''customerId'',cv.customer_id' in definition)=0 then raise exception 'Service Relay receipt needs review'; end if;
  definition:=replace(definition,'''customerId'',cv.customer_id','''customerVisitId'',p_visit,''customerId'',cv.customer_id');
  execute definition;
 end if;
end $$;
commit;
