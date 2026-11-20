begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

alter table public.advertising_display_reservations add column if not exists disclosure_trace jsonb;

-- Preserve the exact CURRENT UUID-returning admission body, including every
-- lock, cleanup, history, quota and expiry branch. Only instrument the INSERT.
-- New display explanations describe the successful reservation, not a later
-- recomputation. Legacy clients keep the same RPC and UUID response.
do $trace$ declare body text;definition text;original_sha text;patched_sha text;needle text;replacement text;begin
 select p.prosrc,pg_get_functiondef(p.oid),p.prorettype::regtype::text into body,definition,needle
 from pg_proc p join pg_language l on l.oid=p.prolang
 where p.oid='public.reserve_advertising_display(uuid,uuid,text,text,text,text)'::regprocedure
  and l.lanname='plpgsql' and p.prosecdef and not p.proretset;
 if body is null or needle<>'uuid' then raise exception 'Platform admission signature changed; review disclosure instrumentation.';end if;
 body:=replace(body,E'\r\n',E'\n');definition:=replace(definition,E'\r\n',E'\n');
 original_sha:='e26e2e3084d0e43f4279a7acbf1e0d20f0cf684e59dde7d40582056d6245d5eb';
 needle:=E'insert into advertising_display_reservations(campaign_id,session_id,visitor_hash,campaign_kind,device,audience,path)\n values(p_campaign,p_session,p_visitor,c->>''kind'',p_device,p_audience,p_path) returning id into token;';
 replacement:=E'insert into advertising_display_reservations(campaign_id,session_id,visitor_hash,campaign_kind,device,audience,path,disclosure_trace)\n values(p_campaign,p_session,p_visitor,c->>''kind'',p_device,p_audience,p_path,\n jsonb_build_object(\n ''version'',1,''admittedAt'',clock_timestamp(),\n ''limits'',jsonb_build_object(''maxTotal'',coalesce((settings->>''maxTotal'')::integer,6),''maxPopups'',coalesce((settings->>''maxPopups'')::integer,1),''minPopupGapSeconds'',coalesce((settings->>''minPopupGapSeconds'')::integer,60),''sessionMinutes'',coalesce((settings->>''sessionMinutes'')::integer,30)),\n ''session'',jsonb_build_object(''viewsBefore'',(select count(*) from public.advertising_events where session_id=p_session and kind=''view''),''reservationsBefore'',total-(select count(*) from public.advertising_events where session_id=p_session and kind=''view''),''totalBefore'',total,''sameCampaignViewed'',false),\n ''popup'',jsonb_build_object(''applicable'',c->>''kind''=''popup'',''viewsBefore'',case when c->>''kind''=''popup'' then (select count(*) from public.advertising_events where session_id=p_session and kind=''view'' and campaign_kind=''popup'') else null end,\n ''reservationsBefore'',case when c->>''kind''=''popup'' then popups-(select count(*) from public.advertising_events where session_id=p_session and kind=''view'' and campaign_kind=''popup'') else null end,''totalBefore'',case when c->>''kind''=''popup'' then popups else null end,''priorPopupAt'',case when c->>''kind''=''popup'' then last_popup else null end,''gapSatisfied'',case when c->>''kind''=''popup'' then true else null end),\n ''repeat'',jsonb_build_object(''rule'',coalesce(c->>''repeat'',''always''),''checked'',c->>''kind''=''popup'',''eligible'',true,''historyScope'',''visitor_key_may_be_shared_network'',''timeZone'',''America/Chicago'')\n )) returning id into token;';
 if encode(sha256(convert_to(body,'UTF8')),'hex')=original_sha then
  if (length(body)-length(replace(body,needle,'')))/length(needle)<>1 then raise exception 'Platform reservation insert changed; review trace instrumentation.';end if;
  execute replace(definition,needle,replacement);
 else
  -- Idempotent replay accepts ONLY our exact instrumentation of the original.
  patched_sha:=encode(sha256(convert_to(replace(body,replacement,needle),'UTF8')),'hex');
  if patched_sha<>original_sha or strpos(body,replacement)=0 then raise exception 'Platform admission body changed; review disclosure instrumentation.';end if;
 end if;
end $trace$;

create or replace function public.guard_advertising_reservation_trace()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if new.disclosure_trace is distinct from old.disclosure_trace then raise exception 'Admission disclosure is immutable.';end if;
 return new;
end $$;
revoke all on function public.guard_advertising_reservation_trace() from public,anon,authenticated,service_role;
drop trigger if exists advertising_reservation_trace_immutable on public.advertising_display_reservations;
create trigger advertising_reservation_trace_immutable before update on public.advertising_display_reservations
 for each row execute function public.guard_advertising_reservation_trace();

create or replace function public.reserve_advertising_display_disclosed(p_campaign uuid,p_session uuid,p_visitor text,p_device text,p_audience text,p_path text)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare token uuid;trace jsonb;
begin
 token:=public.reserve_advertising_display(p_campaign,p_session,p_visitor,p_device,p_audience,p_path);
 if token is null then return jsonb_build_object('reservation',null,'trace',null);end if;
 select r.disclosure_trace into trace from public.advertising_display_reservations r where r.id=token;
 -- Existing pre-migration reservations have no historical proof. Never invent
 -- counts or overwrite their trace; old clients retain their 30-second UUID.
 if trace is null then return jsonb_build_object('reservation',null,'trace',null);end if;
 return jsonb_build_object('reservation',token,'trace',trace);
end $$;
revoke all on function public.reserve_advertising_display_disclosed(uuid,uuid,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.reserve_advertising_display_disclosed(uuid,uuid,text,text,text,text) to service_role;
comment on column public.advertising_display_reservations.disclosure_trace is 'Immutable redacted successful-admission snapshot; own random-session counts only, no session/visitor/token or shared-network seen timestamp.';
notify pgrst,'reload schema';
commit;
