import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

test('linked ticket replaces estimate; elapsed bookings remain past; standalone check-in stays unpaid/unverified', {skip:!process.env.ESBUILD_MODULE_PATH}, async()=>{
 const {build}=await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
 const result=await build({entryPoints:['lib/customer-activity.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'mock-data',setup(b){
 b.onResolve({filter:/server-only$|supabase\/server$|users\/current-user$|salon-profile$|pos-payments$/},args=>({path:args.path,namespace:'stub'}));
 b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:args.path==='server-only'?'':args.path.endsWith('supabase/server')?'export const createAuthenticatedSupabaseServerClient=async()=>({rpc:async()=>({data:globalThis.historyFixture,error:null})});':args.path.endsWith('current-user')?'export const getCurrentKingUser=async()=>({id:"user"});':args.path.endsWith('salon-profile')?'export const getSalonProfileMediaUrl=()=>null;':'export const POS_PAYMENT_METHOD_LABELS={cash:"Cash"};'}));
 }}]});
 const {getCustomerActivity}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
 const uuid=n=>`00000000-0000-4000-8000-${n.toString().padStart(12,'0')}`;
 const salon={id:uuid(20),name:'King Nails'};
 const booking=n=>({bookingId:uuid(n),startAt:'2026-10-01T15:00:00Z',endAt:'2026-10-01T16:00:00Z',timezone:'America/Chicago',status:'confirmed',salon,services:[{name:'Estimate service',lineTotal:40}]});
 const ticket={ticketId:uuid(10),ticketNumber:'123',openedAt:'2026-10-01T15:02:00Z',closedAt:'2026-10-01T16:00:00Z',salon,services:[{name:'Actual service',lineTotal:55}],discountValue:5,discountType:'fixed_amount',taxRate:0,tipType:'fixed_amount',tipValue:10,payments:[],verifiedVisit:{status:'verified',countsTowardReputation:true,windowDays:30}};
 globalThis.historyFixture={ok:true,serverNow:'2026-10-02T16:00:00Z',bookings:[booking(1),booking(2)],purchases:[ticket],evidence:[{bookingId:uuid(1),ticket,checkedInAt:'2026-10-01T15:02:00Z',visitId:uuid(30),manualLink:true,candidates:[]}],visits:[{id:uuid(30),bookingId:uuid(1),ticketId:uuid(10),at:'2026-10-01T15:02:00Z',salon},{id:uuid(31),at:'2026-10-01T19:00:00Z',salon,services:[{name:'Salon visit'}]}]};
 try{
 const result=await getCustomerActivity();assert.equal(result.ok,true);assert.equal(result.data.history.length,3);
 const purchase=result.data.history.find(row=>row.type==='purchase');assert.equal(purchase.bookingId,uuid(1));assert.equal(purchase.total,60);assert.equal(purchase.services[0].name,'Actual service');
 const past=result.data.history.find(row=>row.type==='booking');assert.equal(past.bookingId,uuid(2));assert.equal(past.status,'past_appointment');assert.equal(past.total,40);
 const visit=result.data.history.find(row=>row.type==='visit');assert.equal(visit.status,'checked_in');assert.equal(visit.total,0);assert.equal(visit.verifiedVisit,undefined);
 assert.equal(result.data.upcoming.length,0);
 }finally{delete globalThis.historyFixture;}
});
