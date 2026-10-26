-- Auth-confirmed identities must not inherit the automatic unverified-identity hold.
-- Explicit restrictions, account status, signed context, quotas and fingerprints remain unchanged.
-- No existing identity, restriction or content row is updated by this migration.
begin;
set local search_path=public;

do $migration$
declare
  definition text;
  old_fragment text;
  new_fragment text;
  trigger_definition text;
begin
  definition := pg_get_functiondef('public.abuse_guard_actor(text)'::regprocedure);
  old_fragment := 'or exists(select 1 from abuse_identity_reviews where auth_user_id=user_row.auth_user_id and verified_at is null)';
  new_fragment := 'or exists(select 1 from abuse_identity_reviews ar join auth.users au on au.id=ar.auth_user_id where ar.auth_user_id=user_row.auth_user_id and ar.verified_at is null and au.email_confirmed_at is null and au.phone_confirmed_at is null)';
  if position(new_fragment in definition) = 0 then
    if position(old_fragment in definition) = 0 then
      raise exception 'Unexpected abuse_guard_actor identity predicate; review before applying.';
    end if;
    execute replace(definition, old_fragment, new_fragment);
  end if;

  definition := pg_get_functiondef('public.get_abuse_notice(uuid,text,text,text)'::regprocedure);
  old_fragment := 'where u.id=p_user_id and ar.verified_at is null';
  new_fragment := 'where u.id=p_user_id and ar.verified_at is null and exists(select 1 from auth.users au where au.id=ar.auth_user_id and au.email_confirmed_at is null and au.phone_confirmed_at is null)';
  if position(new_fragment in definition) = 0 then
    if position(old_fragment in definition) = 0 then
      raise exception 'Unexpected get_abuse_notice identity predicate; review before applying.';
    end if;
    execute replace(definition, old_fragment, new_fragment);
  end if;

  definition := pg_get_functiondef('public.abuse_track_identity()'::regprocedure);
  old_fragment := 'insert into abuse_identity_reviews(auth_user_id) values(new.id) on conflict do nothing;';
  new_fragment := 'insert into abuse_identity_reviews(auth_user_id,verified_at) values(new.id,case when new.email_confirmed_at is not null or new.phone_confirmed_at is not null then now() else null end) on conflict do nothing;';
  if position(new_fragment in definition) = 0 then
    if position(old_fragment in definition) = 0 then
      raise exception 'Unexpected abuse_track_identity insert; review before applying.';
    end if;
    definition := replace(definition, old_fragment, new_fragment);
  end if;
  old_fragment := 'old.email_confirmed_at is null and new.email_confirmed_at is not null and (select email_delivery_ready from abuse_system_settings where id)';
  new_fragment := 'old.email_confirmed_at is null and old.phone_confirmed_at is null and (new.email_confirmed_at is not null or new.phone_confirmed_at is not null)';
  if position(new_fragment in definition) = 0 then
    if position(old_fragment in definition) = 0 then
      raise exception 'Unexpected abuse_track_identity confirmation update; review before applying.';
    end if;
    definition := replace(definition, old_fragment, new_fragment);
  end if;
  execute definition;

  select pg_get_triggerdef(oid) into trigger_definition
  from pg_trigger where tgrelid='auth.users'::regclass
    and tgname='abuse_track_identity' and not tgisinternal and tgenabled='O';
  if trigger_definition = 'CREATE TRIGGER abuse_track_identity AFTER INSERT OR UPDATE OF email_confirmed_at ON auth.users FOR EACH ROW EXECUTE FUNCTION abuse_track_identity()' then
    drop trigger abuse_track_identity on auth.users;
    create trigger abuse_track_identity after insert or update of email_confirmed_at,phone_confirmed_at on auth.users
      for each row execute function public.abuse_track_identity();
  elsif trigger_definition is distinct from 'CREATE TRIGGER abuse_track_identity AFTER INSERT OR UPDATE OF email_confirmed_at, phone_confirmed_at ON auth.users FOR EACH ROW EXECUTE FUNCTION abuse_track_identity()' then
    raise exception 'Unexpected identity tracking trigger; review before applying.';
  end if;
end;
$migration$;

-- CREATE OR REPLACE retains the existing owner and EXECUTE ACLs; no public grant is added.
notify pgrst, 'reload schema';
commit;
