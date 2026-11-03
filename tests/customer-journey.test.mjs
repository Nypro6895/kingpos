import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {journeyFixture,journeyId} from './helpers/customer-journey-fixture.mjs';
const b=await build({entryPoints:['lib/customer-journey.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {customerJourneyGroups:groups,customerJourneyTab:tab,customerVisitQrHref:qr,isActiveCustomerVisit:active,customerVisitArrivedAt:arrived}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const {canCheckInForAppointment:eligible}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));

test('appointment check-in opens at -15 minutes, remains through +60, and rejects invalid instants',()=>{
 const item=journeyFixture().upcoming[0],start=Date.parse(item.startAt);
 for(const [delta,expected] of [[-900001,false],[-900000,true],[-1,true],[0,true],[3600000,true],[3600001,false]])assert.equal(eligible(item,start+delta),expected,String(delta));
 assert.equal(eligible({...item,startAt:'invalid'},start),false);assert.equal(eligible(item,NaN),false);
 assert.equal(eligible({...item,startAt:'2026-10-30T09:00:00-05:00'},start),true,'time zone offsets represent the same instant');
});

test('arrival, visit, receipt and terminal statuses suppress a second check-in',()=>{
 const item=journeyFixture().upcoming[0],now=Date.parse(item.startAt);
 for(const status of ['checked_in','in_service','completed','cancelled','no_show']){
  assert.equal(eligible({...item,bookingStatus:status},now),false,status);
  assert.equal(eligible({...item,status},now),false,status);
 }
 for(const historyEvidence of [{checkedInAt:item.startAt},{visitId:journeyId(90)},{ticket:{ticketId:journeyId(80)}}])assert.equal(eligible({...item,historyEvidence},now),false);
 for(const visitState of ['waiting','in_service','checkout','completed','cancelled'])assert.equal(eligible({...item,visitState},now),false);
 assert.equal(eligible(journeyFixture().history[1],now),false,'receipt is never an appointment');
});

test('just-started appointment from server history remains accessible in Upcoming until expiry without changing data',()=>{
 const item={...journeyFixture().upcoming[0],status:'past_appointment'},data={upcoming:[],history:[item]},before=JSON.stringify(data),start=Date.parse(item.startAt);
 const during=groups(data,start+1800000);assert.deepEqual(during.upcoming,[item]);assert.deepEqual(during.history,[]);
 const expired=groups(data,start+3600001);assert.deepEqual(expired.upcoming,[]);assert.deepEqual(expired.history,[item]);
 assert.equal(JSON.stringify(data),before);
 const paid={...journeyFixture().history[1],bookingId:item.bookingId};assert.equal(groups({...data,history:[item,paid]},start).upcoming.length,0,'linked receipts still win');
});
test('linked receipt replaces only its exact appointment; preserve recorded totals and input references',()=>{
 const data=journeyFixture(),before=JSON.stringify(data),view=groups(data),paid=data.history[1];
 assert.equal(view.history.filter(x=>x.type==='purchase').length,1);
 assert.ok(!view.history.some(x=>x.type==='booking'&&x.bookingId===paid.bookingId));
 assert.equal(view.history.find(x=>x.type==='purchase'),paid);assert.equal(paid.total,108);
 assert.equal(JSON.stringify(data),before);
 assert.ok(view.history.some(x=>x.type==='booking'&&x.bookingId===journeyId(14)),'same salon/date is never automatic merge evidence');
});
test('Upcoming contains all upcoming records in order, active check-ins are separate, and History excludes both',()=>{
 const data=journeyFixture(),view=groups(data);
 assert.equal(view.upcoming.length,2);assert.equal(view.active.length,1);assert.equal(view.active[0].bookingStatus,'in_service');
 assert.ok(view.history.every(x=>!active(x)&&x.status!=='upcoming'));
 assert.ok(view.history.some(x=>x.status==='past_appointment'));assert.ok(view.history.some(x=>x.status==='cancelled'));assert.ok(view.history.some(x=>x.status==='no_show'));
});
test('a historical check-in timestamp alone does not imply the customer is currently at the salon',()=>{
 const booking=structuredClone(journeyFixture().history[0]);booking.bookingStatus='completed';booking.status='checked_in';delete booking.visitState;
 assert.equal(active(booking),false);booking.visitState='completed';assert.equal(active(booking),false);
 booking.visitState='checkout';assert.equal(active(booking),true);booking.status='cancelled';assert.equal(active(booking),false);
});
test('arrival is the recorded arrival, never scheduled start; visit QR uses only a valid recorded visit ID',()=>{
 const item=journeyFixture().history[0];assert.notEqual(arrived(item),item.startAt);assert.equal(arrived(item),'2026-10-29T18:55:00Z');assert.equal(qr(item),'/qr?visit='+journeyId(90));
 assert.equal(qr(journeyFixture().upcoming[0]),'/qr');
 const invalid=structuredClone(item);invalid.historyEvidence.visitId='other?token=private';assert.equal(qr(invalid),'/qr');
});
test('a separately returned check-in linked to an appointment is shown once; unrelated visits stay separate',()=>{
 const data=journeyFixture(),linked={type:'visit',id:'visit-'+journeyId(90),status:'checked_in',visitState:'waiting',occurredAt:'2026-10-29T18:55:00Z'};
 data.history.push(linked,{...linked,id:'visit-'+journeyId(91)});const view=groups(data);assert.equal(view.active.length,2);assert.ok(!view.active.includes(linked));
});
test('legacy past/cancelled/Activity links map to History; unknown query values cannot manufacture a different tab',()=>{
 for(const value of ['past','cancelled','history'])assert.equal(tab(value),'history');assert.equal(tab(null,true),'history');assert.equal(tab('other'),'upcoming');
});
