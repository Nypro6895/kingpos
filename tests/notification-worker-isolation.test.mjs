import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
test('An in-app worker failure preserves the existing email/SMS worker response',async()=>{
 const {build}=await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
 const result=await build({entryPoints:['app/api/internal/booking-messages/route.ts'],bundle:true,write:false,platform:'node',format:'cjs',plugins:[{name:'worker-stubs',setup(b){
 b.onResolve({filter:/lib\/booking-notifications$/},()=>({path:'existing',namespace:'stub'}));
 b.onResolve({filter:/lib\/notification-reminders$/},()=>({path:'new',namespace:'stub'}));
 b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:args.path==='existing'?`export async function dispatchBookingMessages(){return {configured:true,processed:2}}`:`export async function enqueueNotificationReminders(){throw Error('Simulated in-app outage')}`}));
 }}]});
 const module={exports:{}};new Function('require','module','exports',result.outputFiles[0].text)(require,module,module.exports);
 const previous=process.env.BOOKING_MESSAGES_WORKER_SECRET;process.env.BOOKING_MESSAGES_WORKER_SECRET='fixture-secret';
 try{const response=await module.exports.POST(new Request('https://example.invalid/api/internal/booking-messages',{method:'POST',headers:{authorization:'Bearer fixture-secret'}}));assert.equal(response.status,200);const data=await response.json();assert.equal(data.configured,true);assert.equal(data.processed,2);assert.ok(data.reminders.error);}
 finally{if(previous===undefined)delete process.env.BOOKING_MESSAGES_WORKER_SECRET;else process.env.BOOKING_MESSAGES_WORKER_SECRET=previous;}
});
