begin;
create extension if not exists pg_net with schema extensions;
create function public.run_campaign_credit_queue() returns bigint language plpgsql security definer set search_path=public as $$
declare token text;
begin
 select decrypted_secret into token from vault.decrypted_secrets where name='campaign-credit-queue';
 if token is null then raise exception 'Campaign scheduler is not configured.'; end if;
 return net.http_get(url:='https://reylumi.com/api/internal/campaign-credits',headers:=jsonb_build_object('Authorization','Bearer '||token),timeout_milliseconds:=270000);
end $$;
revoke all on function public.run_campaign_credit_queue() from public,anon,authenticated,service_role;
select cron.schedule('campaign-credit-queue','*/15 * * * *','select public.run_campaign_credit_queue();');
commit;
