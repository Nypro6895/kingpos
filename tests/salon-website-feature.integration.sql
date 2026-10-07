begin;
do $$
declare auth_id uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); other_user uuid:=gen_random_uuid(); other_auth uuid:=gen_random_uuid(); account uuid:=gen_random_uuid(); salon uuid:=gen_random_uuid(); owner_role uuid:=gen_random_uuid(); first_look uuid:=gen_random_uuid(); popular_look uuid:=gen_random_uuid(); foreign_look uuid:=gen_random_uuid(); draft_look uuid:=gen_random_uuid(); selected uuid;
begin
 insert into auth.users(id,email) values(auth_id,auth_id::text||'@example.test');
 insert into public.users(id,auth_user_id) values(actor,auth_id);
 insert into auth.users(id,email) values(other_auth,other_auth::text||'@example.test');
 insert into public.users(id,auth_user_id) values(other_user,other_auth);
 insert into public.accounts(id,name) values(account,'Website selection test');
 insert into public.locations(id,account_id,name) values(salon,account,'Website selection salon');
 insert into public.salon_settings(salon_id,business_name,public_discovery_enabled) values(salon,'Website selection salon',true);
 insert into public.roles(id,account_id,name,code) values(owner_role,account,'Owner','OWNER');
 insert into public.account_memberships(account_id,user_id,role_id,status) values(account,actor,owner_role,'active');
 insert into public.salon_profile_looks(id,salon_id,title,media_path,status,published_at,author_user_id,created_by_user_id) values
 (first_look,salon,'First work','fixture-first.jpg','published',now()-interval '10 days',actor,actor),
 (popular_look,salon,'Popular work','fixture-popular.jpg','published',now()-interval '5 days',actor,actor),
 (foreign_look,salon,'Another author','fixture-other.jpg','published',now()-interval '3 days',other_user,other_user),
 (draft_look,salon,'Draft','fixture-draft.jpg','draft',null,actor,actor);
 perform set_config('request.jwt.claim.sub',auth_id::text,true);
 insert into public.salon_profile_look_saves(look_id,user_id) values(popular_look,actor);
 selected:=public.get_public_salon_website_featured_look(salon);
 if selected is distinct from popular_look then raise exception 'Engagement did not determine the automatic photo'; end if;
 insert into public.salon_profile_comments(salon_id,look_id,author_user_id,body,status) values(salon,first_look,actor,'One','published'),(salon,first_look,actor,'Two','published');
 if public.get_public_salon_website_featured_look(salon) is distinct from popular_look then raise exception 'Automatic photo changed within the day'; end if;
 update public.salon_website_feature_selection set selected_day=current_date-1 where salon_id=salon;
 if public.get_public_salon_website_featured_look(salon) is distinct from first_look then raise exception 'Daily selection did not refresh'; end if;
 set local role authenticated;
 begin
  perform public.set_owned_salon_featured_look(salon,foreign_look,true);
  raise exception 'Owner featured another user photo';
 exception when insufficient_privilege then null; end;
 begin
  perform public.set_owned_salon_featured_look(salon,draft_look,true);
  raise exception 'Draft was featured';
 exception when raise_exception then if sqlerrm='Draft was featured' then raise; end if; end;
 perform public.set_owned_salon_featured_look(salon,popular_look,true);
 if public.get_public_salon_website_featured_look(salon) is distinct from popular_look then raise exception 'Manual choice did not override automatic choice'; end if;
 perform public.set_owned_salon_featured_look(salon,popular_look,false);
 if public.get_public_salon_website_featured_look(salon) is distinct from first_look then raise exception 'Removing manual selection did not restore automatic choice'; end if;
 reset role;
 perform set_config('request.jwt.claim.sub',other_auth::text,true);
 set local role authenticated;
 begin
  perform public.set_owned_salon_featured_look(salon,foreign_look,true);
  raise exception 'Non-owner featured a photo';
 exception when insufficient_privilege then null; end;
 reset role;
 perform set_config('request.jwt.claim.sub',auth_id::text,true);
 update public.salon_profile_looks set status='archived' where id=first_look;
 if public.get_public_salon_website_featured_look(salon)=first_look then raise exception 'Archived photo remained selected'; end if;
 update public.salon_settings set public_discovery_enabled=false where salon_id=salon;
 set local role anon;
 if public.get_public_salon_website_featured_look(salon) is not null then raise exception 'Private profile exposed a featured photo'; end if;
 reset role;
end; $$;
rollback;
