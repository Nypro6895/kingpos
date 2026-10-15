begin;

alter table public.locations add column if not exists created_by_user_id uuid references public.users(id) on delete set null;
create or replace function public.record_location_creator() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_op='INSERT' then
   select id into new.created_by_user_id from public.users where auth_user_id=auth.uid();
 else new.created_by_user_id:=old.created_by_user_id;
 end if;
 return new;
end;$$;
revoke all on function public.record_location_creator() from public,anon,authenticated;
drop trigger if exists record_location_creator on public.locations;
create trigger record_location_creator before insert or update on public.locations for each row execute function public.record_location_creator();

create table if not exists public.platform_admin_attention (
 target_type text not null check(target_type in ('user','location')),
 target_id uuid not null,
 reason text not null check(length(reason) between 3 and 1000),
 marked_by_user_id uuid not null references public.users(id),
 created_at timestamptz not null default now(),
 primary key(target_type,target_id)
);
alter table public.platform_admin_attention enable row level security;
revoke all on public.platform_admin_attention from public,anon,authenticated;
grant all on public.platform_admin_attention to service_role;

create or replace function public.set_platform_admin_attention(p_target_type text,p_target_id uuid,p_marked boolean,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor record; previous jsonb; clean_reason text;
begin
 if p_target_type not in ('user','location') or p_target_type is null or p_marked is null then raise exception 'Invalid attention target.'; end if;
 select * into actor from platform_admin_require_permission(case when p_target_type='user' then 'admin.users.update' else 'admin.locations.update_status' end);
 clean_reason:=platform_admin_normalize_reason(p_reason);
 if length(clean_reason)>1000 then raise exception 'Reason must be at most 1000 characters.'; end if;
 if (p_target_type='user' and not exists(select 1 from users where id=p_target_id)) or
 (p_target_type='location' and not exists(select 1 from locations where id=p_target_id)) then raise exception 'Record not found.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('admin-attention:'||p_target_type||':'||p_target_id::text,0));
 select to_jsonb(a) into previous from platform_admin_attention a where target_type=p_target_type and target_id=p_target_id;
 if p_marked then
 insert into platform_admin_attention(target_type,target_id,reason,marked_by_user_id) values(p_target_type,p_target_id,clean_reason,actor.actor_user_id)
 on conflict(target_type,target_id) do update set reason=excluded.reason,marked_by_user_id=excluded.marked_by_user_id;
 else delete from platform_admin_attention where target_type=p_target_type and target_id=p_target_id; end if;
 insert into platform_admin_audit_logs(actor_user_id,action,target_type,target_id,reason,before_data,after_data)
 values(actor.actor_user_id,case when p_marked then 'attention.marked' else 'attention.removed' end,p_target_type,p_target_id,clean_reason,previous,jsonb_build_object('marked',p_marked));
 return jsonb_build_object('marked',p_marked);
end;$$;

create or replace function public.get_platform_admin_new_accounts() returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb:='{}'; start_at timestamptz; end_at timestamptz; sensitive boolean;
begin
 perform platform_admin_require_permission('admin.dashboard.read');
 start_at:=date_trunc('day',now() at time zone 'America/Chicago') at time zone 'America/Chicago';
 end_at:=(date_trunc('day',now() at time zone 'America/Chicago')+interval '1 day') at time zone 'America/Chicago';
 sensitive:=platform_admin_has_permission('admin.users.read_sensitive');
 if platform_admin_has_permission('admin.users.read') then
 result:=result||jsonb_build_object('users_today',(select count(*) from users where created_at>=start_at and created_at<end_at),
 'users',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'name',coalesce(nullif(u.display_name,''),nullif(concat_ws(' ',u.first_name,u.last_name),''),'Unnamed user'),
 'contact',case when sensitive then coalesce(u.email,u.phone) else null end,'status',u.status,'created_at',u.created_at,
 'marked',exists(select 1 from platform_admin_attention a where a.target_type='user' and a.target_id=u.id)) order by u.created_at desc,u.id)
 from (select * from users order by created_at desc,id limit 3) u),'[]'::jsonb));
 end if;
 if platform_admin_has_permission('admin.locations.read') then
 result:=result||jsonb_build_object('salons_today',(select count(*) from locations where created_at>=start_at and created_at<end_at),
 'salons',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'name',l.name,'address',concat_ws(', ',nullif(l.address_line1,''),nullif(l.address_line2,''),nullif(l.city,''),nullif(l.state,''),nullif(l.postal_code,'')),
 'creator_id',case when platform_admin_has_permission('admin.users.read') then l.created_by_user_id else null end,
 'creator_name',case when platform_admin_has_permission('admin.users.read') then creator.display_name else null end,
 'creator_contact',case when sensitive and platform_admin_has_permission('admin.users.read') then coalesce(creator.email,creator.phone) else null end,
 'status',l.status,'created_at',l.created_at,'marked',exists(select 1 from platform_admin_attention a where a.target_type='location' and a.target_id=l.id)) order by l.created_at desc,l.id)
 from (select * from locations order by created_at desc,id limit 3) l left join users creator on creator.id=l.created_by_user_id),'[]'::jsonb));
 end if;
 return result;
