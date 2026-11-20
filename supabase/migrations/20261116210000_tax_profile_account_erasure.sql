begin;

-- Only the personal professional profile belongs to this erasure step. Shared
-- salon documents, messages, events, paystubs and financial ledgers keep their
-- existing custody/retention rules. This migration does not sweep old accounts.
create or replace function public.erase_tax_personal_profile(p_user_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if not public.is_account_erasure_write(p_user_id) then
  raise exception 'Due account erasure required.' using errcode='42501';
 end if;
 delete from public.tax_profiles where user_id=p_user_id;
end $$;
revoke all on function public.erase_tax_personal_profile(uuid) from public,anon,authenticated,service_role;

-- Already-queued erasures have passed the SQL finalizer. Run the same personal
-- scrub at their existing leased batch checkpoint, before Storage/Auth work.
create or replace function public.erase_tax_profile_for_leased_job(p_user_id uuid,p_lease uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare prior_marker text:=current_setting('reylumi.account_erasure_user',true);
begin
 perform 1 from public.account_erasure_jobs
 where user_id=p_user_id and lease_token=p_lease and leased_until>now() and status='processing'
 for update;
 if not found then raise exception 'Erasure lease expired.'; end if;
 perform set_config('reylumi.account_erasure_user',p_user_id::text,true);
 perform public.erase_tax_personal_profile(p_user_id);
 perform set_config('reylumi.account_erasure_user',coalesce(prior_marker,''),true);
end $$;
revoke all on function public.erase_tax_profile_for_leased_job(uuid,uuid) from public,anon,authenticated,service_role;

-- Serialize the supported profile writer with finalization's users FOR UPDATE
-- lock. A request that began before deletion must recheck the locked status,
-- rather than recreate a profile from an earlier active-account observation.
create or replace function public.tax_profile_active_actor()
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.tax_actor(); actor_status text;
begin
 select status into actor_status from public.users where id=actor for share;
 if actor_status is distinct from 'active' then
  raise exception 'Sign in to an active Reylumi account.' using errcode='42501';
 end if;
 return actor;
end $$;
revoke all on function public.tax_profile_active_actor() from public,anon,authenticated,service_role;

-- Preserve the installed erasure bodies (including the Forum extension), their
-- signatures and ACLs. Unknown source shapes abort the whole migration; there
-- is no catch-and-continue path that could mark a partial erasure complete.
do $patch$
declare definition text; marker text; replacement text;
begin
 if to_regclass('public.tax_profiles') is null
 or to_regprocedure('public.erase_account_personal_content(uuid,uuid)') is null
 or to_regprocedure('public.account_erasure_batch(uuid,uuid)') is null
 or to_regprocedure('public.finish_account_erasure(uuid,uuid,text)') is null
 or to_regprocedure('public.is_account_erasure_write(uuid)') is null
 or to_regprocedure('public.tax_actor()') is null
 or to_regprocedure('public.tax_save_profile(text,text,text,text)') is null then
  raise exception 'Tax profile erasure dependencies are unavailable.';
 end if;
 if exists(select 1 from pg_proc where oid in (
  'public.erase_account_personal_content(uuid,uuid)'::regprocedure,
  'public.account_erasure_batch(uuid,uuid)'::regprocedure,
  'public.finish_account_erasure(uuid,uuid,text)'::regprocedure,
  'public.is_account_erasure_write(uuid)'::regprocedure,
  'public.tax_save_profile(text,text,text,text)'::regprocedure
 ) and not prosecdef) then
  raise exception 'Tax profile erasure security boundary changed; review integration.';
 end if;

 definition:=pg_get_functiondef('public.erase_account_personal_content(uuid,uuid)'::regprocedure);
 marker:='perform public.erase_forum_personal_content(p_user_id);';
 if strpos(definition,'perform public.erase_tax_personal_profile(p_user_id);')=0 then
  if (length(definition)-length(replace(definition,marker,'')))/length(marker)<>1 then
   raise exception 'Personal erasure source changed; review Tax profile integration.';
  end if;
  execute replace(definition,marker,marker||E'\n perform public.erase_tax_personal_profile(p_user_id);');
 end if;

 definition:=pg_get_functiondef('public.account_erasure_batch(uuid,uuid)'::regprocedure);
 marker:='return coalesce((select jsonb_agg(to_jsonb(o)) from (';
 if strpos(definition,'perform public.erase_tax_profile_for_leased_job(p_user_id,p_lease);')=0 then
  if (length(definition)-length(replace(definition,marker,'')))/length(marker)<>1
  or strpos(definition,'status=''processing''')=0 then
   raise exception 'Erasure batch source changed; review Tax profile integration.';
  end if;
  execute replace(definition,marker,E'perform public.erase_tax_profile_for_leased_job(p_user_id,p_lease);\n '||marker);
 end if;

 definition:=pg_get_functiondef('public.finish_account_erasure(uuid,uuid,text)'::regprocedure);
 marker:='if exists(select 1 from account_erasure_objects where user_id=p_user_id and completed_at is null) then';
 if strpos(definition,'Tax profile erasure is incomplete.')=0 then
  if (length(definition)-length(replace(definition,marker,'')))/length(marker)<>1
  or strpos(definition,'if p_error is not null then')=0 then
   raise exception 'Erasure completion source changed; review Tax profile integration.';
  end if;
  replacement:=E'if exists(select 1 from public.tax_profiles where user_id=p_user_id) then\n  raise exception ''Tax profile erasure is incomplete.'';\n end if;\n ';
  execute replace(definition,marker,replacement||marker);
 end if;

 definition:=pg_get_functiondef('public.tax_save_profile(text,text,text,text)'::regprocedure);
 marker:='values(tax_actor(),btrim(p_name),lower(btrim(p_email)),btrim(p_phone),btrim(p_company))';
 if strpos(definition,'values(public.tax_profile_active_actor(),')=0 then
  if (length(definition)-length(replace(definition,marker,'')))/length(marker)<>1 then
   raise exception 'Tax profile writer source changed; review account-status locking.';
  end if;
  execute replace(definition,marker,replace(marker,'tax_actor()','public.tax_profile_active_actor()'));
 end if;
end $patch$;

notify pgrst,'reload schema';
commit;
