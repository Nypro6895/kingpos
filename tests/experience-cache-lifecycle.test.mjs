import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const compile = path => ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;

function lifecycle(storageDenied = false) {
  const exports = {}, resets = [], storage = new Map(), ref = { current: null };
  let effects = [], receiver;
  vm.runInNewContext(compile('components/experience-cache-lifecycle.tsx'), {
    exports, window: { sessionStorage: { getItem: key => { if (storageDenied) throw Error('denied'); return storage.get(key); }, setItem: (key,value) => storage.set(key,value) } },
    require: name => name === 'react' ? { useRef: () => ref, useEffect: fn => effects.push(fn) }
      : name.endsWith('experience-cache-events') ? { subscribeExperienceResets: callback => { receiver = callback; return () => {}; } }
      : { resetExperienceCaches: options => resets.push(options) },
  });
  return { resets, render(props) { effects=[]; exports.ExperienceCacheLifecycle(props); effects.forEach(fn => fn()); }, receive(reason) { receiver(reason); } };
}
const base = { viewerId:'user-a',workspace:'salon-a',permissionRevision:'read',scope:'user-a/salon-a/read' };

test('account, workspace and permission changes retire the former scope without interrupting newly authorized data', () => {
  for (const [props,reason,drafts] of [
    [{...base,viewerId:'user-b',scope:'user-b/salon-a/read'},'identity',true],
    [{...base,workspace:'salon-b',scope:'user-a/salon-b/read'},'workspace',false],
    [{...base,permissionRevision:'limited',scope:'user-a/salon-a/limited'},'permissions',false],
  ]) {
    const h=lifecycle(); h.render(base); h.render(props);
    assert.equal(h.resets.length,1); assert.equal(h.resets[0].scope,base.scope);
    assert.equal(h.resets[0].reason,reason); assert.equal(h.resets[0].bookingDrafts,drafts);
    assert.equal(h.resets[0].notify,false); assert.equal(h.resets[0].preserveBookingHandoff,true);
  }
});

test('cross-tab expiry suspends reads and cached Activity props never resume them', () => {
  const h=lifecycle(); h.render(base); h.receive('expired'); h.render(base);
  assert.equal(h.resets.length,1); assert.equal(h.resets[0].suspend,true);
  assert.equal(h.resets[0].broadcast,false); assert.equal(h.resets[0].reason,'expired');
});

test('identity invalidation still works when optional session storage is unavailable', () => {
  const h=lifecycle(true);h.render(base);h.render({...base,viewerId:null,scope:'guest'});
  assert.equal(h.resets[0].reason,'identity'); assert.equal(h.resets[0].scope,base.scope);
});

function signals(withChannel = true) {
  const exports = {}, channels = [], writes = [], listeners = new Map();
  const window = { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name), localStorage: { setItem: (key,value) => writes.push([key,value]), removeItem() {} } };
  class Channel { constructor(name) { this.name=name;channels.push(this); } postMessage(value) { this.sent=value; } close() { this.closed=true; } }
  vm.runInNewContext(compile('lib/experience-cache-events.ts'), {exports,window,Date:{now:()=>5000},...(withChannel?{BroadcastChannel:Channel}:{})});
  return { ...exports, channels,writes,listeners };
}

test('cross-tab signals contain no account data, ignore own/old/invalid messages and deduplicate', () => {
  const h=signals(),received=[];const cleanup=h.subscribeExperienceResets(reason=>received.push(reason));
  h.broadcastExperienceReset('logout');const own=h.channels[1].sent;
  assert.deepEqual(Object.keys(own).sort(),['at','id','reason','source']);
  const deliver=data=>h.channels[0].onmessage({data});
  deliver(own);deliver({...own,id:'other',source:'foreign',at:-100000});deliver({...own,id:'other',source:'foreign',reason:'unrecognized'});
  const valid={...own,id:'other',source:'foreign'};deliver(valid);deliver(valid);
  assert.deepEqual(received,['logout']);cleanup();assert.equal(h.channels[0].closed,true);
});

test('storage fallback sends ephemeral invalidation and rejects malformed payloads', () => {
  const h=signals(false),received=[];h.subscribeExperienceResets(reason=>received.push(reason));h.broadcastExperienceReset('identity');
  assert.equal(h.writes.length,1);const [key,payload]=h.writes[0];const signal=JSON.parse(payload);
  h.listeners.get('storage')({key,newValue:'broken'});
  h.listeners.get('storage')({key,newValue:JSON.stringify({...signal,id:'foreign-id',source:'foreign'})});
  assert.deepEqual(received,['identity']);
});
