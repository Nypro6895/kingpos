import fs from 'node:fs';
import path from 'node:path';
import {runtime,sql,assertMarker} from './common.mjs';
assertMarker();const a=JSON.parse(fs.readFileSync(path.join(runtime,'access.json')));
sql(`begin;
 update booking_settings set booking_enabled=true,online_booking_visible=true,guest_booking_enabled=true where salon_id='${a.salon}';
 update services set online_booking_enabled=true,duration_minutes=30 where id='${a.service}';
 insert into salon_market_plugins(salon_id,plugin_id) values('${a.salon}','campaigns') on conflict do nothing;
 update staff set online_booking_enabled=true where salon_id='${a.salon}';
 insert into staff_service_assignments(salon_id,staff_id,service_id,is_active,online_bookable)
 select '${a.salon}','${a.staffId}','${a.service}',true,true where not exists(select 1 from staff_service_assignments where salon_id='${a.salon}' and staff_id='${a.staffId}' and service_id='${a.service}');
 insert into salon_operating_hours(salon_id,day_of_week,opens_at_local,closes_at_local,is_active)
 select '${a.salon}',d,'08:00','20:00',true from generate_series(0,6)d where not exists(select 1 from salon_operating_hours where salon_id='${a.salon}' and day_of_week=d);
 insert into staff_availability_rules(salon_id,staff_id,rule_type,day_of_week,starts_at_local,ends_at_local,timezone_iana,is_active)
 select '${a.salon}','${a.staffId}','working',d,'08:00','20:00','America/Chicago',true from generate_series(0,6)d where not exists(select 1 from staff_availability_rules where salon_id='${a.salon}' and staff_id='${a.staffId}' and rule_type='working' and day_of_week=d);
 commit;`);
console.log('QA online booking enabled with test staff/service and daily 08:00–20:00 hours.');
