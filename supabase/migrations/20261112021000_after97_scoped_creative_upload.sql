begin;
-- The scoped creative bridge uses the same image-only 5 MB service staging.
-- Existing upload sessions, RLS, claim semantics and function ACLs are retained.
do $guard$
declare definition text; source text;
begin
 select pg_get_functiondef(oid),prosrc into definition,source from pg_proc where oid='public.prepare_app_local_upload(uuid,text,text,text,jsonb,text,text,integer,text,jsonb)'::regprocedure;
 if md5(replace(source,E'\r\n',E'\n'))<>'915e6371528a719c34fc348f99fdd58e' then raise exception 'Review changed upload preparation before extending creative adapter';end if;
 definition:=replace(definition,'''action.8bf63c94a49e4c5fa9fe2817'',''action.ee11d447d1154d3e1ff376fb''','''action.8bf63c94a49e4c5fa9fe2817'',''action.ee11d447d1154d3e1ff376fb'',''action.da68162edbd218f7afb9421d''');
 definition:=replace(definition,'p_action=''action.ee11d447d1154d3e1ff376fb''','p_action in (''action.ee11d447d1154d3e1ff376fb'',''action.da68162edbd218f7afb9421d'')');
 execute definition;
end $guard$;
alter table public.app_local_upload_sessions drop constraint app_local_upload_sessions_action_name_check;
alter table public.app_local_upload_sessions add constraint app_local_upload_sessions_action_name_check check(action_name in ('action.8bf63c94a49e4c5fa9fe2817','action.54072c2407a11cc75bd91fe7','action.805ee4ab28a6954dd0389212','action.ee11d447d1154d3e1ff376fb','action.0b1e0a58e14816ae5b2c1e9a','action.0eda261451682b1c1ea01f54','action.da68162edbd218f7afb9421d'));
commit;
