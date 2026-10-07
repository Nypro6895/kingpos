begin;
-- Close and delete must serialize on the same parent ticket. A UI precheck
-- alone permits a payment/item to disappear if another device closes it.
create or replace function public.guard_posted_pos_row_delete()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare ticket uuid; ticket_status text;
begin
  ticket := case when TG_TABLE_NAME='pos_payments' then (to_jsonb(OLD)->>'ticket_id')::uuid else (to_jsonb(OLD)->>'pos_ticket_id')::uuid end;
  select status into ticket_status from public.pos_tickets where id=ticket for update;
  if found and ticket_status<>'open' then
    raise exception using errcode='23503', message='Posted or voided tickets cannot lose financial rows. Use the correction workflow.';
  end if;
  return OLD;
end;
$$;
revoke all on function public.guard_posted_pos_row_delete() from public,anon,authenticated;
drop trigger if exists guard_posted_payment_delete on public.pos_payments;
create trigger guard_posted_payment_delete before delete on public.pos_payments for each row execute function public.guard_posted_pos_row_delete();
drop trigger if exists guard_posted_ticket_item_delete on public.pos_ticket_items;
create trigger guard_posted_ticket_item_delete before delete on public.pos_ticket_items for each row execute function public.guard_posted_pos_row_delete();
commit;
