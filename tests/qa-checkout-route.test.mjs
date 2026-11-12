import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {build} from 'esbuild';

const require = createRequire(import.meta.url);
const origin = 'http://localhost:3117';
const id = 'cs_test_qa_' + 'a'.repeat(32);
const orderId = '00000000-0000-0000-0000-000000000001';
const bundle = await build({entryPoints:['app/qa/checkout/[session]/route.ts'],bundle:true,write:false,platform:'node',format:'cjs',plugins:[{
  name:'qa-route-fixture',setup(b){
    for(const name of ['next/server','@/lib/users/current-user','@supabase/supabase-js','node:fs/promises'])b.onResolve({filter:new RegExp('^'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$')},()=>({path:name,namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:{
      'next/server':'export async function connection(){}',
      '@/lib/users/current-user':'export async function getCurrentKingUser(){return globalThis.fixture.user}',
      'node:fs/promises':'export async function readFile(){return "fixture-local-provider-secret"}',
      '@supabase/supabase-js':`export function createClient(){return {from(){const filters={};return {select(){return this},eq(k,v){filters[k]=v;return this},async maybeSingle(){const order=globalThis.fixture.order;return {error:null,data:filters.id===order.id&&filters.actor_id===order.actor_id?order:null}}}}}}`,
    }[a.path],loader:'js'}));
  },
}]});

function fixture(overrides={}) {
  const state={user:{id:'actor-a',email:'customer@qa.reylumi.invalid'},order:{id:orderId,actor_id:'actor-a',stripe_session:id,amount:10000,token:'b'.repeat(64),status:'pending'},session:{id,livemode:false,currency:'usd',amount_total:10000,metadata:{gift_card_order:orderId}},paid:0,reads:0,...overrides};
  const env={NODE_ENV:'development',REYLUMI_QA_MODE:'local',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:55421',NEXT_PUBLIC_APP_URL:origin,SUPABASE_SERVICE_ROLE_KEY:'fixture-only'};
  const module={exports:{}};
  const context=vm.createContext({module,exports:module.exports,require,process:{env,cwd:()=>process.cwd()},fixture:state,Request,Response,URL,Buffer,AbortSignal,fetch:async(url,options={})=>{
    assert.match(url,new RegExp('^http://127\\.0\\.0\\.1:3118/checkout/'+id+'(?:/pay)?$'));
    if(options.method==='POST'){state.paid++;return Response.json(state.session)}
    state.reads++;return Response.json(state.session);
  }});
  vm.runInContext(bundle.outputFiles[0].text,context);
  return {route:module.exports,state,env};
}
const params={params:Promise.resolve({session:id})};
const get=()=>new Request(`${origin}/qa/checkout/${id}`);
function post(csrf,operation='approve',requestOrigin=origin){return new Request(get(),{method:'POST',headers:{Origin:requestOrigin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({csrf,operation})})}

test('checkout controls are absent in production and outside the exact local QA environment',async()=>{
  for(const [key,value]of [['NODE_ENV','production'],['REYLUMI_QA_MODE',''],['NEXT_PUBLIC_SUPABASE_URL','https://outside.invalid'],['NEXT_PUBLIC_APP_URL','https://reylumi.com']]){
    const f=fixture();f.env[key]=value;
    assert.equal((await f.route.GET(get(),params)).status,404);
    assert.equal((await f.route.POST(post(''),params)).status,404);
    assert.equal(f.state.reads,0);assert.equal(f.state.paid,0);
  }
});
test('a guessed session or another signed-in customer cannot access or approve the order',async()=>{
  for(const user of [null,{id:'actor-b',email:'outsider@qa.reylumi.invalid'}]){
    const f=fixture({user});assert.equal((await f.route.GET(get(),params)).status,403);
    assert.equal((await f.route.POST(post('c'.repeat(64)),params)).status,403);assert.equal(f.state.paid,0);
  }
  const f=fixture();assert.equal((await f.route.GET(get(),{params:Promise.resolve({session:'bad'})})).status,403);assert.equal(f.state.reads,0);
});
test('cross-origin, CSRF and mismatched amount submissions never pay',async()=>{
  const f=fixture();const html=await (await f.route.GET(get(),params)).text();const csrf=html.match(/name="csrf" value="([a-f0-9]+)"/)[1];
  assert.ok(!html.includes('fixture-local-provider-secret'));
  assert.equal((await f.route.POST(post(csrf,'approve','http://outside.invalid'),params)).status,403);
  assert.equal((await f.route.POST(post('c'.repeat(64)),params)).status,403);
  f.state.session.amount_total=1;assert.equal((await f.route.POST(post(csrf),params)).status,403);assert.equal(f.state.paid,0);
});
test('authenticated approval is local and cancel returns to the same order without paying',async()=>{
  for(const operation of ['cancel','approve']){
    const f=fixture();const page=await f.route.GET(get(),params);assert.equal(page.headers.get('referrer-policy'),'same-origin');const html=await page.text();const csrf=html.match(/name="csrf" value="([a-f0-9]+)"/)[1];
    const r=await f.route.POST(post(csrf,operation),params);assert.equal(r.status,303);
    assert.equal(r.headers.get('location'),`${origin}/gift-cards?order=${f.state.order.token}${operation==='cancel'?'&cancelled=1':''}`);
    assert.equal(f.state.paid,operation==='approve'?1:0);
  }
});
