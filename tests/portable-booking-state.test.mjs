import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const code=ts.transpileModule(readFileSync('lib/portable-booking-state.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {mergeBookingSnapshots,reconcileBookingOperations}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const pending={id:'booking',status:'pending',startAt:'2026-09-25T14:00:00Z',updatedAt:'2026-09-24T15:00:00Z'};
const confirmed={...pending,status:'confirmed',updatedAt:'2026-09-24T16:00:00Z'};
const local={...pending,id:'local'};
const operation={kind:'booking',state:'synced',payload:{localAppointment:local},result:pending};
test('Old offline creation receipts never undo read, confirm, cancel, edit or ticket results',()=>{
 for(const status of ['confirmed','cancelled','checked_in','in_service','completed']){
  const latest={...confirmed,status,ticketId:status==='completed'?'ticket':null};
  assert.deepEqual(reconcileBookingOperations([latest,local],[operation]),[latest]);
 }
 assert.deepEqual(reconcileBookingOperations([confirmed],[{...operation,result:{...pending,updatedAt:undefined}}]),[confirmed]);
 assert.deepEqual(reconcileBookingOperations([local],[operation]),[pending]);
 assert.deepEqual(reconcileBookingOperations([pending],[{...operation,result:confirmed}]),[confirmed]);
 assert.deepEqual(reconcileBookingOperations([confirmed],[{...operation,result:null}]),[confirmed]);
});
test('Server snapshots merge new bookings and reject stale refresh responses',()=>{
 assert.deepEqual(mergeBookingSnapshots([pending],[confirmed]),[confirmed]);
 assert.deepEqual(mergeBookingSnapshots([confirmed],[pending]),[confirmed]);
 assert.equal(mergeBookingSnapshots([confirmed],[{...pending,id:'other'}]).length,2);
 assert.deepEqual(reconcileBookingOperations([local],[{...operation,state:'cancelled'}]),[]);
 assert.deepEqual(reconcileBookingOperations([],[{...operation,state:'pending'}]),[local]);
});
