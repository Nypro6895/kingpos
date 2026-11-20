// Local, disposable Supabase fixture. Never points at the linked database.
import fs from 'node:fs';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {startIsolatedSupabase} from '../tests/helpers/isolated-supabase-fixture.mjs';
process.env.BOOKING_TEST_OUTPUT_DIR='artifacts/review-experience-flow-20261029/isolated';
const fixture=await startIsolatedSupabase('review-flow',JSON.parse(process.env.TEST_SUPABASE_IMAGES||'{}'));
let gateway,closing=false;
function close(){if(closing)return;closing=true;gateway?.close();fixture.close();process.exit();}
process.on('SIGINT',close);process.on('SIGTERM',close);
process.on('uncaughtException',error=>{console.error(fixture.redact(error.message));close();});
// Signup admission is outside this review test; this changes the disposable DB only.
fixture.sql('update public.abuse_system_settings set enforce_signup_tickets=false where id;');
const customer=fixture.person('review-customer'),owner=fixture.person('review-owner'),outsider=fixture.person('review-outsider');
const account=randomUUID(),salon=randomUUID(),customerId=randomUUID(),ticket=randomUUID();
fixture.sql(`begin;insert into accounts(id,name,status) values('${account}','Review isolated QA','active');
insert into locations(id,account_id,name,status) values('${salon}','${account}','Review Flow QA Salon','active');
insert into salon_settings(salon_id,business_name,public_discovery_enabled) values('${salon}','Review Flow QA Salon',true);
insert into roles(account_id,name,code,is_system) values('${account}','Owner','OWNER',true);
insert into salon_memberships(account_id,salon_id,user_id,role_id,status) select '${account}','${salon}','${owner.profileId}',id,'active' from roles where account_id='${account}' and upper(code)='OWNER' limit 1;
insert into customers(id,location_id,name,customer_user_id) values('${customerId}','${salon}','Independent QA Customer','${customer.profileId}');
insert into pos_tickets(id,salon_id,customer_id,ticket_number,ticket_sequence,status,opened_at,closed_at) values('${ticket}','${salon}','${customerId}','QA-REVIEW-1',1,'closed',now()-interval '1 day',now()-interval '1 day');
insert into pos_ticket_items(salon_id,pos_ticket_id,service_name_snapshot,quantity,unit_price,line_total) values('${salon}','${ticket}','QA Pedicure',1,40,40);commit;`);
fs.writeFileSync('artifacts/review-experience-flow-20261029/isolated-ids.json',JSON.stringify({salon,ticket,customer:customer.profileId,owner:owner.profileId,outsider:outsider.profileId},null,2));
const origin=process.env.REVIEW_QA_ORIGIN||'http://192.168.1.209:3117';
// This ignored env file contains only disposable fixture configuration.
fs.writeFileSync('.env.local',`NEXT_PUBLIC_SUPABASE_URL=${origin.replace(':3117',':54339')}\nNEXT_PUBLIC_SUPABASE_ANON_KEY=isolated-review-fixture\n`);
const sessions={customer,owner,outsider};
gateway=http.createServer(async(req,res)=>{
 try {
  const url=new URL(req.url,'http://fixture.local');
  if(url.pathname==='/qa-login'){
   const session=sessions[url.searchParams.get('as')||'customer'];if(!session){res.writeHead(400);res.end();return;}
   const next=url.searchParams.get('next')||'/activity';
   res.writeHead(302,{'Set-Cookie':[`sb-access-token=${session.token}; Path=/; HttpOnly; SameSite=Lax`,'sb-refresh-token=; Path=/; Max-Age=0',`kingpos-current-manage-salon-id=${salon}; Path=/; SameSite=Lax`,`kingpos-selected-workspace=${session===owner?`manage:${salon}`:'personal'}; Path=/; SameSite=Lax`],Location:origin+(next.startsWith('/')&&!next.startsWith('//')?next:'/activity')});res.end();return;
  }
  const buffers=[];for await(const part of req)buffers.push(part);const raw=Buffer.concat(buffers).toString();
  const path=url.pathname.startsWith('/rest/v1')?req.url.slice('/rest/v1'.length):url.pathname.startsWith('/auth/v1')?req.url.slice('/auth/v1'.length):null;
  if(path===null){res.writeHead(404);res.end();return;}
  const port=url.pathname.startsWith('/auth/v1')?9999:3000;
  const token=req.headers.authorization?.replace(/^Bearer /i,'');
  const result=fixture.http(port,path,req.method,raw?JSON.parse(raw):undefined,token==='isolated-review-fixture'?undefined:token,
   ['Prefer: return=representation']);
  res.writeHead(result.status,{'Content-Type':'application/json','Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info'});res.end(JSON.stringify(result.data));
 }catch(error){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({message:fixture.redact(error.message).slice(0,200)}));}
});
gateway.listen(54339,'0.0.0.0',()=>console.log('Isolated review fixture ready; synthetic accounts only.'));
