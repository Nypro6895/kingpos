import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const compile=path=>ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};

test('late notification seed cannot resurrect viewed notifications or overwrite live counts',()=>{
  const exports={};
  const source=compile('lib/notification-client.ts')+'\nexports.createStore=createNotificationStore;';
  vm.runInNewContext(source,{exports,require:()=>({}),Date,AbortController,setTimeout,clearTimeout});
  const empty={total:0,bookingNotifications:0,previewItems:[]};
  const seed={total:2,bookingNotifications:2,previewItems:[{id:'app:one',unread:true}]};
  const store=exports.createStore(empty,'owner:salon');
  store.seed(seed,'other:salon');assert.equal(store.snapshot().total,0);
  store.seed(seed,'owner:salon');assert.equal(store.snapshot().total,2);
  store.viewed(['one']);store.count(0,'owner:salon');
  store.seed(seed,'owner:salon');assert.equal(store.snapshot().total,0);
  assert.equal(store.snapshot().previewItems[0].unread,false);
});

function brokerHarness(t) {
  const effects=[],cleanups=[],receivers=[];
  const document=new EventTarget();document.visibilityState='visible';
  const window=new EventTarget();
  const navigator={onLine:true};
  let handshake,channels=0;
  const channel={on(_type,_event,callback){receivers.push(callback);return this;},subscribe(callback){handshake=callback;channels++;return this;}};
  const exports={};
  vm.runInNewContext(compile('lib/pos-workspace-sync.ts'),{
    exports,document,window,navigator,BroadcastChannel:undefined,Date,
    setTimeout,clearTimeout,setInterval,clearInterval,
    require(id){
      if(id==='react')return {useRef:value=>({current:value}),useEffect:fn=>effects.push(fn)};
      if(id.endsWith('supabase/browser'))return {createSupabaseBrowserClient:()=>({channel:()=>channel,removeChannel(){}})};
      if(id.endsWith('pos-staff-realtime'))return {getPosStaffRealtimeChannel:id=>id};
      throw Error(id);
    },
  });
  t.after(()=>cleanups.forEach(fn=>fn?.()));
  return {
    document,window,navigator,
    hook(resource,callback,options){exports.usePosResourceRefresh('salon',resource,callback,options);while(effects.length)cleanups.push(effects.shift()());},
    change(resource,ids){receivers[0]({payload:{salonId:'salon',resource,ids}});},
    subscribed(){handshake('SUBSCRIBED');},
    channels:()=>channels,
  };
}

test('fresh SSR does not refetch on mount/first socket handshake; one broker polls all views',async t=>{
  t.mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:1000000});
  const h=brokerHarness(t);let staff=0,settings=0;
  h.hook('staff',async()=>{staff++;},{initialReconcile:false});
  h.hook('settings',async()=>{settings++;},{initialReconcile:false});
  h.subscribed();t.mock.timers.tick(100);await flush();
  assert.equal(staff,0);assert.equal(settings,0);assert.equal(h.channels(),1);
  for(let i=0;i<5;i++){t.mock.timers.tick(60000);t.mock.timers.tick(100);await flush();}
  assert.equal(staff,5);assert.equal(settings,1,'configuration is polled less often');
});

test('event bursts merge IDs and changes during a request produce one trailing request',async t=>{
  t.mock.timers.enable({apis:['setTimeout','setInterval']});
  const h=brokerHarness(t),calls=[];let finish;
  h.hook('staff',ids=>{calls.push(ids);return new Promise(resolve=>finish=resolve);},{initialReconcile:false});
  for(let i=0;i<20;i++)h.change('staff',[`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`]);
  t.mock.timers.tick(100);assert.equal(calls.length,1);assert.equal(calls[0].length,20);
  h.change('staff');h.change('staff');t.mock.timers.tick(500);assert.equal(calls.length,1);
  finish();await flush();t.mock.timers.tick(100);assert.equal(calls.length,2);assert.equal(calls[1],undefined);
  finish();await flush();
});

test('hidden pages defer updates and reconnect repairs missed messages',async t=>{
  t.mock.timers.enable({apis:['setTimeout','setInterval']});
  const h=brokerHarness(t);let calls=0;
  h.hook('staff',async()=>{calls++;},{initialReconcile:false});h.subscribed();
  h.document.visibilityState='hidden';h.change('staff');t.mock.timers.tick(100);await flush();assert.equal(calls,0);
  h.document.visibilityState='visible';h.document.dispatchEvent(new Event('visibilitychange'));
  t.mock.timers.tick(100);await flush();assert.equal(calls,1);
  h.subscribed();t.mock.timers.tick(100);await flush();assert.equal(calls,2);
});

test('cached back-navigation reconciles an old server snapshot immediately',async t=>{
  t.mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:1000000});
  const h=brokerHarness(t);let calls=0;
  h.hook('staff',async()=>{calls++;},{initialReconcile:false,snapshotAt:900000});
  t.mock.timers.tick(0);await flush();assert.equal(calls,1);
  h.subscribed();t.mock.timers.tick(100);await flush();assert.equal(calls,1,'handshake does not fetch twice');
});

test('payroll batches row saves, waits for edits in progress, and cancels on unmount',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const exports={};new Function('exports',compile('lib/settled-refresh-queue.ts'))(exports);
  let calls=0;const queue=exports.createSettledRefreshQueue(()=>calls++);
  const a=Symbol(),b=Symbol();queue.begin(a);queue.begin(b);queue.finish(a,true);
  t.mock.timers.tick(2000);assert.equal(calls,0);
  queue.finish(b,true);t.mock.timers.tick(500);queue.begin(a);t.mock.timers.tick(2000);assert.equal(calls,0);
  queue.finish(a,true);t.mock.timers.tick(900);assert.equal(calls,1);
  queue.begin(a);queue.finish(a,true);queue.dispose();t.mock.timers.tick(2000);assert.equal(calls,1);
});

test('offline preparation skips fresh HTML and immutable assets, while renewing old snapshots',async()=>{
  let now=1000000;const cachesByName=new Map(),calls=[];
  const caches={async open(name){if(!cachesByName.has(name))cachesByName.set(name,new Map());const items=cachesByName.get(name);return {
    async match(key){return items.get(String(key))?.clone();},async put(key,response){items.set(String(key),response.clone());},
  };},async delete(name){return cachesByName.delete(name);}};
  const sandbox={URL,Response,AbortSignal,caches,Date:{now:()=>now},self:{location:{origin:'https://fixture.test'},addEventListener(){}},
    async fetch(path){calls.push(String(path));return String(path).includes('/_next/static/')?new Response('code'):new Response('<main data-portable-pos-shell></main><script src="/_next/static/a.js"></script>');},
  };
  vm.createContext(sandbox);vm.runInContext(readFileSync('public/portable-sw.js','utf8'),sandbox);
  const prepare=assets=>vm.runInContext(`prepare(${JSON.stringify({scope:'salon:key',assets})})`,sandbox);
  await prepare([]);assert.equal(calls.filter(path=>path==='/pos/portable').length,1);
  await prepare([]);assert.equal(calls.length,2,'no repeated HTML or asset request');
  await prepare(['https://fixture.test/_next/static/new.js']);assert.equal(calls.length,3,'only missing code chunk loads');
  now+=300001;await prepare([]);assert.equal(calls.filter(path=>path==='/pos/portable').length,2);
  assert.equal(calls.filter(path=>path.endsWith('/a.js')).length,1,'immutable asset remains cached');
  await vm.runInContext('clear()',sandbox);assert.equal(cachesByName.size,0);
});
