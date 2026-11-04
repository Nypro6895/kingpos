import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {randomBytes} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {createPostgresStore} from '../examples/qr-menu/postgres-store.mjs';
import {createQrMenuApp} from '../examples/qr-menu/server.mjs';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const binding={api:'https://api.example.test',clientId:id(1),publicOrigin:'https://menu.example.test'};
const schema=readFileSync('examples/qr-menu/storage.sql','utf8');
async function fixture(t){const db=new PGlite();await db.exec(schema);t.after(()=>db.close());const key=randomBytes(32);const make=(extra={})=>createPostgresStore({query:(q,p)=>db.query(q,p),keys:{test:key},activeKeyId:'test',binding,...extra});return {db,key,make};}

test('durable adapter refuses missing security and hosted Map/fake/wrong-app adapters',async t=>{
 const {make}=await fixture(t);
 assert.throws(()=>createPostgresStore({query:()=>{},binding,keys:{test:Buffer.alloc(4)},activeKeyId:'test'}),/32-byte/);
 const options={...binding,clientSecret:'rmc_'+'s'.repeat(43)};
 assert.throws(()=>createQrMenuApp(options),/Hosted runtime/);
 assert.throws(()=>createQrMenuApp({...options,store:{run(){}}}),/exact API/);
 assert.throws(()=>createQrMenuApp({...options,store:make({binding:{...binding,clientId:id(9)}})}),/exact API/);
 assert.throws(()=>createQrMenuApp({...options,store:make(),secureCookie:false,ownerIdentity:()=>id(2)}),/Hosted runtime/);
 assert.throws(()=>createQrMenuApp({...options,store:make()}),/ownerIdentity/);
});

test('actual PostgreSQL SQL: two independent adapters contend, fence expired owners, preserve ciphertext and recover ambiguous refresh',async t=>{
 const {db,make}=await fixture(t),a=make(),b=make();
 let release,entered;const gate=new Promise(r=>release=r),ready=new Promise(r=>entered=r);
 const first=a.run(async(state,save)=>{state.sessions.push(['opaque-cookie',{verifier:'synthetic-pkce',state:'synthetic-state'}]);state.menus.push([id(10),{installation:id(3),salonId:id(4),versionId:id(5),grant:{access_token:'synthetic-access',refresh_token:'synthetic-refresh'}}]);await save();entered();await gate;});
 await ready;await assert.rejects(b.run(()=>{}),/unavailable/);release();await first;
 const row=(await db.query('select envelope from qr_menu_private.qr_menu_state')).rows[0];
 for(const secret of ['synthetic-pkce','synthetic-state','synthetic-access','synthetic-refresh','opaque-cookie'])assert.equal(JSON.stringify(row).includes(secret),false,'encrypted state must not contain plaintext');
 await b.run(async state=>{assert.equal(state.menus[0][1].installation,id(3));state.menus[0][1].refreshUncertain=true;});
 await a.run(async state=>{assert.equal(state.menus[0][1].grant,null);assert.equal(state.menus[0][1].reconnectRequired,true);assert.equal(state.menus[0][1].salonId,id(4));});
 // Old instance cannot commit after another worker takes its expired lease.
 let wake,leased;const paused=new Promise(r=>wake=r),owned=new Promise(r=>leased=r);
 const stale=a.run(async(state,save)=>{state.sessions=[];leased();await paused;await save();});
 await owned;await db.exec("update qr_menu_private.qr_menu_state set lease_until=clock_timestamp()-interval '1 second'");
 await b.run(async state=>{state.sessions.push(['survivor',{menu:id(10)}]);});wake();await assert.rejects(stale,/unavailable/);
 await b.run(async state=>assert.equal(state.sessions.at(-1)[0],'survivor'));
});

