import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';

// Execute the production reset handler, including its watchdog, with controlled
// native events. This catches failures in wiring and ordering, not just policy.
const source = readFileSync('app/local-app/entry.tsx', 'utf8');
const handler = source.slice(source.indexOf('    const reset = (event:'), source.indexOf('    const handoff = (event:'));
const compiled = transformSync(handler + '\nglobalThis.reset = reset;', {loader:'ts'}).code;
const ref = current => ({current});
function fixture() {
  const host = {version:1, generation:'new-generation', scopeEpoch:2};
  const calls = [], timers = [];
  const state = {
    window:{__reylumiAppLocalContext:host}, Object, Number,
    getAppLocalHost:()=>({isNative:true}), current:ref('/today'),
    acceptedHostEpoch:ref(1), nativeResetPending:ref(null),
    roleReturn:ref(null), contextEpoch:ref(0), request:ref(null),
    workspaceResolution:ref(null), workspaceRecovery:ref(null), workspaceGesture:ref(null),
    pageRecovery:ref(null), handoffPath:ref(null), recoveryAttempts:ref(new Set()),
    admitted:ref({staff:{value:{context:{viewerId:'old-user'}}}}),
    authorityFamily:()=> 'staff', isPublic:path=>path==='/help', getAppLocalPage:()=>({requiresContext:true}),
    usable:()=>false, recordExperienceTrace:()=>{}, clearAppLocalRoleResources:()=>{},
    appLocalContextFailureReason:()=> 'reset', classifyAppLocalContextFailure:value=>value.status??'reset',
    alignDeviceGeneration:()=>{}, clearExperienceSnapshots:async()=>{}, clearExperienceState:()=>{},
    resetAppLocalResources:()=>calls.push('clear-resources'), setAppLocalCommandScope:()=>calls.push('clear-commands'),
    setAdmissions:()=>calls.push('clear-admission'), setHelpPresentation:()=>{}, setVisited:()=>{}, setSwitchingWorkspace:()=>{},
    setError:value=>calls.push(['error',value]),
    verify:options=>{assert.deepEqual(Object.keys(state.admitted.current),[]);calls.push(['verify',options.fresh]);},
    setTimeout:fn=>{timers.push(fn);return timers.length;},
    finishNativeResetPending:()=>{state.nativeResetPending.current=null;},
  };
  vm.runInNewContext(compiled,state);
  const emit=(reason,extra={})=>state.reset({detail:{...host,reason,...extra}});
  return {state,calls,timers,emit,reads:()=>calls.filter(c=>Array.isArray(c)&&c[0]==='verify').length};
}

test('cookie change withdraws old authority before a single fresh recovery',()=>{
  const f=fixture();f.emit('externalCookies');
  assert.equal(f.reads(),1);
  assert.ok(f.calls.indexOf('clear-admission')<f.calls.findIndex(c=>c[0]==='verify'));
  f.emit('externalCookies');assert.equal(f.reads(),1);
});
test('cookie reset with actual denial, foreign metadata or public route cannot recover',()=>{
  for(const extra of [{status:401},{status:403},{status:409},{generation:'old'},{scopeEpoch:1}]) {
    const f=fixture();f.emit('externalCookies',extra);assert.equal(f.reads(),0);
  }
  const f=fixture();f.state.current.current='/help';f.emit('externalCookies');assert.equal(f.reads(),0);
});
test('lost explicit-reset context delivery triggers one fresh read at deadline',()=>{
  const f=fixture();f.emit('explicitReset');assert.equal(f.reads(),0);
  f.timers[0]();assert.equal(f.reads(),1);
  f.emit('explicitReset');assert.equal(f.timers.length,1);
});
test('watchdog defers to in-flight authority checks and ignores navigation',()=>{
  for(const changed of ['request','path','admission']) {
    const f=fixture();f.emit('explicitReset');
    if(changed==='request')f.state.request.current={};
    if(changed==='path')f.state.current.current='/staff/my-work';
    if(changed==='admission')f.state.usable=()=>true;
    f.timers[0]();assert.equal(f.reads(),0);
  }
});
test('logout and unauthenticated reset never automatically recover',()=>{
  for(const reason of ['logout','unauthenticated']){const f=fixture();f.emit(reason,{status:401});assert.equal(f.reads(),0);assert.equal(f.timers.length,0);}
});
