begin;
do $$
declare account uuid; salon uuid; ticket uuid; payment uuid; item uuid; rejected boolean;
begin
  insert into public.accounts(name) values('Posted deletion fixture') returning id into account;
  insert into public.locations(account_id,name) values(account,'Posted deletion fixture') returning id into salon;
  insert into public.pos_tickets(salon_id,status) values(salon,'open') returning id into ticket;
  insert into public.pos_payments(salon_id,ticket_id,payment_method,amount) values(salon,ticket,'cash',20) returning id into payment;
  delete from public.pos_payments where id=payment;
  if exists(select 1 from public.pos_payments where id=payment) then raise exception 'Open ticket editing was blocked'; end if;
  insert into public.pos_tickets(salon_id,status) values(salon,'closed') returning id into ticket;
  insert into public.pos_payments(salon_id,ticket_id,payment_method,amount) values(salon,ticket,'cash',20) returning id into payment;
  insert into public.pos_ticket_items(salon_id,pos_ticket_id,unit_price,line_total) values(salon,ticket,20,20) returning id into item;
  rejected:=false;
  begin delete from public.pos_payments where id=payment; exception when foreign_key_violation then rejected:=true; end;
  if not rejected then raise exception 'Posted payment was deleted'; end if;
  rejected:=false;
  begin delete from public.pos_ticket_items where id=item; exception when foreign_key_violation then rejected:=true; end;
  if not rejected then raise exception 'Posted ticket item was deleted'; end if;
end;
$$;
rollback;
