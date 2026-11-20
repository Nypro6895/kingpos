-- Recover legacy guest device hashes only from a unique trusted anti-abuse counter.
-- Never manufacture a full device identifier from the shortened guest key.
with devices as (
 select c.id,min(a.identifier) as device_hash
 from public.post_safety_cases c join public.abuse_counters a
 on a.scope='device' and a.identifier ~ '^[a-f0-9]{64}$'
 and left(a.identifier,32)=replace(c.guest_key::text,'-','')
 where c.origin='user' and c.reporter_user_id is null and c.reporter_device_hash is null
 group by c.id having count(distinct a.identifier)=1
)
update public.post_safety_cases c set reporter_device_hash=d.device_hash from devices d where c.id=d.id;
