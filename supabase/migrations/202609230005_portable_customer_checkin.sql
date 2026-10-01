-- A paired local POS owns its current cart. An older cloud draft must not
-- turn an idle customer's check-in into checkout on a previous receipt.
do $migration$
declare definition text; updated text;
begin
  definition := pg_get_functiondef('public.resolve_customer_display_submission(text,text,text,text)'::regprocedure);
  updated := regexp_replace(definition,
    'is_checkout_handoff := draft_row.status = ''draft''[[:space:]]+and draft_row.customer_handoff_started_at is not null;',
    'is_checkout_handoff := false;');
  if updated = definition then raise exception 'Customer check-in implementation needs review'; end if;
  updated := replace(updated, 'resolve_customer_display_submission(', 'resolve_customer_display_check_in(');
  execute updated;
end;
$migration$;
revoke all on function public.resolve_customer_display_check_in(text,text,text,text) from public;
grant execute on function public.resolve_customer_display_check_in(text,text,text,text) to anon,authenticated;
