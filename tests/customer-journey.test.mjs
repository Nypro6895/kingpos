import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {journeyFixture,journeyId} from './helpers/customer-journey-fixture.mjs';
const b=await build({entryPoints:['lib/customer-journey.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {customerJourneyGroups:groups,customerJourneyTab:tab,customerVisitQrHref:qr,isActiveCustomerVisit:active,customerVisitArrivedAt:arrived}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
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
