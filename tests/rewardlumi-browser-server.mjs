import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import {build} from 'esbuild';
import {startIsolatedSupabase} from './helpers/isolated-supabase-fixture.mjs';
const dir=path.resolve('artifacts/rewardlumi/browser');fs.mkdirSync(dir,{recursive:true});
await build({entryPoints:['tests/helpers/rewardlumi-ui-entry.tsx'],bundle:true,format:'esm',target:'es2022',jsx:'automatic',outfile:path.join(dir,'app.js'),plugins:[{name:'test-next-link',setup(b){b.onResolve({filter:/^next\/link$/},()=>({path:'link',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'import React from "react"; export default function Link({children,...p}){return React.createElement("a",p,children)}',resolveDir:process.cwd(),loader:'js'}));}}]});
const f=await startIsolatedSupabase('reward-browser',JSON.parse(process.env.TEST_SUPABASE_IMAGES||'{}'));
const uuid=()=>crypto.randomUUID(),owner=f.person('browser-owner'),customer=f.person('browser-customer');
const account=f.rpc(owner,'ensure_personal_account_for_current_user',{p_account_name:'Rewards QA'})[0].account_id;
const salon=f.rpc(owner,'create_account_salon_with_owner_staff',{p_account_id:account,p_create_request_key:uuid(),p_name:'Lumi Nail Studio',p_owner_is_staff:false,p_phone:null,p_address_line1:null,p_address_line2:null,p_city:null,p_state:null,p_postal_code:null,p_country:'US'}).salon_id;
const program={enabled:true,nearby:true,spendCents:2000,spendPoints:20,welcomePoints:10,firstBookingPoints:20,visitPoints:0,conversionPoints:30,offers:[{id:'five-off',title:'$5 off',points:100,valueCents:500,minimumCents:4000}]};
f.rpc(owner,'reward_owner',{p_salon:salon,p_op:'save',p_args:{program}});
f.rpc(owner,'gift_card_owner',{p_salon:salon,p_op:'install',p_args:{installed:true}});
const cust=uuid(),visit=uuid(),staff=uuid(),service=uuid();
f.sql(`insert into customers(id,location_id,name,customer_user_id) values('${cust}','${salon}','Sophia Lee','${customer.profileId}');insert into customer_visits(id,salon_id,customer_id,origin_metadata) values('${visit}','${salon}','${cust}','{"token":"reward-qa-display"}');insert into staff(id,salon_id,display_name) values('${staff}','${salon}','Mia');insert into services(id,salon_id,name,base_price) values('${service}','${salon}','Manicure',60);insert into pos_live_drafts(salon_id,token,customer) values('${salon}','reward-qa-display','{"id":"${cust}","name":"Sophia Lee"}');select reward_join('${salon}','${customer.profileId}');insert into reward_ledger(salon_id,user_id,delta,reason,event_key) values('${salon}','${customer.profileId}',150,'Prior paid visits','browser-seed');select gift_card_issue('${salon}',10000,'${customer.profileId}','${uuid()}');`);
const receipt={customerId:cust,customerVisitId:visit,customerName:'Sophia Lee',discountType:'fixed_amount',discountValue:0,tipAmount:0,liveDraftToken:'reward-qa-display',lines:[{staffId:staff,serviceId:service,serviceLabel:'Manicure',total:60,amountInput:'60',amountParts:[60]}]};
const checkoutId=uuid();
if(process.env.REWARD_QA_SEED_REPORT==='1'){
 const who=f.person('report-history'),cid=uuid(),vid=uuid();
 f.sql(`insert into customers(id,location_id,name,customer_user_id) values('${cid}','${salon}','Synthetic report guest','${who.profileId}');insert into customer_visits(id,salon_id,customer_id) values('${vid}','${salon}','${cid}');select reward_join('${salon}','${who.profileId}');insert into reward_ledger(salon_id,user_id,delta,reason,event_key) values('${salon}','${who.profileId}',100,'Synthetic report opening balance','report-ui-seed');`);
 const draft={...receipt,customerId:cid,customerVisitId:vid,liveDraftToken:undefined};
 f.rpc(who,'reward_personal',{p_op:'request',p_args:{visitId:vid,offerId:'five-off',consent:true}});
 const quote=f.rpc(owner,'reward_pos',{p_salon:salon,p_op:'quote',p_args:{receipt:draft,token:'report-ui'}});draft.rewardQuote=quote.view.request.quote;
 f.rpc(owner,'reward_submit_owner',{p_salon:salon,p_request:uuid(),p_receipt:draft});
}
const css=`*{box-sizing:border-box}body{margin:0;background:#faf8f5;font:15px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#252525}header{padding:18px 22px;background:white;border-bottom:1px solid #e8e2db;display:flex;justify-content:space-between;gap:12px}header b{font-size:24px;color:#ea672f}header span{font-size:11px;color:#81736b}nav{display:flex;gap:8px;overflow:auto;padding:12px;background:white}nav a{white-space:nowrap;padding:10px;border-radius:8px;color:#60574e;text-decoration:none;font-size:13px}nav a[aria-current]{background:#fff0e2;color:#b64b1d}.qa-personal{max-width:470px;margin:auto;padding:16px;display:grid;gap:14px}.qa-pos{max-width:950px;margin:auto;padding:24px;display:grid;gap:16px}.qa-visit{background:white;border:1px solid #e7dfd6;border-radius:12px;padding:18px}.qa-visit h1{font-size:23px}.qa-visit h2{font-size:20px}.qa-badge{background:#e9f6ee;color:#28705c;padding:6px 10px;border-radius:20px;font-size:12px}.qa-total{display:flex;justify-content:space-between;border-top:1px solid #eee;padding-top:16px}.qa-note{font-size:12px;color:#73675f;line-height:1.5}.qa-visit button{min-height:48px;background:#ef6c32;color:white;border:0;border-radius:8px;padding:12px 20px;font-weight:650}button{font-family:inherit}button:disabled{opacity:.5}p[role=alert]{color:#a12d20}.gc-sticky{position:static!important;margin-top:16px}`;
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://fixture');
  if(url.pathname.startsWith('/rest/v1/') || url.pathname.startsWith('/auth/v1/') || url.pathname.startsWith('/storage/v1/')) {
   const auth=req.headers.authorization?.replace(/^Bearer /,'');
   const token=auth?.split('.').length===3?auth:undefined;
   const isAuth=url.pathname.startsWith('/auth/v1/'),isStorage=url.pathname.startsWith('/storage/v1/');
   const prefix=isAuth?'/auth/v1':isStorage?'/storage/v1':'/rest/v1';
   let raw='';for await(const c of req)raw+=c;
   const extra=['prefer','accept','range'].filter(k=>req.headers[k]).map(k=>k+': '+req.headers[k]);
   const response=f.http(isAuth?9999:isStorage?5000:3000,url.pathname.slice(prefix.length)+url.search,req.method,raw?JSON.parse(raw):undefined,token,extra);
   res.statusCode=response.status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(response.data));return;
  }
  if(url.pathname==='/login-fixture') {
   const who=url.searchParams.get('role')==='owner'?owner:customer;
   const workspace=who===owner?'manage:'+salon:'personal';
   res.setHeader('Set-Cookie',[`sb-access-token=${who.token}; Path=/; HttpOnly; SameSite=Lax`,`kingpos-selected-workspace=${workspace}; Path=/; SameSite=Lax`,`kingpos-current-manage-salon-id=${salon}; Path=/; SameSite=Lax`,`kingpos-current-account-id=${account}; Path=/; SameSite=Lax`]);
   res.statusCode=302;res.setHeader('Location',`http://${req.headers.host.split(':')[0]}:4080${who===owner?'/reward-system':'/qr'}`);res.end();return;
  }
  if(req.method==='POST'&&url.pathname.startsWith('/screenshots/')){const name=path.basename(url.pathname);if(!/^[a-z0-9-]+\.png$/.test(name))throw Error('Invalid artifact');const chunks=[];for await(const c of req)chunks.push(c);fs.writeFileSync(path.join(dir,name),Buffer.concat(chunks));res.end('saved');return;}
  if(req.method==='POST'&&url.pathname==='/command'){
   let body='';for await(const c of req)body+=c;const {scope,op,args={}}=JSON.parse(body);let result;
   if(scope==='owner')result=op==='report'?f.rpc(owner,'reward_owner_report',{p_salon:salon,p_day:args.day||null}):f.rpc(owner,'reward_owner',{p_salon:salon,p_op:op,p_args:args});
   else if(scope==='personal')result=f.rpc(customer,'reward_personal',{p_op:op,p_args:args});
   else if(scope==='display')result=f.rpc(null,'reward_display',{p_token:'reward-qa-display',p_op:op,p_args:args});
   else if(scope==='pos')result=f.rpc(owner,'reward_pos',{p_salon:salon,p_op:op,p_args:args});
   else if(scope==='gift-pos')result=f.rpc(owner,'gift_card_pos',{p_salon:salon,p_op:op,p_args:args});
   else if(scope==='gift-display')result=f.rpc(null,'gift_card_display',{p_token:'reward-qa-display',p_op:op,p_args:args});
   else if(scope==='checkout')result=f.rpc(owner,'reward_submit_owner',{p_salon:salon,p_request:checkoutId,p_receipt:receipt});
   else throw Error('Unknown test actor');
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));return;
  }
  if(url.pathname==='/fixture'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({visitId:visit,receipt,dbName:f.evidence.containers.db}));return;}
  if(url.pathname==='/app.js'||url.pathname==='/app.css'){res.setHeader('Content-Type',url.pathname.endsWith('.js')?'text/javascript':'text/css');res.end(fs.readFileSync(path.join(dir,url.pathname.slice(1))));return;}
  res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Rewardlumi isolated QA</title><link rel="stylesheet" href="/app.css"><style>${css}</style></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`);
 }catch(e){res.statusCode=400;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:f.redact(e.message)}));}
});
const port=Number(process.env.REWARD_BROWSER_PORT||4077);
server.listen(port,'127.0.0.1',()=>console.log('REWARD_BROWSER_READY http://localhost:'+port));
async function close(){server.close();f.close();process.exit(0)}process.on('SIGINT',close);process.on('SIGTERM',close);
process.on('message',message=>{if(message?.type==='close-owned-fixture')void close();});
