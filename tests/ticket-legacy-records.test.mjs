import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fixturePlugin} from './helpers/ticket-correction-history-fixture.mjs';

const output=await build({stdin:{contents:"export {mergeTicketInlineHistory} from './app/pos-tickets/ticket-history-disclosure';",resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',plugins:[fixturePlugin]});
const mod={exports:{}};new Function('module','exports',output.outputFiles[0].text)(mod,mod.exports);const {mergeTicketInlineHistory:merge}=mod.exports;
const change={id:'event-1',staff_id:null,source_table:'ticket',source_id:'ticket',ticket_id:'ticket',event_action:'updated',before_values:{service_total:35},after_values:{service_total:20},created_at:'2026-10-29T14:17:00Z',note:'Tinh sai'};
const raw={id:'raw-1',createdAt:change.created_at,actor:'Unknown',note:change.note,summary:['Staff Ny part $35.00 → $20.00']};

test('unlinked legacy facts remain separate evidence and never inflate the number of confirmed saves',()=>{
 const input=structuredClone([raw]),before=structuredClone(input),result=merge([change],input);
 assert.deepEqual(result.earlier,[raw]);assert.equal(result.legacy.length,0);assert.equal(result.count,1);assert.equal(result.countKnown,false);assert.equal(result.hasChanges,true);assert.deepEqual(input,before);
});
test('identical amounts, note and timestamp never establish a cross-store link or discard an older record',()=>{
 const result=merge([change],[raw,{...raw,id:'raw-2'},{...raw,id:change.id}]);
 assert.equal(result.earlier.length,3);assert.equal(result.count,1);assert.equal(result.countKnown,false);
});
test('an exact event FK deduplicates both stores, including repeated raw rows with that same event key',()=>{
 const linked={...raw,eventId:change.id,change};
 const both=merge([change],[linked,{...linked,id:'raw-2'}]);assert.equal(both.count,1);assert.equal(both.countKnown,true);assert.deepEqual(both.legacy,[]);assert.deepEqual(both.earlier,[]);
 const portable=merge([],[linked,{...linked,id:'raw-2'}]);assert.equal(portable.count,1);assert.equal(portable.legacy.length,1);assert.equal(portable.countKnown,true);
});
test('legacy-only evidence has an Edited state without asserting a known count; duplicate raw IDs render once',()=>{
 const result=merge([],[raw,raw]);assert.equal(result.hasChanges,true);assert.equal(result.countKnown,false);assert.equal(result.count,0);assert.equal(result.earlier.length,1);
});
test('captured creation, draft and unchanged linked snapshots never become edits',()=>{
 for(const entry of [{...change,event_action:'created'},{...change,event_action:'draft'},{...change,after_values:change.before_values}]){
  const result=merge([],[{...raw,eventId:entry.id,change:entry}]);assert.equal(result.hasChanges,false);assert.equal(result.count,0);assert.deepEqual(result.earlier,[]);
 }
});
test('distinct confirmed event IDs remain two saved edits even when amounts return to the original value',()=>{
 const reverse={...change,id:'event-2',before_values:change.after_values,after_values:change.before_values};
 const result=merge([change,reverse],[]);assert.equal(result.count,2);assert.equal(result.countKnown,true);
});
