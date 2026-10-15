begin;
do $$
declare ad1 uuid:='94000000-0000-4000-8000-000000000001'; ad2 uuid:='94000000-0000-4000-8000-000000000002'; ad3 uuid:='94000000-0000-4000-8000-000000000003'; sess uuid:='94000000-0000-4000-8000-000000000004'; user1 uuid:='94000000-0000-4000-8000-000000000005'; n integer;
begin
 insert into explore_campaigns(id,config) values(ad1,'{"name":"Fixture placement","kind":"placement","enabled":true}'),(ad2,'{"name":"Fixture popup","kind":"popup","enabled":true,"repeat":"always"}'),(ad3,'{"name":"Fixture extra","kind":"popup","enabled":true,"repeat":"always"}');
 update advertising_settings set config='{"maxTotal":2,"maxPopups":1,"minPopupGapSeconds":60,"sessionMinutes":30}' where id=true;
 if record_advertising_event(ad1,sess,'click','mobile','guest','/explore') then raise exception 'Click before view must fail'; end if;
 if not record_advertising_event(ad1,sess,'view','mobile','guest','/explore') then raise exception 'First impression rejected'; end if;
 if record_advertising_event(ad1,sess,'view','mobile','guest','/explore') then raise exception 'Duplicate impression accepted'; end if;
 if not record_advertising_event(ad2,sess,'view','mobile','guest','/explore','fixture-hash') then raise exception 'First popup rejected'; end if;
 if record_advertising_event(ad3,sess,'view','mobile','guest','/explore','fixture-hash') then raise exception 'Session limit ignored'; end if;
 update advertising_settings set config=jsonb_set(config,'{maxTotal}','10');
 if record_advertising_event(ad3,sess,'view','mobile','guest','/explore','fixture-hash') then raise exception 'Popup limit ignored'; end if;
 if not record_advertising_event(ad1,sess,'click','mobile','guest','/explore') then raise exception 'Click rejected'; end if;
 perform record_advertising_event(ad1,sess,'click','mobile','guest','/explore');
 if not record_advertising_event(ad1,sess,'signup','mobile','guest','/explore',null,user1) then raise exception 'Signup rejected'; end if;
 perform record_advertising_event(ad1,sess,'signup','mobile','guest','/explore',null,user1);
 select count(*) into n from advertising_events where session_id=sess;
 if n<>4 then raise exception 'Expected 2 views, 1 click, 1 signup; got %',n; end if;
 select sum(signups) into n from advertising_report(7) where campaign_id=ad1;
 if n<>1 then raise exception 'Report signup aggregate incorrect'; end if;
 if has_table_privilege('anon','advertising_events','INSERT') or has_function_privilege('authenticated','record_advertising_event(uuid,uuid,text,text,text,text,text,uuid)','EXECUTE') then raise exception 'Public tracking bypass'; end if;
 delete from explore_campaigns where id=ad1;
 if not exists(select 1 from advertising_events where campaign_id=ad1) then raise exception 'Campaign deletion erased report history'; end if;
 if not record_advertising_event(ad1,sess,'signup','mobile','guest','/explore',null,'94000000-0000-4000-8000-000000000006') then raise exception 'Deleted campaign lost delayed conversion'; end if;
 select sum(signups) into n from advertising_report(7) where campaign_id=ad1;
 if n<>2 then raise exception 'New accounts must count distinct genuine users'; end if;
end $$;
rollback;
