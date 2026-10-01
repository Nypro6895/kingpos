import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {build}=require(process.env.ESBUILD_MODULE_PATH||'esbuild');
test('Booking provider handling distinguishes unconfigured, accepted, rejected, and uncertain without sending real messages',async()=>{
 const bundle=await build({entryPoints:['lib/booking-notifications.ts'],bundle:true,write:false,platform:'node',format:'cjs',plugins:[{name:'server-only',setup(b){b.onResolve({filter:/^server-only$/},()=>({path:'server-only',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:''}));}}]});
 const module={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(require,module,module.exports);
 const {sendBookingMessage}=module.exports;
 const oldFetch=globalThis.fetch,oldKey=process.env.RESEND_API_KEY,oldFrom=process.env.BOOKING_EMAIL_FROM;
 const message={id:'fixture',channel:'email',recipient:'fixture@example.invalid',message:'Appointment requested.'};
 try {
  delete process.env.RESEND_API_KEY;
  globalThis.fetch=()=>{throw Error('Must not send without config');};
  assert.equal((await sendBookingMessage(message)).state,'unconfigured');
  process.env.RESEND_API_KEY='fixture';process.env.BOOKING_EMAIL_FROM='fixture@example.invalid';
  globalThis.fetch=async(url,options)=>{assert.equal(options.headers['Idempotency-Key'],'booking-fixture');return new Response(JSON.stringify({id:'provider-fixture'}),{status:200});};
  assert.deepEqual(await sendBookingMessage(message),{state:'accepted',provider_id:'provider-fixture'});
  globalThis.fetch=async()=>new Response('',{status:400});assert.equal((await sendBookingMessage(message)).state,'failed');
  globalThis.fetch=async()=>new Response('',{status:503});assert.equal((await sendBookingMessage(message)).state,'unknown');
  globalThis.fetch=async()=>{throw Error('Network interrupted');};assert.equal((await sendBookingMessage(message)).state,'unknown');
 } finally {globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=oldKey;if(oldFrom===undefined)delete process.env.BOOKING_EMAIL_FROM;else process.env.BOOKING_EMAIL_FROM=oldFrom;}
});
