import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';

// Execute the real route transition, so a shell-only fix cannot pass while
// the native entry forgets the route or overwrites it inside a Help article.
const source = readFileSync('app/local-app/entry.tsx', 'utf8');
const start = source.indexOf('  const transition = useCallback(');
const compiled = transformSync(source.slice(start, source.indexOf('  const navigate = useCallback(', start)) + '\nglobalThis.transition=transition;', {loader:'ts'}).code;
function fixture(path, {authenticated=true, usable=true, family='staff.portal', known=true}={}) {
  const admission={generation:'device-generation',value:{context:{authenticated,viewerId:'same-person',scope:'staff-scope'}}};
  const state={
    current:{current:path}, pageRecovery:{current:null}, handoffPath:{current:null},
    scrollPositions:{current:new Map()}, contextEpoch:{current:0}, request:{current:null},
    workspaceResolution:{current:null}, workspaceRecovery:{current:null}, workspaceGesture:{current:null},
    recoveryAttempts:{current:new Set()}, admitted:{current:{[family]:admission}},
    window:{scrollY:0,__reylumiAppLocalContext:{generation:'device-generation'}},
    useCallback:fn=>fn, pageKey:p=>p, isHelp:p=>/^\/help(?:[/?]|$)/.test(p),
    isPublic:p=>/^\/(?:help|privacy)(?:[/?]|$)/.test(p), authorityFamily:()=>family,
    ownerPaths:new Set(['/pos']), getAppLocalPage:()=>known?{}:null, usable:()=>usable,
    setHelpPresentation:value=>{state.presentation=value;},setHelpReturn:value=>{state.hint=value;},
    finishNativeResetPending:()=>{},setSwitchingWorkspace:()=>{},setError:()=>{},
    readPriorityScheduler:{setActiveRoute:()=>{}},setAppLocalCommandScope:value=>{state.commandScope=value;},
    setVisited:()=>{},setPath:()=>{},
  };
  vm.runInNewContext(compiled,state);
  return state;
}

test('Staff and Owner Help retain the exact internal origin and nested language navigation does not replace it',()=>{
  for(const path of ['/staff/my-work?date=2026-11-18','/bookings?view=week','/pos']) {
    const f=fixture(path);f.transition('/help');
    assert.equal(f.hint?.path,path);assert.equal(f.hint?.viewerId,'same-person');
    assert.equal(f.hint?.generation,'device-generation');assert.equal(f.commandScope,undefined);
    const hint=f.hint;f.transition('/help/account?lang=vi');assert.equal(f.hint,hint);
    f.transition(path);assert.equal(f.hint,null);
  }
});
test('an expired decorative lease keeps only a navigation hint, never Help authority',()=>{
  const f=fixture('/staff/my-work',{usable:false});f.transition('/help');
  assert.equal(f.hint?.path,'/staff/my-work');assert.equal(f.presentation,null);
  assert.equal(f.commandScope,undefined);
});
test('cold public, guest, unknown and device-specific origins cannot create a private return hint',()=>{
  for(const [path,options] of [['/help',{}],['/privacy',{}],['/explore',{authenticated:false}],['/unknown',{known:false}],['/pos/portable',{family:'portable'}],['/pos/customer-display',{family:'display'}]]) {
    const f=fixture(path,options);f.transition('/help?lang=vi');assert.equal(f.hint??null,null);
  }
});
