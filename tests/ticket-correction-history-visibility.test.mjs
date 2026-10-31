import test from 'node:test';
import assert from 'node:assert/strict';
import {adjustments,ownerTicket,portableFunctions,portableTicket,props,renderer,sourceHelper} from './helpers/ticket-correction-history-fixture.mjs';
const render=await renderer();

test('actual Owner ticket card hides initial draft/creation history without changing the submitted ticket',()=>{
 const ticket={...ownerTicket(),adjustments:adjustments().slice(0,2)},before=structuredClone(ticket),html=render(ticket,props);
 assert.ok(html.includes('Manicure'));assert.ok(html.includes('$60.00'));assert.ok(!html.includes('Correction History'));assert.ok(!html.includes('should be hidden'));assert.deepEqual(ticket,before);
});
test('actual Owner ticket card preserves real submitted edits and sparse unknown legacy corrections',()=>{
 const ticket={...ownerTicket(),adjustments:adjustments()},html=render(ticket,props);
 assert.ok(html.includes('Edited'));assert.ok(!html.includes('Correction History'));assert.ok(html.includes('After-submit price correction'));assert.ok(html.includes('Legacy correction retained'));assert.ok(!html.includes('should be hidden'));assert.ok(html.includes('$50.00'));assert.ok(html.includes('$60.00'));assert.ok(!html.replace(/<[^>]*>/g,'').includes('00000000-0000-4000-8000-'));
});
test('actual Portable normalizer accepts both wire conventions and conservatively retains unknown lifecycle evidence',async()=>{
 const {normalizePortableTicketAdjustment:normalize}=await portableFunctions(),base=adjustments()[2];
 for(const action of ['draft','created'])for(const field of ['event_action','eventAction'])assert.equal(normalize({...base,event_action:undefined,[field]:action}),null);
 for(const action of ['updated',undefined,'future-unknown']){
  const result=normalize({...base,event_action:undefined,eventAction:action});assert.ok(result);assert.equal(result.eventAction,action==='updated'?'updated':undefined);assert.equal(result.beforeSnapshot.ticket.ticket_items[0].line_total,50);
 }
});
test('actual Portable mapping and shared card retain only real/unknown corrections and preserve current financial inputs',async()=>{
 const ticket=await portableTicket(),before=structuredClone(ticket),html=render(ticket,props);
 assert.deepEqual(ticket.adjustments.map(a=>a.event_action),['updated',undefined]);assert.ok(html.includes('After-submit price correction'));assert.ok(html.includes('Legacy correction retained'));assert.ok(!html.includes('should be hidden'));assert.ok(html.includes('Manicure'));assert.ok(html.includes('$60.00'));assert.deepEqual(ticket,before);
 const first=await portableTicket(adjustments().slice(0,2));assert.ok(!render(first,props).includes('Correction History'));
});

test('Portable exact event metadata accepts both wire conventions and rejects missing or non-object snapshots',async()=>{
 const {normalizePortableTicketAdjustment:normalize,toEditableTicket}=await portableFunctions(),base=adjustments()[2];
 for(const camel of [true,false]){
  const row=normalize({...base,[camel?'financialInputEventId':'financial_input_event_id']:'event-exact',[camel?'financialInputBeforeValues':'financial_input_before_values']:{service_total:50},[camel?'financialInputAfterValues':'financial_input_after_values']:{service_total:60}});
  assert.equal(row.financialInputEventId,'event-exact');assert.equal(row.financialInputBeforeValues.service_total,50);assert.equal(row.financialInputAfterValues.service_total,60);
  const mapped=toEditableTicket({id:base.ticket_id,adjustments:[row],items:[],staffEarnings:[]},[]);assert.equal(mapped.adjustments[0].financial_input_event_id,'event-exact');assert.equal(mapped.adjustments[0].financial_after_values.service_total,60);
 }
 const row=normalize({...base,financialInputBeforeValues:[],financialInputAfterValues:'bad'});assert.equal(row.financialInputBeforeValues,null);assert.equal(row.financialInputAfterValues,null);
});
test('classification filtering never guesses from a sparse legacy snapshot or mutates source records',async()=>{
 const {visibleTicketAdjustments}=await sourceHelper(),rows=adjustments().map(row=>Object.freeze(row)),before=structuredClone(rows),result=visibleTicketAdjustments(Object.freeze(rows));
 assert.deepEqual(result.map(row=>row.reason),['After-submit price correction','Legacy correction retained']);assert.equal(result[0],rows[2]);assert.equal(result[1],rows[3]);assert.deepEqual(rows,before);
});
