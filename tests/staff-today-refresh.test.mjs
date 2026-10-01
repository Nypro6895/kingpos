import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const exports={};
new Function('exports',ts.transpileModule(readFileSync('lib/staff-refresh-queue.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(exports);
const {createStaffRefreshQueue}=exports;
const flush=async()=>{await Promise.resolve();await Promise.resolve();};
test('POS event bursts coalesce, and changes during an in-flight refresh get exactly one trailing refresh',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let calls=0,finish;
  const queue=createStaffRefreshQueue({active:()=>true,refresh:()=>{calls++;return new Promise(resolve=>{finish=resolve;});}});
  for(let i=0;i<20;i++)queue.request();
  t.mock.timers.tick(250);assert.equal(calls,1);
  for(let i=0;i<20;i++)queue.request();
  t.mock.timers.tick(1000);assert.equal(calls,1,'no concurrent refresh');
  finish();await flush();t.mock.timers.tick(250);assert.equal(calls,2);
  finish();await flush();t.mock.timers.tick(1000);assert.equal(calls,2);queue.dispose();
});
test('hidden/offline pages defer work until wake and cleanup cancels queued work',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let active=false,calls=0;
  const queue=createStaffRefreshQueue({active:()=>active,refresh:async()=>{calls++;}});
  queue.request();t.mock.timers.tick(1000);assert.equal(calls,0);
  active=true;queue.request();t.mock.timers.tick(250);await flush();assert.equal(calls,1);
  queue.request();queue.dispose();t.mock.timers.tick(1000);assert.equal(calls,1);
});
test('a failed refresh does not block later reconciliation',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let calls=0;
  const queue=createStaffRefreshQueue({active:()=>true,refresh:async()=>{if(++calls===1)throw Error('offline');}});
  queue.request();t.mock.timers.tick(250);await flush();
  queue.request();t.mock.timers.tick(250);await flush();assert.equal(calls,2);queue.dispose();
});
