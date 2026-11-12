import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {runtime,status,sql,writeJson,project} from './common.mjs';
const config=status();
const admin=createClient(config.API_URL,config.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
sql("create schema if not exists qa_private;revoke all on schema qa_private from public,anon,authenticated;create table if not exists qa_private.environment(id text primary key,created_at timestamptz default now());insert into qa_private.environment(id) values('reylumi-local-qa-v1') on conflict do nothing;");
const accessPath=path.join(runtime,'access.json');
if(fs.existsSync(accessPath)){
 const existing=JSON.parse(fs.readFileSync(accessPath));
 if(!existing.people.some(p=>p.role==='reviewer')){
  const reviewer=publicPerson(await person('reviewer'));
  sql(`insert into platform_admin_memberships(user_id,role_id,status) select '${reviewer.profileId}',id,'active' from platform_admin_roles where slug='platform_owner' on conflict do nothing;`);
  existing.people.push(reviewer);writeJson('access.json',existing);
 }
 console.log('Existing synthetic QA accounts preserved; local reviewer available.');process.exit(0);
}
async function call(client,name,args){const {data,error}=await client.rpc(name,args);if(error)throw Error(name+': '+error.message);return data;}
function publicPerson(person){return Object.fromEntries(Object.entries(person).filter(([key])=>key!=='client'));}
async function person(role){
 const email=role+'@qa.reylumi.invalid',password='Qa!'+crypto.randomBytes(18).toString('hex');
 let created=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{display_name:'QA '+role,first_name:'QA',last_name:role}});
 if(created.error){
  const listed=await admin.auth.admin.listUsers();const previous=listed.data?.users.find(u=>u.email===email);
  if(!previous)throw Error('QA user creation: '+created.error.message);
  created=await admin.auth.admin.updateUserById(previous.id,{password,email_confirm:true});
  if(created.error)throw created.error;
 }
 const client=createClient(config.API_URL,config.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const login=await client.auth.signInWithPassword({email,password});if(login.error)throw login.error;
 let row=await admin.from('users').select('id').eq('auth_user_id',created.data.user.id).maybeSingle();
 if(!row.data){row=await admin.from('users').insert({auth_user_id:created.data.user.id,email,display_name:'QA '+role,first_name:'QA',last_name:role,status:'active'}).select('id').single();}
 if(row.error)throw row.error;
 return {role,email,password,authId:created.data.user.id,profileId:row.data.id,client};
}
const owner=await person('owner'),staff=await person('staff'),customer=await person('customer'),other=await person('outsider'),reviewer=await person('reviewer');
sql(`insert into platform_admin_memberships(user_id,role_id,status) select '${reviewer.profileId}',id,'active' from platform_admin_roles where slug='platform_owner' on conflict do nothing;`);
const account=(await call(owner.client,'ensure_personal_account_for_current_user',{p_account_name:'QA ONLY — synthetic account'}))[0].account_id;
const salon=(await call(owner.client,'create_account_salon_with_owner_staff',{p_account_id:account,p_create_request_key:crypto.randomUUID(),p_name:'QA ONLY — Reylumi Test Salon',p_owner_is_staff:true,p_phone:'+12025550101',p_address_line1:'100 QA Test Lane',p_city:'Milwaukee',p_state:'WI',p_postal_code:'53202',p_country:'US'})).salon_id;
const service=crypto.randomUUID(),staffId=crypto.randomUUID(),customerId=crypto.randomUUID();
sql(`begin;
 update locations set latitude=43.0389,longitude=-87.9065 where id='${salon}';
 update salon_settings set public_discovery_enabled=true,public_discovery_published_at=now(),operating_timezone_iana='America/Chicago' where salon_id='${salon}';
 update pos_settings set staff_check_in_enabled=false where salon_id='${salon}';
 insert into salon_memberships(account_id,salon_id,user_id,role_id,status) select '${account}','${salon}','${staff.profileId}',id,'active' from roles where account_id='${account}' and code='STAFF';
 insert into staff(id,salon_id,user_id,account_user_id,display_name,email,is_active,pos_enabled) values('${staffId}','${salon}','${staff.profileId}','${staff.profileId}','QA Staff','${staff.email}',true,true);
 update staff set is_active=true,pos_enabled=true where salon_id='${salon}';
 insert into services(id,salon_id,name,category,base_price) values('${service}','${salon}','QA Manicure — test only','Nails',50);
 insert into customers(id,location_id,customer_user_id,name,email,source) values('${customerId}','${salon}','${customer.profileId}','QA Customer','${customer.email}','manual');
 insert into gift_card_settings(salon_id,installed,stripe_account) values('${salon}',true,'acct_qa_local') on conflict(salon_id) do update set installed=true,stripe_account='acct_qa_local';
 insert into campaign_wallets(salon_id,installed,available_credits,welcome_credits) values('${salon}',true,5000,5000) on conflict(salon_id) do nothing;
 commit;`);
await call(owner.client,'reward_owner',{p_salon:salon,p_op:'save',p_args:{program:{enabled:true,nearby:true,spendCents:2000,spendPoints:20,welcomePoints:10,firstBookingPoints:20,visitPoints:0,conversionPoints:30,offers:[{id:'qa-five-off',title:'QA $5 off',points:100,valueCents:500,minimumCents:4000}]},expectedVersion:0}});
sql(`select reward_join('${salon}','${customer.profileId}');insert into reward_ledger(salon_id,user_id,delta,reason,event_key) values('${salon}','${customer.profileId}',200,'Local QA synthetic seed','qa-seed-v1') on conflict do nothing;`);
const people=[owner,staff,customer,other,reviewer].map(publicPerson);
writeJson('access.json',{project,people,account,salon,service,staffId,customerId,createdAt:new Date().toISOString()});
console.log('Seeded five synthetic accounts including a local reviewer, isolated salon, service, customer, reward balance, gift setup and campaign credits.');
