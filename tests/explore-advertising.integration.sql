begin;
do $$
declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); c uuid:=gen_random_uuid();
begin
 insert into public.explore_campaigns(id,config) values
 (a,jsonb_build_object('id',a,'kind','popup','enabled',true,'repeat','once')),
 (b,jsonb_build_object('id',b,'kind','popup','enabled',true,'repeat','daily')),
 (c,jsonb_build_object('id',c,'kind','popup','enabled',false,'repeat','always'));
 if not public.claim_explore_popup(a,'test-ip') then raise exception 'First impression should display'; end if;
 if public.claim_explore_popup(a,'test-ip') then raise exception 'Once campaign repeated for same IP'; end if;
 if not public.claim_explore_popup(a,'other-ip') then raise exception 'Different IP should display'; end if;
 if not public.claim_explore_popup(b,'test-ip') then raise exception 'Daily first impression should display'; end if;
 if public.claim_explore_popup(b,'test-ip') then raise exception 'Daily campaign repeated today'; end if;
 update public.explore_campaign_impressions set last_seen=now()-interval '2 days' where campaign_id=b;
 if not public.claim_explore_popup(b,'test-ip') then raise exception 'Daily campaign should display tomorrow'; end if;
 if public.claim_explore_popup(c,'test-ip') then raise exception 'Paused campaign displayed'; end if;
 update public.explore_campaigns set config=config||jsonb_build_object('enabled',true,'startsAt',now()+interval '1 day') where id=c;
 if public.claim_explore_popup(c,'test-ip') then raise exception 'Future campaign displayed'; end if;
 if has_table_privilege('anon','public.explore_campaign_impressions','SELECT') then raise exception 'IP history exposed'; end if;
 if has_table_privilege('authenticated','public.explore_reference_favorites','SELECT') then raise exception 'Reference favorites must only be accessed through authenticated server queries'; end if;
 if has_table_privilege('anon','public.explore_campaigns','UPDATE') then raise exception 'Campaign management exposed'; end if;
end $$;
rollback;
