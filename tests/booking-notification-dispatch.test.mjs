import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {build}=require(process.env.ESBUILD_MODULE_PATH||'esbuild');

test('booking notification provider and worker capture never uses real credentials or network',async t=>{
  // Dedicated test process: all configuration is synthetic before modules load.
  process.env.NEXT_PUBLIC_SUPABASE_URL='http://fixture.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY='fixture-not-a-real-key';
  process.env.RESEND_API_KEY='fixture-not-a-real-key';
  process.env.BOOKING_EMAIL_FROM='sender@example.invalid';
  delete process.env.RESEND_FROM_EMAIL;delete process.env.STAFF_INVITE_EMAIL_FROM;
  const state={requests:[],updates:[],rpcCalls:[],queue:[],sms:null,reserved:true,claimError:null,updateError:null};
  globalThis.bookingDispatchFixture=state;
  state.client={rpc:async(name,args)=>{state.rpcCalls.push({name,args});return name==='claim_booking_messages'?{data:state.queue,error:state.claimError}:{data:state.reserved,error:null};},from:table=>({update:values=>{assert.equal(table,'booking_message_outbox');const filters=[];const query={eq(key,value){filters.push([key,value]);return this;},then(resolve){state.updates.push({values,filters});resolve({error:state.updateError});}};return query;}})};
  const stubs={
    'server-only':'',
    '@supabase/supabase-js':'export const createClient=()=>globalThis.bookingDispatchFixture.client;',
    '@/lib/booksms':'export const bookSmsConfig=async()=>globalThis.bookingDispatchFixture.sms;',
  };
  async function bundle(entry,extra={}){const all={...stubs,...extra};const compiled=await build({entryPoints:[entry],bundle:true,write:false,platform:'node',format:'cjs',plugins:[{name:'capture',setup(b){b.onResolve({filter:/^server-only$|^@supabase\/supabase-js$|^@\/lib\/(booksms|booking-notifications|notification-reminders)$/},args=>({path:args.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},args=>{assert.ok(args.path in all);return{contents:all[args.path]};});}}]});const m={exports:{}};new Function('require','module','exports',compiled.outputFiles[0].text)(require,m,m.exports);return m.exports;}
  const originalFetch=globalThis.fetch;
  let reply=()=>new Response(JSON.stringify({id:'fixture-provider'}),{status:200});
  globalThis.fetch=async(url,options)=>{state.requests.push({url:String(url),options});return reply();};
  const api=await bundle('lib/booking-notifications.ts');
  const email={id:'email-fixture',channel:'email',recipient:'recipient@example.invalid',message:'Fixture appointment requested.',salon_id:'salon-a',event_key:'pending:fixture'};
  const sms={...email,id:'sms-fixture',channel:'sms',recipient:'+15005550006'};
  const reset=()=>{state.requests=[];state.updates=[];state.rpcCalls=[];state.queue=[];state.claimError=null;state.updateError=null;state.sms=null;state.reserved=true;reply=()=>new Response(JSON.stringify({id:'fixture-provider'}),{status:200});};
  try{
    await t.test('unconfigured email does not issue any request',async()=>{reset();delete process.env.RESEND_API_KEY;assert.equal((await api.sendBookingMessage(email)).state,'unconfigured');assert.equal(state.requests.length,0);process.env.RESEND_API_KEY='fixture-not-a-real-key';});
    await t.test('email recipient, body and idempotency key are exact across retries',async()=>{reset();for(let i=0;i<2;i++)assert.deepEqual(await api.sendBookingMessage(email),{state:'accepted',provider_id:'fixture-provider'});assert.equal(state.requests.length,2);for(const r of state.requests){assert.equal(r.url,'https://api.resend.com/emails');assert.equal(r.options.headers['Idempotency-Key'],'booking-email-fixture');assert.deepEqual(JSON.parse(r.options.body),{from:'sender@example.invalid',to:email.recipient,subject:'Appointment update',text:email.message});}});
    await t.test('4xx rejects, 5xx/timeouts/malformed responses remain uncertain',async()=>{reset();for(const status of [400,401,403,429]){reply=()=>new Response('',{status});assert.equal((await api.sendBookingMessage(email)).state,'failed');}for(const scenario of [()=>new Response('',{status:503}),()=>{throw Error('Fixture timeout');},()=>new Response('not json',{status:200})]){reply=scenario;assert.equal((await api.sendBookingMessage(email)).state,'unknown');}});
    await t.test('invalid SMS and missing BookSMS configuration never reach provider',async()=>{reset();assert.equal((await api.sendBookingMessage({...sms,recipient:'555'})).state,'failed');assert.equal((await api.sendBookingMessage(sms)).state,'unconfigured');assert.equal(state.requests.length,0);assert.equal(state.rpcCalls.length,0);});
    await t.test('BookSMS allowance refusal prevents send and carries reminder context',async()=>{reset();state.sms={enabled:true,accountSid:'ACfixture',authToken:'fixture',from:'+15005550006'};state.reserved=false;assert.equal((await api.sendBookingMessage({...sms,event_key:'reminder:fixture'})).state,'unconfigured');assert.deepEqual(state.rpcCalls,[{name:'booksms_reserve_send',args:{p_salon:'salon-a',p_reminder:true}}]);assert.equal(state.requests.length,0);});
    await t.test('valid SMS goes only to the captured destination and preserves provider ID',async()=>{reset();state.sms={enabled:true,accountSid:'ACfixture',authToken:'fixture',messagingServiceSid:'MGfixture'};reply=()=>new Response(JSON.stringify({sid:'SMfixture'}),{status:201});assert.deepEqual(await api.sendBookingMessage(sms),{state:'accepted',provider_id:'SMfixture'});const r=state.requests[0];assert.equal(r.url,'https://api.twilio.com/2010-04-01/Accounts/ACfixture/Messages.json');assert.equal(r.options.body.get('To'),sms.recipient);assert.equal(r.options.body.get('Body'),sms.message);assert.equal(r.options.body.get('MessagingServiceSid'),'MGfixture');});
    await t.test('worker persists accepted/failed/unknown outcomes only for its claimed sending rows',async()=>{reset();state.queue=[email,{...email,id:'failed-fixture'},{...email,id:'unknown-fixture'}];let n=0;reply=()=>++n===1?new Response('{"id":"fixture-provider"}',{status:200}):n===2?new Response('',{status:400}):new Response('',{status:500});assert.deepEqual(await api.dispatchBookingMessages(),{configured:true,processed:3});assert.deepEqual(state.updates.map(x=>x.values.state),['accepted','failed','unknown']);for(let i=0;i<3;i++)assert.deepEqual(state.updates[i].filters,[['id',state.queue[i].id],['state','sending']]);});
    await t.test('claim failure sends nothing; save failure stops remaining deliveries',async()=>{reset();state.claimError={code:'fixture'};await assert.rejects(api.dispatchBookingMessages(),/Unable to claim/);assert.equal(state.requests.length,0);reset();state.queue=[email,{...email,id:'second'}];state.updateError={code:'fixture'};await assert.rejects(api.dispatchBookingMessages(),/send remains locked/);assert.equal(state.requests.length,1);});
    await t.test('empty queue performs no provider calls',async()=>{reset();assert.equal((await api.dispatchBookingMessages()).processed,0);assert.equal(state.requests.length,0);});
    await t.test('internal route requires the exact worker bearer secret before dispatch',async()=>{reset();state.routeCalls=0;process.env.BOOKING_MESSAGES_WORKER_SECRET='fixture-worker-secret';const route=await bundle('app/api/internal/booking-messages/route.ts',{'@/lib/booking-notifications':'export const dispatchBookingMessages=async()=>{globalThis.bookingDispatchFixture.routeCalls++;return {configured:true,processed:0};};','@/lib/notification-reminders':'export const enqueueNotificationReminders=async()=>({configured:true,queued:0});'});for(const authorization of ['', 'Bearer incorrect','Bearer fixture-worker-secret-extra']){const response=await route.POST(new Request('http://fixture.invalid',{method:'POST',headers:{authorization}}));assert.equal(response.status,401);}assert.equal(state.routeCalls,0);const response=await route.POST(new Request('http://fixture.invalid',{method:'POST',headers:{authorization:'Bearer fixture-worker-secret'}}));assert.equal(response.status,200);assert.equal(state.routeCalls,1);});
  }finally{globalThis.fetch=originalFetch;delete globalThis.bookingDispatchFixture;}
});
