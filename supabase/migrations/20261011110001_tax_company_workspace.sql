begin;

-- Notes belong to the tax professional's personal account, not salon staff.
create table public.tax_company_notes (
 salon_id uuid not null references public.locations(id) on delete cascade,
 user_id uuid not null references public.users(id) on delete cascade,
 content text not null default '' check(char_length(content)<=4000),
 version integer not null default 1,
 updated_at timestamptz not null default now(),
 primary key(salon_id,user_id)
);
alter table public.tax_company_notes enable row level security;
revoke all on public.tax_company_notes from public,anon,authenticated;
grant select on public.tax_company_notes to authenticated;
create policy tax_notes_private_read on public.tax_company_notes for select to authenticated
 using(user_id=public.current_public_user_id() and public.tax_company_has_access(salon_id));

create function public.tax_company_save_note(p_salon uuid,p_content text,p_version integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=current_public_user_id(); note tax_company_notes;
begin
 if not tax_company_has_access(p_salon) then raise exception 'Reconnect this salon before saving notes.'; end if;
 if p_content is null or char_length(p_content)>4000 then raise exception 'Notes must be 4,000 characters or fewer.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('tax.note:'||p_salon::text||':'||actor::text,0));
 select * into note from tax_company_notes where salon_id=p_salon and user_id=actor for update;
 if p_version is distinct from coalesce(note.version,0) then raise exception 'This note changed on another device. Refresh before editing again.'; end if;
 insert into tax_company_notes(salon_id,user_id,content) values(p_salon,actor,btrim(p_content))
 on conflict(salon_id,user_id) do update set content=excluded.content,version=tax_company_notes.version+1,updated_at=now()
 returning * into note;
 return jsonb_build_object('content',note.content,'version',note.version,'updated_at',note.updated_at);
end $$;
revoke all on function public.tax_company_save_note(uuid,text,integer) from public,anon;
grant execute on function public.tax_company_save_note(uuid,text,integer) to authenticated;

create function public.tax_company_owner_details(p_salon uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare details jsonb;
begin
 -- The existing settings RPC enforces active salon owner access.
 details:=tax_company_settings(p_salon,null,false);
 return details || jsonb_build_object('salon_name',(select name from locations where id=p_salon),
 'connections',coalesce((select jsonb_agg(jsonb_build_object(
   'user_id',u.id,'display_name',coalesce(nullif(btrim(u.display_name),''),nullif(btrim(concat_ws(' ',u.first_name,u.last_name)),'')),
   'email',u.email,'phone',u.phone,'connected_at',c.connected_at,'account_active',u.status='active') order by c.connected_at)
 from tax_company_connections c join users u on u.id=c.user_id where c.salon_id=p_salon),'[]'::jsonb));
end $$;
revoke all on function public.tax_company_owner_details(uuid) from public,anon;
grant execute on function public.tax_company_owner_details(uuid) to authenticated;

create or replace function public.tax_company_scope(p_salon uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
 if not tax_company_has_access(p_salon) then raise exception 'Salon connection expired. Connect again with the current password.'; end if;
 return (select jsonb_build_object('salon',to_jsonb(l),'account',to_jsonb(a),
 'payroll_setting',(select to_jsonb(s) from salon_payroll_settings s where s.salon_id=p_salon),
 'note',coalesce((select jsonb_build_object('content',n.content,'version',n.version,'updated_at',n.updated_at)
   from tax_company_notes n where n.salon_id=p_salon and n.user_id=current_public_user_id()),jsonb_build_object('content','','version',0,'updated_at',null)))
 from locations l join accounts a on a.id=l.account_id where l.id=p_salon);
end $$;

create or replace function public.tax_company_salons() returns jsonb
language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'name',l.name,
 'address_line1',l.address_line1,'address_line2',l.address_line2,'city',l.city,'state',l.state,
 'postal_code',l.postal_code,'country',l.country,'phone',l.phone,
 'cycle_type',coalesce(s.cycle_type,'monthly'),'connected_at',c.connected_at,'active',tax_company_has_access(l.id)) order by l.name),'[]'::jsonb)
 from tax_company_connections c join locations l on l.id=c.salon_id
 left join salon_payroll_settings s on s.salon_id=l.id where c.user_id=current_public_user_id();
$$;
commit;