test('durable encryption authenticates binding, ciphertext, revision and key; supports key-ring rotation',async t=>{
 const {db,make,key}=await fixture(t),a=make();await a.run(async state=>state.sessions.push(['one',{expires:1}]));
 const original=(await db.query('select * from qr_menu_private.qr_menu_state')).rows[0];
 const wrong=make({keys:{test:randomBytes(32)}});await assert.rejects(wrong.run(()=>{}),/unavailable/);
 await db.exec('update qr_menu_private.qr_menu_state set revision=revision+1');await assert.rejects(a.run(()=>{}),/unavailable/);
 await db.query('update qr_menu_private.qr_menu_state set revision=$1',[original.revision]);
 const changed=Buffer.from(original.envelope.data,'base64url');changed[0]^=1;const tampered={...original.envelope,data:changed.toString('base64url')};await db.query('update qr_menu_private.qr_menu_state set envelope=$1::jsonb',[JSON.stringify(tampered)]);await assert.rejects(a.run(()=>{}),/unavailable/);
 await db.query('update qr_menu_private.qr_menu_state set envelope=$1::jsonb',[JSON.stringify(original.envelope)]);
 const next=randomBytes(32),rotated=make({keys:{test:key,next},activeKeyId:'next'});await rotated.run(async state=>assert.equal(state.sessions[0][0],'one'));
 assert.equal((await db.query('select envelope from qr_menu_private.qr_menu_state')).rows[0].envelope.keyId,'next');
 await assert.rejects(a.run(()=>{}),/unavailable/);
 const other=make({binding:{...binding,clientId:id(99)}});await other.run(async state=>assert.equal(state.sessions.length,0));
});

test('filesystem SQL fixture closes and reopens: independent instance reads encrypted sessions and stable public IDs',async t=>{
 const folder=mkdtempSync(join(tmpdir(),'reylumi-qr-durable-')),key=randomBytes(32);let db;
 t.after(async()=>{if(db&&!db.closed)await db.close();const absolute=resolve(folder);assert.ok(absolute.startsWith(resolve(tmpdir())+sep)&&absolute.includes('reylumi-qr-durable-'));rmSync(absolute,{recursive:true,force:true});});
 const make=()=>createPostgresStore({query:(q,p)=>db.query(q,p),keys:{test:key},activeKeyId:'test',binding});
 db=new PGlite(folder);await db.exec(schema);await make().run(async state=>{state.byInstallation.push([id(3),id(10)]);state.sessions.push(['pending',{verifier:'only-in-ciphertext',expires:Date.now()+60000}]);});await db.close();
 db=new PGlite(folder);await make().run(async state=>{assert.equal(state.byInstallation[0][1],id(10));assert.equal(state.sessions[0][1].verifier,'only-in-ciphertext');});
});