end;$$;

create or replace function public.list_platform_admin_attention(p_page integer default 1,p_kind text default 'user') returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
 if p_kind not in ('user','location') or p_page is null or p_page<1 then raise exception 'Invalid attention filter.'; end if;
 perform platform_admin_require_permission(case when p_kind='user' then 'admin.users.read' else 'admin.locations.read' end);
 select jsonb_build_object('total',(select count(*) from platform_admin_attention where target_type=p_kind),'items',coalesce(jsonb_agg(to_jsonb(rows) order by rows.created_at desc,rows.target_id),'[]'::jsonb)) into result from (
 select a.*,marker.display_name as marked_by,coalesce(u.display_name,l.name,'Unnamed record') as name,
 coalesce(u.status,l.status) as status,case when p_kind='user' and platform_admin_has_permission('admin.users.read_sensitive') then coalesce(u.email,u.phone) else null end as contact
 from platform_admin_attention a left join users u on a.target_type='user' and u.id=a.target_id left join locations l on a.target_type='location' and l.id=a.target_id
 left join users marker on marker.id=a.marked_by_user_id where a.target_type=p_kind order by a.created_at desc,a.target_id limit 25 offset (p_page-1)::bigint*25
 ) rows;
 return result;
end;$$;

create or replace function public.get_platform_admin_account_activity(p_user_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 perform platform_admin_require_permission('admin.users.read');
 perform platform_admin_require_permission('admin.audit.read');
 return coalesce((select jsonb_agg(to_jsonb(rows) order by rows.created_at desc) from (
 select id,activity_type,device_label,created_at from account_login_activity where user_id=p_user_id order by created_at desc limit 50
 ) rows),'[]'::jsonb);
end;$$;
create or replace function public.get_platform_admin_attention_state(p_kind text,p_id uuid) returns boolean language plpgsql stable security definer set search_path=public as $$
begin
 if p_kind not in ('user','location') or p_kind is null then raise exception 'Invalid attention target.'; end if;
 perform platform_admin_require_permission(case when p_kind='user' then 'admin.users.read' else 'admin.locations.read' end);
 return exists(select 1 from platform_admin_attention where target_type=p_kind and target_id=p_id);
end;$$;
revoke all on function public.get_platform_admin_attention_state(text,uuid) from public,anon;
grant execute on function public.get_platform_admin_attention_state(text,uuid) to authenticated;
revoke all on function public.set_platform_admin_attention(text,uuid,boolean,text),public.get_platform_admin_new_accounts(),public.list_platform_admin_attention(integer,text),public.get_platform_admin_account_activity(uuid) from public,anon;
grant execute on function public.set_platform_admin_attention(text,uuid,boolean,text),public.get_platform_admin_new_accounts(),public.list_platform_admin_attention(integer,text),public.get_platform_admin_account_activity(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
