import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const bundled=await build({stdin:{resolveDir:process.cwd(),contents:"export * from './lib/staff-ticket-history-context';export * from './lib/ticket-day-bounds';export * from './lib/ticket-history-navigation';",loader:'ts'},bundle:true,write:false,platform:'node',format:'cjs'});
const module={exports:{}};new Function('module','exports',bundled.outputFiles[0].text)(module,module.exports);
const {staffTicketHistoryContexts,ticketDayBounds,ticketNotificationDate}=module.exports;
const event={id:'change-1',salon_id:'salon',staff_id:'anna',ticket_id:'ticket-1',source_id:'ticket-1',source_table:'ticket',event_action:'updated',period_start:'2026-10-30',period_end:'2026-10-30',created_at:'2026-10-31T15:00:00Z',before_values:{service_total:50,lines:[{service_name:'Manicure',service_total:50}]},after_values:{ticket_number:'T001',service_total:0,lines:[]}};

test('reassigned or past own work gets one context row without inventing a current ticket or changing the supplied totals',()=>{
 const current=['ticket-2'],before=structuredClone(current),events=[event,{...event,id:'other',staff_id:'bella',after_values:{service_total:999}},event];
 const rows=staffTicketHistoryContexts(current,'2026-10-31','anna',events);
 assert.equal(rows.length,1);assert.equal(rows[0].ticketId,'ticket-1');assert.equal(rows[0].businessDate,'2026-10-30');assert.equal(rows[0].changes.length,1);assert.equal(rows[0].values.service_total,0);assert.deepEqual(current,before);assert.ok(!JSON.stringify(rows).includes('999'));
 assert.equal(staffTicketHistoryContexts(['ticket-1'],'2026-10-30','anna',[event]).length,0,'retained zero earning row is reused');
});
test('draft, creation, no-op and an event ID without a proven ticket ID never become edited context rows',()=>{
 const candidates=[{...event,event_action:'draft'},{...event,event_action:'created'},{...event,before_values:event.after_values},{...event,ticket_id:undefined}];
 assert.deepEqual(staffTicketHistoryContexts([],'2026-10-31','anna',candidates),[]);
 const recorded={...event,id:'created',event_action:'created',before_values:{}};
 const rows=staffTicketHistoryContexts([],'2026-10-31','anna',[],recorded);assert.equal(rows.length,1);assert.equal(rows[0].changes.length,0);assert.equal(rows[0].record.id,'created');
});
test('a snapshot with the latest edit wins independent of input order, while A to B to A keeps both edits',()=>{
 const later={...event,id:'change-2',created_at:'2026-10-31T16:00:00Z',before_values:event.after_values,after_values:event.before_values};
 const rows=staffTicketHistoryContexts([],'2026-10-31','anna',[later,event]);assert.equal(rows[0].changes.length,2);assert.equal(rows[0].values.service_total,50);
});
test('a validated notification chooses the original day; ordinary date navigation and malformed links retain their existing date',()=>{
 const inputEvent='00000000-0000-4000-8000-000000000001';
 assert.equal(ticketNotificationDate({date:'2026-10-31',eventDate:'2026-10-29',inputEvent}),'2026-10-29');
 assert.equal(ticketNotificationDate({date:'2026-10-31',eventDate:'2026-10-29',inputEvent:'invalid'}),'2026-10-31');
 assert.equal(ticketNotificationDate({date:['2026-10-30']}),'2026-10-30');
});
test('Owner Today reads the entire salon business date across daylight-saving transitions',()=>{
 assert.deepEqual(ticketDayBounds('2026-11-01','America/Chicago'),{openedFrom:'2026-11-01T05:00:00.000Z',openedTo:'2026-11-02T05:59:59.999Z'});
 assert.deepEqual(ticketDayBounds('2026-03-08','America/Chicago'),{openedFrom:'2026-03-08T06:00:00.000Z',openedTo:'2026-03-09T04:59:59.999Z'});
});
