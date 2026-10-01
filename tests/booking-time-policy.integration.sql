-- Run in a transaction; only temporary tables are written. No customer appointments are created.
do $$
declare reference timestamptz := '2026-09-24 13:55:00-05'; rejected boolean;
begin
  rejected:=false;
  begin perform public.assert_booking_time_policy('2026-09-24 09:00-05','2026-09-24 09:30-05','America/Chicago',true,0,60,reference);
  exception when others then if sqlerrm not like '%Past times%' then raise; end if; rejected:=true; end;
  if not rejected then raise exception 'Past appointment accepted'; end if;
  rejected:=false;
  begin perform public.assert_booking_time_policy('2026-09-24 16:00-05','2026-09-24 16:30-05','America/Chicago',false,120,60,reference);
  exception when others then if sqlerrm not like '%Same-day%' then raise; end if; rejected:=true; end;
  if not rejected then raise exception 'Same-day appointment accepted'; end if;
  rejected:=false;
  begin perform public.assert_booking_time_policy('2026-09-24 14:00-05','2026-09-24 14:30-05','America/Chicago',true,120,60,reference);
  exception when others then if sqlerrm not like '%120 minutes%' then raise; end if; rejected:=true; end;
  if not rejected then raise exception 'Short notice accepted'; end if;
  rejected:=false;
  begin perform public.assert_booking_time_policy('2027-01-01 09:00-06','2027-01-01 09:30-06','America/Chicago',true,0,60,reference);
  exception when others then if sqlerrm not like '%60 days%' then raise; end if; rejected:=true; end;
  if not rejected then raise exception 'Horizon exceeded'; end if;
  perform public.assert_booking_time_policy('2026-09-25 09:00-05','2026-09-25 09:30-05','America/Chicago',false,120,60,reference);
  perform public.assert_booking_time_policy('2026-09-24 14:00-05','2026-09-24 14:30-05','America/Chicago',true,0,60,reference);
end $$;

create temporary table booking_policy_probe(salon_id uuid, start_at timestamptz, end_at timestamptz, status text);
-- Historical status-only changes must keep working after the rule is introduced.
insert into booking_policy_probe values(gen_random_uuid(),now()-interval '2 days',now()-interval '2 days'+interval '30 minutes','scheduled');
create trigger enforce_probe before insert or update of start_at on booking_policy_probe
for each row execute function public.enforce_booking_time_policy();
update booking_policy_probe set status='cancelled',start_at=start_at;
do $$
declare rejected boolean:=false;
begin
  begin insert into booking_policy_probe values(gen_random_uuid(),now()-interval '2 hours',now()-interval '1 hour','scheduled');
  exception when others then if sqlerrm not like '%Past times%' then raise; end if; rejected:=true; end;
  if not rejected then raise exception 'Insert bypassed trigger'; end if;
  rejected:=false;
  begin update booking_policy_probe set start_at=now()-interval '1 hour',end_at=now();
  exception when others then if sqlerrm not like '%Past times%' then raise; end if; rejected:=true; end;
  if not rejected then raise exception 'Reschedule bypassed trigger'; end if;
  insert into booking_policy_probe values(gen_random_uuid(),now()+interval '3 days',now()+interval '3 days 30 minutes','scheduled');
end $$;
drop table booking_policy_probe;
