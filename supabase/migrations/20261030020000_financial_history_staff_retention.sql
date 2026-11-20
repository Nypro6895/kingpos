begin;
-- Preserve the shipped nullable Staff reference and immutable name snapshot
-- when a Staff deletion cascades through a payroll setting. No data rewrite.
do $retention$
declare original text; updated text;
begin
 original:=pg_get_functiondef('public.audit_payroll_live_change()'::regprocedure);
 if position($old$values(sid,recipient_staff,(select jsonb_build_object('id',s.id,'displayName',s.display_name) from public.staff s where s.id=recipient_staff),tg_table_name$old$ in original)=0 then raise exception 'Financial audit source changed; review retention patch'; end if;
 updated:=replace(original,$old$values(sid,recipient_staff,(select jsonb_build_object('id',s.id,'displayName',s.display_name) from public.staff s where s.id=recipient_staff),tg_table_name$old$,$new$values(sid,(select s.id from public.staff s where s.id=recipient_staff and s.salon_id=sid),coalesce((select jsonb_build_object('id',s.id,'displayName',s.display_name) from public.staff s where s.id=recipient_staff and s.salon_id=sid),(select h.staff_snapshot from public.payroll_live_change_history h where h.salon_id=sid and h.staff_snapshot->>'id'=recipient_staff::text order by h.created_at desc,h.id desc limit 1),jsonb_build_object('id',recipient_staff,'displayName',null)),tg_table_name$new$);
 execute updated;
end $retention$;
commit;