test('real HTTP on two instances: durable PKCE, replay rejection, refresh serialization, restart and principal/tenant/version isolation',async t=>{
 const {db,make}=await fixture(t);let tokenCalls=0,refreshCalls=0,expired=false,deny=false,revoked=false,subject='synthetic-owner',salon=id(4),version=id(5);
 const access='rmp_'+ 'a'.repeat(43),next='rmp_'+'b'.repeat(43),refresh='rmr_'+'r'.repeat(43);
 const receipts=new Map(),attempts=[];let currentRefresh=refresh;
 const fetcher=async(url,options)=>{
  if(url.endsWith('/token')){
   const body=JSON.parse(options.body);tokenCalls++;
   if(body.grant_type==='refresh_token'){if(revoked)return Response.json({},{status:403});attempts.push({id:body.request_id,key:body.retry_key,token:body.refresh_token});assert.match(body.request_id,/^[a-f0-9-]{36}$/);assert.match(body.retry_key,/^rmk_[A-Za-z0-9_-]{43}$/);if(receipts.has(body.request_id)){const saved=receipts.get(body.request_id);assert.equal(saved.key,body.retry_key);assert.equal(saved.old,body.refresh_token);return Response.json(saved.grant);}refreshCalls++;await new Promise(r=>setTimeout(r,35));assert.equal(body.refresh_token,currentRefresh);const grant={access_token:next,refresh_token:'rmr_'+randomBytes(32).toString('base64url'),refresh_expires_at:new Date(Date.now()+86400000).toISOString()};receipts.set(body.request_id,{key:body.retry_key,old:body.refresh_token,grant});currentRefresh=grant.refresh_token;expired=false;if(deny){deny=false;throw Error('simulated lost response after committed rotation');}return Response.json(grant);}
   return Response.json({access_token:access,refresh_token:refresh,refresh_expires_at:new Date(Date.now()+86400000).toISOString()});
  }
  if(expired||revoked)return Response.json({}, {status:403});
  const group=url.split('/').at(-1);
  const data={profile:{displayName:'Synthetic salon',hours:[],brandColor:'#145946',timezone:'UTC'},services:{services:[]},media:{images:[]},content:{entries:[]}}[group];
  return Response.json({schemaVersion:1,group,installationId:id(3),salonId:salon,versionId:version,revision:1,synthetic:false,data});
 };
 const servers=[];const start=async()=>{const app=createQrMenuApp({...binding,clientSecret:'rmc_'+'s'.repeat(43),store:make(),ownerIdentity:async()=>subject,fetcher});await new Promise(r=>app.listen(0,'127.0.0.1',r));servers.push(app);return 'http://127.0.0.1:'+app.address().port;};
 t.after(async()=>{for(const app of servers)if(app.listening)await new Promise(r=>app.close(r));});
 const a=await start(),b=await start();
 const launch='/connect?'+new URLSearchParams({reylumi_client_id:binding.clientId,reylumi_installation:id(3),reylumi_authorize_url:binding.api+'/api/market-platform/authorize'});
 const first=await fetch(a+launch,{redirect:'manual'});assert.equal(first.status,303);
 const cookie=first.headers.get('set-cookie').split(';')[0];assert.match(cookie,/^__Host-qr_owner=/);assert.match(first.headers.get('set-cookie'),/Secure/);
 const auth=new URL(first.headers.get('location'));assert.equal(auth.searchParams.get('code_challenge_method'),'S256');
 const callback='/connect?'+new URLSearchParams({state:auth.searchParams.get('state'),code:'rma_'+'c'.repeat(43)});
 assert.equal((await fetch(b+callback+'&state=wrong',{headers:{cookie:cookie.replace(/=.*/, '=wrong')},redirect:'manual'})).status,403);
 subject='wrong-owner';assert.equal((await fetch(b+callback,{headers:{cookie},redirect:'manual'})).status,403);assert.equal(tokenCalls,0);subject='synthetic-owner';
 const done=await fetch(b+callback,{headers:{cookie},redirect:'manual'});assert.equal(done.status,303);assert.equal(tokenCalls,1);
 assert.equal((await fetch(a+callback,{headers:{cookie},redirect:'manual'})).status,403);assert.equal(tokenCalls,1);
 let manage=await fetch(a+'/manage',{headers:{cookie}});assert.equal(manage.status,200);let html=await manage.text();const menu=html.match(/\/menu\/([a-f0-9-]{36})/)[0];assert.ok(menu);
 for(const raw of [access,refresh,auth.searchParams.get('state')])assert.equal(html.includes(raw),false);
 await new Promise(r=>servers[0].close(r));const c=await start();assert.equal((await fetch(c+menu)).status,200);assert.equal((await fetch(c+'/manage',{headers:{cookie}})).status,200);
 // Two pending connects cannot overwrite a newly completed generation.
 const reconnect=await fetch(b+launch,{redirect:'manual'}),staleLaunch=await fetch(c+launch,{redirect:'manual'});
 const reconnectCookie=reconnect.headers.get('set-cookie').split(';')[0],staleCookie=staleLaunch.headers.get('set-cookie').split(';')[0];
 const callbackFor=response=>'/connect?'+new URLSearchParams({state:new URL(response.headers.get('location')).searchParams.get('state'),code:'rma_'+'d'.repeat(43)});
 assert.equal((await fetch(c+callbackFor(reconnect),{headers:{cookie:reconnectCookie},redirect:'manual'})).status,303);
 const beforeStale=tokenCalls;assert.equal((await fetch(b+callbackFor(staleLaunch),{headers:{cookie:staleCookie},redirect:'manual'})).status,403);assert.equal(tokenCalls,beforeStale);
 assert.equal((await fetch(c+'/manage',{headers:{cookie}})).status,410);
 const newManage=await fetch(b+'/manage',{headers:{cookie:reconnectCookie}});assert.equal(newManage.status,200);assert.ok((await newManage.text()).includes(menu));
 let resumeRefresh,pendingEntered;const blockedRefresh=new Promise(r=>resumeRefresh=r),pendingReady=new Promise(r=>pendingEntered=r);const pendingWriter=make().run(async(state,save)=>{const record=state.menus.find(([publicId])=>menu.endsWith(publicId))[1];record.refreshUncertain=true;await save();pendingEntered();await blockedRefresh;delete record.refreshUncertain;});await pendingReady;try{const beforeCalls=tokenCalls;const pendingRead=await fetch(c+menu);assert.equal(pendingRead.status,503,'a committed uncertain marker under an active writer is temporary, not permanent 410');assert.equal(tokenCalls,beforeCalls);}finally{resumeRefresh();await pendingWriter;}assert.equal((await fetch(c+menu)).status,200);
 let releaseWriter,writerEntered;const held=new Promise(r=>releaseWriter=r),readyWriter=new Promise(r=>writerEntered=r);const writing=make().run(async()=>{writerEntered();await held;});await readyWriter;try{const before=(await db.query('select revision from qr_menu_private.qr_menu_state')).rows[0].revision;const reads=await Promise.all([fetch(b+menu),fetch(c+menu)]);assert.deepEqual(reads.map(r=>r.status),[200,200],'public reads do not contend on a global writer lease');assert.equal((await db.query('select revision from qr_menu_private.qr_menu_state')).rows[0].revision,before,'public reads never rewrite encrypted state');}finally{releaseWriter();await writing;}
 expired=true;const concurrent=await Promise.all([fetch(b+menu),fetch(c+menu)]);assert.ok(concurrent.every(r=>[200,503].includes(r.status)),JSON.stringify(concurrent.map(r=>r.status)));assert.ok(concurrent.some(r=>r.status===200));assert.equal(refreshCalls,1);assert.equal((await fetch(c+menu)).status,200);
 salon=id(88);assert.equal((await fetch(c+menu)).status,503);salon=id(4);version=id(99);assert.equal((await fetch(c+menu)).status,503);version=id(5);
 expired=true;deny=true;assert.equal((await fetch(c+menu)).status,503);const calls=refreshCalls;assert.equal((await fetch(b+menu)).status,200);assert.equal(refreshCalls,calls,'lost response retries the same committed pair without a second rotation');assert.deepEqual(attempts.at(-1),attempts.at(-2));revoked=true;assert.equal((await fetch(c+menu)).status,410);const revokedCalls=tokenCalls;assert.equal((await fetch(b+menu)).status,410);assert.equal(tokenCalls,revokedCalls,'a revoked connection does not retry a consumed grant');
 const raw=JSON.stringify((await db.query('select envelope from qr_menu_private.qr_menu_state')).rows);for(const secret of [access,refresh,cookie.split('=')[1],auth.searchParams.get('state')])assert.equal(raw.includes(secret),false);
});

