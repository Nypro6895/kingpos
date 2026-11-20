begin;
-- Keep installed plugin IDs and tickets; rename only messages shown to users.
do $$declare signature text; definition text;begin
 foreach signature in array array[
  'public.service_relay_remove_guard()',
  'public.guard_pos_service_relay_ticket()'
 ] loop
  if to_regprocedure(signature) is null then continue; end if;
  definition:=pg_get_functiondef(to_regprocedure(signature));
  if position('Service Relay' in definition)>0 then
   execute replace(definition,'Service Relay','Phone Checkin');
  end if;
 end loop;
end $$;
commit;
