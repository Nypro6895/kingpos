import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
async function load(file, stubs) {
  const out = await build({ entryPoints: [file], bundle: true, write: false, platform: 'node', format: 'esm', plugins: [{ name: 'role-handoff-fixture', setup(b) {
    b.onResolve({ filter: /.*/ }, a => {
      const key = Object.keys(stubs).find(k => a.path === k || a.path.endsWith('/' + k));
      if (key) return { path: key, namespace: 'fixture' };
      if (a.kind === 'dynamic-import') return { path: a.path, external: true };
    });
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: stubs[a.path], loader: 'js' }));
  } }] });
  return import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
}
test('notification redirect uses original checked workspace switch exactly once; booking result recovers context without repeating save', async () => {
  globalThis.window = new EventTarget();
  globalThis.location = { pathname: '/notifications', search: '' };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
  const events = [], calls = [];
  window.addEventListener('reylumi:app-local-workspace-handoff', e => events.push(e.detail.path));
  globalThis.handoffHost = { isNative: true, command: async (name, args) => {
    calls.push({ name, args });
    if (name === 'shell.switch-workspace') return { path: args.destination };
    if (name === 'notification.open') return { redirect: '/workspace/open?workspace_id=manage%3Asalon-b&destination=%2Fbookings' };
    return { value: { ok: true } };
  } };
  const api = await load('lib/app-local-command-client.ts', {
    'app-local-host': 'export const appLocalPath=x=>x;export const getAppLocalHost=()=>globalThis.handoffHost',
    'app-local-command-codec': 'export const encodeAppLocalValue=async x=>x',
    'app-local-upload-client': 'export const handlesAppLocalFileCommand=async()=>({handled:false})',
  });
  api.setAppLocalCommandScope('viewer-a');
  await api.invokeAppLocalCommand('notification.open', [], true, 'app/notifications/actions.ts');
  await new Promise(setImmediate);
  assert.deepEqual(events, ['/bookings']);
  assert.deepEqual(calls.map(x => x.name), ['notification.open', 'shell.switch-workspace']);
  assert.equal(calls[1].args.workspaceId, 'manage:salon-b');
  events.length = 0;
  const result = await api.invokeAppLocalCommand('notification.booking.confirm', [], true, 'app/notifications/actions.ts', true);
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(events, ['/notifications']);
  assert.equal(calls.filter(x => x.name === 'notification.booking.confirm').length, 1);
  events.length = 0;
  await api.invokeAppLocalCommand('notification.mark-read', [], true, 'app/notifications/actions.ts');
  assert.deepEqual(events, [], 'Marking a notification read must not reset the workspace or drafts');
});
test('uncertain workspace command failure recovers current admission without replay; a new account cannot be reset by its old failure', async () => {
  globalThis.window = new EventTarget(); globalThis.location = { pathname: '/notifications', search: '' };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
  let scope='old-viewer', reject;
  const events=[];window.addEventListener('reylumi:app-local-workspace-handoff', e=>events.push(e.detail.path));
  globalThis.handoffScope=()=>scope;
  let calls=0;
  globalThis.handoffHost={isNative:true,command:async()=>{calls++;return new Promise((_,r)=>reject=r)}};
  const api=await load('lib/app-local-shell-workspace-navigation.ts',{
    'app-local-host':'export const appLocalPath=x=>x;export const getAppLocalHost=()=>globalThis.handoffHost',
    'app-local-command-client':'export const getAppLocalCommandScope=()=>globalThis.handoffScope()',
  });
  api.navigateToWorkspace('staff:fixture');reject(Error('reply unavailable'));await new Promise(setImmediate);
  assert.deepEqual(events,['/notifications']);assert.equal(calls,1);
  events.length=0;api.navigateToWorkspace('staff:fixture');scope='new-viewer';reject(Error('old reply unavailable'));await new Promise(setImmediate);
  assert.deepEqual(events,[]);assert.equal(calls,2);
});
test('web notification open defers role cookies to the guarded handoff and preserves mark-read', async () => {
  const state = globalThis.notificationHandoffFixture = { writes: 0, reads: 0, markRead: 0 };
  const api = await load('app/notifications/actions.ts', {
    'app-notifications': 'export const getCurrentAppNotification=async()=>({id:"fixture"});export const markAppNotificationRead=async()=>{globalThis.notificationHandoffFixture.markRead++;return true};export const markAppNotificationsRead=async()=>true',
    'current-context': 'export const getCurrentBusinessContext=async()=>{globalThis.notificationHandoffFixture.reads++;return {user:{id:"fixture"},workspaceOptions:[]}};export const setNormalizedWorkspaceContext=async()=>{globalThis.notificationHandoffFixture.writes++}',
    'notification-feed-items': 'export const resolveAppNotificationDestination=()=>({href:"/bookings",workspaceId:"manage:salon-b"})',
    'workspace-pending': 'export const getAppNotificationScopeForContext=()=>({})',
    'next/cache': 'export const revalidatePath=()=>{}',
    'next/navigation': 'export const redirect=href=>{throw Object.assign(Error("redirect"),{href})}',
  });
  const data = new FormData(); data.set('notification_id', 'fixture');
  await assert.rejects(api.openAppNotificationAction(data), e => {
    const target = new URL(e.href, 'https://reylumi.com');
    return target.pathname === '/workspace/open' && target.searchParams.get('workspace_id') === 'manage:salon-b' && target.searchParams.get('destination') === '/bookings';
  });
  assert.equal(state.writes, 0); assert.equal(state.markRead, 1);
});
test('native event delivery cannot roll back a host epoch already adopted by a context reply', () => {
  const source=readFileSync('ios/Reylumi/ReylumiLocalAppViewController.swift','utf8');
  const line=source.split('\n').find(line=>line.includes('evaluateJavaScript("(()=>{const e='));
  const script=line.match(/evaluateJavaScript\("(.*)", completionHandler/)[1];
  globalThis.window=new EventTarget();window.__reylumiAppLocalContext={scopeEpoch:5,nonce:'accepted'};
  let resets=0;window.addEventListener('reylumi:app-local-reset',()=>resets++);
  const deliver=(name,detail)=>new Function(script.replace('\\(json)',JSON.stringify({name,detail})))();
  deliver('reylumi:app-local-reset',{scopeEpoch:4,nonce:'old'});
  deliver('reylumi:app-local-context',{host:{scopeEpoch:4,nonce:'old'}});
  assert.equal(window.__reylumiAppLocalContext.nonce,'accepted');assert.equal(resets,0);
  deliver('reylumi:app-local-reset',{scopeEpoch:6,nonce:'new'});
  assert.equal(window.__reylumiAppLocalContext.nonce,'new');assert.equal(resets,1);
});
