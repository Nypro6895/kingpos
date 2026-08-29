revoke all on function public.get_customer_activity(integer) from public;
revoke all on function public.get_customer_activity_receipt(uuid) from public;

grant execute on function public.get_customer_activity(integer) to authenticated;
grant execute on function public.get_customer_activity_receipt(uuid) to authenticated;
