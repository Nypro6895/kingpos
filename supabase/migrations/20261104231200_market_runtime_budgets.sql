begin;
alter table market_platform.settings
 add column runtime_data_per_minute integer not null default 1200 check(runtime_data_per_minute between 1 and 100000),
 add column runtime_media_per_minute integer not null default 600 check(runtime_media_per_minute between 1 and 100000),
 add column runtime_tokens_per_minute integer not null default 60 check(runtime_tokens_per_minute between 1 and 100000),
 add column runtime_codes_per_minute integer not null default 60 check(runtime_codes_per_minute between 1 and 100000);
create table market_platform.runtime_budgets(
 context_id uuid not null,kind text not null,window_at timestamptz not null,used integer not null,
 primary key(context_id,kind,window_at)
);
alter table market_platform.runtime_budgets enable row level security;
revoke all on market_platform.runtime_budgets from public,anon,authenticated,service_role;
create function market_platform.consume_runtime_budget(p_context uuid,p_kind text) returns void language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare cap integer;current_window timestamptz:=date_trunc('minute',clock_timestamp());used_now integer;
begin
 select case p_kind when 'data' then runtime_data_per_minute when 'media' then runtime_media_per_minute when 'token' then runtime_tokens_per_minute when 'code' then runtime_codes_per_minute end into cap from settings where id and enabled;
 if p_context is null or cap is null then raise exception using errcode='42501',message='Runtime unavailable.';end if;
 insert into runtime_budgets(context_id,kind,window_at,used) values(p_context,p_kind,current_window,1)
 on conflict(context_id,kind,window_at) do update set used=runtime_budgets.used+1 where runtime_budgets.used<cap returning used into used_now;
 if not found then raise exception using errcode='PT429',message='Runtime request limit reached. Retry after the current minute.';end if;
 delete from runtime_budgets where context_id=p_context and window_at<current_window-interval '5 minutes';
end $$;
revoke all on function market_platform.consume_runtime_budget(uuid,text) from public,anon,authenticated,service_role;

alter function market_platform.runtime_digest(text) rename to runtime_digest_pre_budget;
create function market_platform.runtime_digest(p_token_hash text) returns jsonb language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare result jsonb:=runtime_digest_pre_budget(p_token_hash);
begin perform consume_runtime_budget((result->>'installationId')::uuid,'data');return result;end $$;
revoke all on function market_platform.runtime_digest(text),market_platform.runtime_digest_pre_budget(text) from public,anon,authenticated,service_role;
alter function market_platform.publication_authority(text,text) rename to publication_authority_pre_budget;
create function market_platform.publication_authority(p_token text,p_group text) returns jsonb language plpgsql security definer set search_path=pg_catalog,market_platform as $$
declare result jsonb:=publication_authority_pre_budget(p_token,p_group);
begin perform consume_runtime_budget((result->>'installationId')::uuid,case when p_group='media' then 'media' else 'data' end);return result;end $$;
revoke all on function market_platform.publication_authority(text,text),market_platform.publication_authority_pre_budget(text,text) from public,anon,authenticated,service_role;

create function market_platform.limit_connection_issuance() returns trigger language plpgsql security definer set search_path=pg_catalog,market_platform as $$
begin
 if TG_TABLE_NAME in('tokens','authorization_codes') then perform consume_runtime_budget(new.installation_id,case when TG_TABLE_NAME='tokens' then 'token' else 'code' end);
 else perform consume_runtime_budget(new.sandbox_id,case when TG_TABLE_NAME='synthetic_connections' then 'token' else 'code' end);end if;
 return new;
end $$;
revoke all on function market_platform.limit_connection_issuance() from public,anon,authenticated,service_role;
create trigger market_limit_access_issuance after insert on market_platform.tokens for each row execute function market_platform.limit_connection_issuance();
create trigger market_limit_code_issuance after insert on market_platform.authorization_codes for each row execute function market_platform.limit_connection_issuance();
create trigger market_limit_synthetic_code after insert on market_platform.synthetic_codes for each row execute function market_platform.limit_connection_issuance();
create trigger market_limit_synthetic_access after insert or update of access_hash on market_platform.synthetic_connections for each row execute function market_platform.limit_connection_issuance();
commit;
