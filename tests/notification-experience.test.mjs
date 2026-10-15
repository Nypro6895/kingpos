import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const compile = path => ts.transpileModule(readFileSync(path, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const api={};vm.runInNewContext(compile('lib/notification-experience.ts'),{exports:api});
const row=(id,day,unread=true)=>({id,createdAt:`2026-10-${String(day).padStart(2,'0')}T12:00:00Z`,unread});
const olderCursor={at:'2026-10-01T12:00:00Z',id:'older'};

test('silent refresh replaces covered records, drops removed rows and preserves loaded older pages/cursor',()=>{
 const previous={items:[row('deleted',10),row('updated',9),row('older',2)],cursor:olderCursor};
 const fresh={items:[row('new',11),row('updated',9,false)],cursor:{at:'2026-10-09T12:00:00Z',id:'updated'}};
 const result=api.reconcileNotificationWindow(previous,fresh);
 assert.deepEqual(Array.from(result.items,item=>item.id),['new','updated','older']);
 assert.equal(result.items[1].unread,false);assert.equal(result.cursor,olderCursor);
});

test('complete and empty refreshed windows remove stale trailing records',()=>{
 const previous={items:[row('old',2)],cursor:olderCursor};
 assert.equal(api.reconcileNotificationWindow(previous,{items:[],cursor:null}).items.length,0);
 assert.deepEqual(Array.from(api.reconcileNotificationWindow(previous,{items:[row('current',11)],cursor:null}).items,item=>item.id),['current']);
});

test('equal timestamp boundary preserves only older IDs and pagination updates duplicate rows once',()=>{
 const previous={items:[row('c',9),row('b',9),row('a',9)],cursor:olderCursor};
 const result=api.reconcileNotificationWindow(previous,{items:[row('b',9,false)],cursor:{at:'date',id:'b'}});
 assert.deepEqual(Array.from(result.items,item=>item.id),['b','a']);
 const appended=api.appendNotificationWindow(previous,{items:[row('b',9,false),row('older',1)],cursor:null});
 assert.deepEqual(Array.from(appended.items,item=>item.id),['c','b','a','older']);assert.equal(appended.items[1].unread,false);
});

function pendingViewed() {
 const exports={},listeners=new Map(),events=[],timers=[];let resolve,requests=0,suspended=false;
 const window={ addEventListener:(name,fn)=>listeners.set(name,fn),dispatchEvent:event=>events.push(event.type) };
 vm.runInNewContext(compile('lib/notification-client.ts'),{exports,window,AbortController,
   CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},Event,
   setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout:id=>{timers[id-1]=null;},
   fetch:()=>{requests++;return new Promise(r=>{resolve=r;});},
   require:name=>name==='react'?{}:{experienceResourceCache:{stats:()=>({suspended})}},
 });
 return {...exports,events,timers,get requests(){return requests;},reset(){suspended=true;listeners.get('reylumi:experience-reset')();},resolve(response){resolve(response);}};
}

test('logout cancels queued viewed writes before network and prevents further suspended writes',()=>{
 const h=pendingViewed();h.queueViewedNotification('old-viewer');h.reset();h.queueViewedNotification('other');
 assert.equal(h.timers[0],null);assert.equal(h.requests,0);assert.equal(h.timers.length,1);
});

test('a viewed response finishing after account reset emits no old-account events',async()=>{
 const h=pendingViewed();h.queueViewedNotification('old-viewer');const running=h.timers[0]();h.reset();h.resolve(Response.json({unreadCount:9,scopeKey:'old'}));await running;
 assert.deepEqual(h.events,[]);
});
