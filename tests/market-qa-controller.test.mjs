import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,existsSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,basename,sep} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {EventEmitter} from 'node:events';
import {runQaController} from '../artifacts/market-published-qa/controller.mjs';
const root=new URL('../artifacts/market-published-qa/controller-child.mjs',import.meta.url);
function removeDryRunDirectory(dir){const target=resolve(dir),base=resolve(tmpdir())+sep;assert.ok(target.startsWith(base)&&basename(target).startsWith('reylumi-qa-dry-'),'Cleanup must stay inside this explicitly owned temporary directory');rmSync(target,{recursive:true,force:true});}
test('original readline EOF failure is reproducible without any fixture or credentials',async()=>{
 const source="import {createInterface} from 'node:readline'; console.log('ready'); try{for await(const line of createInterface({input:process.stdin,terminal:false})){} } finally{console.log('premature-cleanup')}";
 const p=spawn(process.execPath,['--input-type=module','-e',source],{stdio:['pipe','pipe','pipe'],windowsHide:true});let output='';p.stdout.on('data',b=>output+=b);p.stdin.end();await new Promise(resolve=>p.once('exit',resolve));assert.match(output,/ready/);assert.match(output,/premature-cleanup/);assert.equal(p.exitCode,0);
});
function child(mode='normal'){
 const dir=mkdtempSync(join(tmpdir(),'reylumi-qa-dry-')),path=join(dir,'command.txt'),log=join(dir,'events.jsonl');
 const p=spawn(process.execPath,[root.pathname.replace(/^\/([A-Z]:)/,'$1'),path,log,mode],{stdio:['pipe','pipe','pipe'],windowsHide:true});p.stdin.end();
 const exited=new Promise(resolve=>p.once('exit',code=>resolve(code)));
 return {p,path,dir,exited,events:()=>existsSync(log)?readFileSync(log,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[],dispose:()=>removeDryRunDirectory(dir)};
}
async function waitFor(check){for(let n=0;n<300;n++){const result=check();if(result)return result;await delay(10);}throw Error('Dry-run condition timeout');}
function command(c,name){assert.equal(existsSync(c.path),false);writeFileSync(c.path,name);}
test('real child survives closed stdin, all staged commands, duplicate/back and exact cleanup',async()=>{
 const c=child();try{
  await waitFor(()=>c.events().some(e=>e.kind==='stage-complete'&&e.name==='setup'));await delay(100);assert.equal(c.p.exitCode,null,'stdin EOF must not terminate ready process');assert.equal(c.events().some(e=>e.kind==='cleanup-start'),false);
  command(c,'status');await waitFor(()=>c.events().some(e=>e.kind==='status'));
  command(c,'lifecycle');await waitFor(()=>c.events().some(e=>e.kind==='stage-complete'&&e.name==='lifecycle'));
  command(c,'lifecycle');await waitFor(()=>c.events().some(e=>e.kind==='duplicate-ignored'));
  command(c,'update');await waitFor(()=>c.events().some(e=>e.kind==='stage-complete'&&e.name==='update'));
  command(c,'cleanup');assert.equal(await c.exited,0);
  assert.equal(c.events().filter(e=>e.kind==='synthetic-cleanup').length,1);assert.equal(c.events().filter(e=>e.kind==='stage-start'&&e.name==='lifecycle').length,1);assert.equal(existsSync(c.path),false);
 }finally{if(c.p.exitCode===null)c.p.kill();c.dispose();}
});
for(const [mode,operation]of [['setup-failure',null],['failure','lifecycle'],['timeout','lifecycle'],['deadline',null],['normal','update'],['normal','invalid']])test('dry-run terminal cleanup: '+mode+'/'+operation,async()=>{
 const c=child(mode);try{if(operation){await waitFor(()=>c.events().some(e=>e.kind==='stage-complete'&&e.name==='setup'));command(c,operation);}const exit=await c.exited;assert.equal(exit,mode==='deadline'?0:2);assert.equal(c.events().filter(e=>e.kind==='synthetic-cleanup').length,1);assert.equal(c.events().find(e=>e.kind==='synthetic-cleanup').working,false);}finally{if(c.p.exitCode===null)c.p.kill();c.dispose();}
});
test('stale command refuses before setup, and graceful stop waits for active step',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'reylumi-qa-dry-')),path=join(dir,'command.txt');try{
  writeFileSync(path,'lifecycle');let started=0;await assert.rejects(runQaController({commandPath:path,setup:()=>started++,steps:{},cleanup:()=>{throw Error('Must not clean before setup');}}),/Stale command/);assert.equal(started,0);rmSync(path);
  const signals=new EventEmitter(),events=[];let working=false,cleanups=0;
  const run=runQaController({commandPath:path,pollMs:5,signals,setup:async()=>{},steps:{lifecycle:{run:async(signal)=>{working=true;try{await delay(5000,undefined,{signal});}finally{working=false;}}}},cleanup:()=>{assert.equal(working,false);cleanups++;},onEvent:e=>events.push(e)});
  await waitFor(()=>events.some(e=>e.kind==='stage-complete'));writeFileSync(path,'lifecycle');await waitFor(()=>events.some(e=>e.kind==='stage-start'&&e.name==='lifecycle'));signals.emit('SIGTERM');await assert.rejects(run);assert.equal(cleanups,1);assert.equal(signals.listenerCount('SIGTERM'),0);
 }finally{removeDryRunDirectory(dir);}
});
