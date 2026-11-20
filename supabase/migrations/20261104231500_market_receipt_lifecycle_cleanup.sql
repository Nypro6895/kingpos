begin;
create function market_platform.clear_obsolete_refresh_receipts() returns trigger
language plpgsql security definer set search_path=pg_catalog,market_platform as $$
begin
 if tg_table_name='installations' then
  if new.generation is distinct from old.generation or new.state is distinct from old.state then delete from refresh_receipts where installation_id=new.id and not synthetic;end if;
 elsif tg_table_name='app_credentials' then
  if new.generation is distinct from old.generation then delete from refresh_receipts where client_id=new.app_id;end if;
 else
  if new.connection_epoch is distinct from old.connection_epoch then delete from refresh_receipts where installation_id=new.id and synthetic;end if;
 end if;
 return new;
end $$;
revoke all on function market_platform.clear_obsolete_refresh_receipts() from public,anon,authenticated,service_role;
create trigger market_receipt_installation_cleanup after update of generation,state on market_platform.installations for each row execute function market_platform.clear_obsolete_refresh_receipts();
create trigger market_receipt_credential_cleanup after update of generation on market_platform.app_credentials for each row execute function market_platform.clear_obsolete_refresh_receipts();
create trigger market_receipt_sandbox_cleanup after update of connection_epoch on market_platform.sandboxes for each row execute function market_platform.clear_obsolete_refresh_receipts();
create index market_receipt_expiry on market_platform.refresh_receipts(expires_at);
-- Private DB-maintenance entry point; no web/RPC role gets this capability.
create function market_platform.prune_expired_refresh_receipts() returns integer
language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare removed integer;
begin
 delete from refresh_receipts where expires_at<=now();get diagnostics removed=row_count;return removed;
end $$;
revoke all on function market_platform.prune_expired_refresh_receipts() from public,anon,authenticated,service_role;
commit;
