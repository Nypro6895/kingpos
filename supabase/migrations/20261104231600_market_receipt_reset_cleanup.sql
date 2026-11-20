begin;
-- UPDATE OF only sees the statement's target list, not columns changed by a
-- BEFORE trigger. Reset targets token_hash, whose BEFORE trigger advances epoch.
drop trigger market_receipt_sandbox_cleanup on market_platform.sandboxes;
create trigger market_receipt_sandbox_cleanup after update on market_platform.sandboxes
for each row when (old.connection_epoch is distinct from new.connection_epoch)
execute function market_platform.clear_obsolete_refresh_receipts();
commit;
