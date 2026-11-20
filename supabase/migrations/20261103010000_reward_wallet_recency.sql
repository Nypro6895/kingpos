begin;
-- Read metadata only: the customer's latest joined salon is not the salon with
-- the largest balance. Keep all visit commands on their existing authority path.
create or replace function public.reward_personal(p_op text,p_args jsonb default '{}') returns jsonb language plpgsql security definer set search_path=public as $$
declare u uuid:=current_public_user_id(); v customer_visits; begin
 if u is null then raise exception 'Sign in required'; end if;
 if p_op='wallet' then
  return jsonb_build_object('cards',coalesce((
   select jsonb_agg(reward_view(m.salon_id,u)||jsonb_build_object('joinedAt',m.joined_at) order by m.joined_at desc,m.salon_id)
   from reward_members m where m.user_id=u
  ),'[]'));
 end if;
 select cv.* into v from customer_visits cv join customers c on c.id=cv.customer_id and c.customer_user_id=u where cv.id=(p_args->>'visitId')::uuid;
 if v.id is null then raise exception 'This visit does not belong to you'; end if;
 return reward_request_command(v.id,p_op,p_args,true);
end $$;
-- CREATE OR REPLACE preserves the existing personal RPC grants.
commit;
