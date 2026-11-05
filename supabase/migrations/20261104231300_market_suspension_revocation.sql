begin;
-- Suspension is an incident-response revocation, never a reversible token pause.
-- The apps row is also the serialization lock used by authorize/exchange/refresh.
create function market_platform.revoke_suspended_app() returns trigger
language plpgsql security definer set search_path=pg_catalog,market_platform as $$
begin
 if not new.active then
  update installations set state='revoked',generation=generation+1,updated_at=now() where app_id=new.id;
  delete from tokens t using installations i where t.installation_id=i.id and i.app_id=new.id;
  delete from refresh_grants g using installations i where g.installation_id=i.id and i.app_id=new.id;
  delete from authorization_codes where app_id=new.id;
  delete from synthetic_codes c using sandboxes s,versions v where c.sandbox_id=s.id and s.version_id=v.id and v.app_id=new.id;
  delete from synthetic_connections c using sandboxes s,versions v where c.sandbox_id=s.id and s.version_id=v.id and v.app_id=new.id;
  update sandboxes s set connection_epoch=connection_epoch+1,expires_at=least(expires_at,now()) from versions v where s.version_id=v.id and v.app_id=new.id;
  delete from refresh_receipts where client_id=new.id;
 end if;
 return new;
end $$;
revoke all on function market_platform.revoke_suspended_app() from public,anon,authenticated,service_role;
create trigger market_suspension_revocation after update of active on market_platform.apps
for each row execute function market_platform.revoke_suspended_app();
-- Existing inactive apps also lose grants when this migration is integrated.
update market_platform.apps set active=false where not active;
commit;