test('durable callback consumption survives lost exchange response; expired state does not exchange',async t=>{
 const {make}=await fixture(t);let exchanges=0;
 const store=make();const cookie='pending-cookie';
 await store.run(async state=>state.sessions.push([cookie,{state:'pending-state',verifier:'pending-verifier',installation:id(3),expires:Date.now()+60000}]));
 const app=createQrMenuApp({api:binding.api,clientId:binding.clientId,publicOrigin:binding.publicOrigin,clientSecret:'rmc_'+'s'.repeat(43),store,ownerIdentity:async()=> 'owner',fetcher:async()=>{exchanges++;throw Error('response lost');}});
 // The authenticated hosted session's principal must match the host resolver.
 const {createHash}=await import('node:crypto');await store.run(async state=>state.sessions[0][1].principal=createHash('sha256').update('owner').digest('hex'));
 await new Promise(r=>app.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>app.close(r)));
 const base='http://127.0.0.1:'+app.address().port,headers={cookie:'__Host-qr_owner='+cookie},url=base+'/connect?state=pending-state&code=rma_'+'x'.repeat(43);
 assert.equal((await fetch(url,{headers})).status,503);assert.equal(exchanges,1);assert.equal((await fetch(url,{headers})).status,403);assert.equal(exchanges,1);
 await store.run(async state=>state.sessions.push(['expired',{principal:createHash('sha256').update('owner').digest('hex'),state:'pending-state',verifier:'v',installation:id(3),expires:Date.now()-1}]));
 assert.equal((await fetch(url,{headers:{cookie:'__Host-qr_owner=expired'}})).status,403);assert.equal(exchanges,1);
});

test('SQL outage never flushes a launch redirect or owner cookie and never falls back to Map',async t=>{
 const {db,key}=await fixture(t);let unavailable=true;
 const store=createPostgresStore({binding,keys:{test:key},activeKeyId:'test',query:async(q,p)=>{if(unavailable&&q.includes('envelope=$4'))throw Error('synthetic SQL outage');return db.query(q,p);}});
 const app=createQrMenuApp({...binding,clientSecret:'rmc_'+'s'.repeat(43),store,ownerIdentity:async()=> 'owner',fetcher:async()=>{throw Error('No API call expected');}});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>app.close(r)));
 const launch='http://127.0.0.1:'+app.address().port+'/connect?'+new URLSearchParams({reylumi_client_id:binding.clientId,reylumi_installation:id(3),reylumi_authorize_url:binding.api+'/api/market-platform/authorize'});
 const failed=await fetch(launch,{redirect:'manual'});assert.equal(failed.status,503);assert.equal(failed.headers.get('location'),null);assert.equal(failed.headers.get('set-cookie'),null);
 unavailable=false;await store.run(async state=>assert.equal(state.sessions.length,0));
 assert.equal((await fetch(launch,{redirect:'manual'})).status,303);
});
