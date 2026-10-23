begin;
create function public.my_customer_identity_groups() returns jsonb
language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(to_jsonb(g)),'[]') from (
 select c.location_id "salonId",l.name "salonName",jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'phone',c.phone) order by c.created_at,c.id) customers
 from customers c join locations l on l.id=c.location_id
 where c.customer_user_id=current_public_user_id() and current_public_user_id() is not null
 group by c.location_id,l.name having count(*)>1
 ) g
$$;
revoke all on function public.my_customer_identity_groups() from public,anon;
grant execute on function public.my_customer_identity_groups() to authenticated;
commit;
