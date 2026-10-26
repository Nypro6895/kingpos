import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { readProductionAlias,verifyProductionBase } from '../scripts/verify-production-base.mjs';
test('production baseline rejects a changed or malformed alias and accepts only the captured deployment identity',async()=>{
 const alias={alias:'reylumi.com',deploymentId:'dpl_current',deployment:{id:'dpl_current'}};
 assert.equal(await verifyProductionBase('dpl_current',{readAlias:async()=>alias}),'dpl_current');
 await assert.rejects(verifyProductionBase('dpl_previous',{readAlias:async()=>alias}),/Production changed/);
 await assert.rejects(verifyProductionBase('dpl_current',{readAlias:async()=>({...alias,deployment:{id:'dpl_other'}})}),/one current deployment/);
 await assert.rejects(verifyProductionBase('dpl_current',{readAlias:async()=>({...alias,alias:'another.example'})}),/one current deployment/);
 let called=false;await assert.rejects(verifyProductionBase('bad; command',{readAlias:async()=>{called=true;return alias;}}),/Usage/);assert.equal(called,false);
});
test('Windows alias read uses a hidden child and a constant read-only CLI argument, and CLI errors fail closed',async()=>{
 const requests=[];const spawnProcess=(command,args,options)=>{
  requests.push({command,args,options});const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{};
  queueMicrotask(()=>{child.stdout.emit('data',JSON.stringify({alias:'reylumi.com',deploymentId:'dpl_current'}));child.emit('close',0);});return child;
 };
 assert.equal((await readProductionAlias({spawnProcess,platform:'win32'})).deploymentId,'dpl_current');
 assert.equal(requests[0].command,'powershell.exe');assert.equal(requests[0].options.windowsHide,true);assert.deepEqual(requests[0].options.stdio,['ignore','pipe','pipe']);assert.equal(requests[0].args.at(-1),"npx.cmd --offline vercel api '/v4/aliases/reylumi.com' --raw");
 const failed=()=>{const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{};queueMicrotask(()=>child.emit('close',1));return child;};
 await assert.rejects(readProductionAlias({spawnProcess:failed,platform:'win32'}),/could not read/);
});
