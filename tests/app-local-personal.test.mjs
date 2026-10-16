import test from'node:test';import assert from'node:assert/strict';import{build}from'esbuild';
async function fixture(){
 const state=globalThis.localPersonalFixture={context:{scope:'scope-a',user:{id:'viewer-a'}},calls:[],profile:{ok:true,data:{profile:{id:'owned-profile'},timeline:{items:[]},visitCandidates:[]}},upcoming:{ok:true,data:[]},notifications:[],posts:0};
 const modules={'server-only':'','next/headers':'export async function headers(){return new Headers()}',
  'request-business-context':'export async function getRequestBusinessContext(){return globalThis.localPersonalFixture.context}',
  'experience-context':'export const getExperienceContext=context=>({scope:context.scope})',
  'beauty':'export async function getSelfBeautyProfilePage(){const s=globalThis.localPersonalFixture;s.calls.push("beauty");return s.profile}',
  'post-comments':'export async function getPostCommentViewer(){return{identity:{},isAuthenticated:true}}',
  'customer-bookings':'export async function listCustomerBookings(input){const s=globalThis.localPersonalFixture;s.calls.push(input);return s.upcoming}',
  'notification-center':'export async function loadNotificationPage(context,args){const s=globalThis.localPersonalFixture;s.calls.push(args);return{items:s.notifications,cursor:null}}',
  'workspace-pending':'export async function getWorkspacePendingSummary(){return{previewItems:[{source:"app",id:"already-in-feed"},{source:"task",id:"pending-task"}]}}',
  '@/app/api/notifications/route':'export async function GET(){return Response.json({items:[]})}export async function POST(request){globalThis.localPersonalFixture.posts++;return Response.json({received:await request.json()},{status:409})}',
 };
 const output=await build({entryPoints:['lib/app-local-personal-resources-server.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'original-boundary-fixture',setup(b){b.onResolve({filter:/.*/},a=>{const key=Object.keys(modules).find(k=>a.path===k||a.path.endsWith('/'+k));return key?{path:key,namespace:'fixture'}:undefined});b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:modules[a.path]}));}}]});
 return{state,...await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'))};
}
test('personal profile and notification reads preserve current ownership, unchanged versions and failed-read boundaries',async()=>{
 const{state,readAppLocalPersonalResource:read}=await fixture();
 await assert.rejects(read('page.beauty',{}, {scope:'other'}),{status:409});assert.equal(state.calls.length,0);
 state.context.user=null;await assert.rejects(read('page.beauty',{}, {scope:'scope-a'}),{status:401});state.context.user={id:'viewer-a'};
 const first=await read('page.beauty',{}, {scope:'scope-a'});assert.equal(first.data.profile.profile.id,'owned-profile');assert.equal(first.data.booking,null);assert.deepEqual(state.calls.at(-1),{scope:'upcoming',limit:1});
 const unchanged=await read('page.beauty',{}, {scope:'scope-a',etag:first.etag});assert.equal(unchanged.status,304);assert.equal('data'in unchanged,false);
 state.upcoming={ok:false};await assert.rejects(read('page.beauty',{}, {scope:'scope-a'}),{status:503});
 const feed=await read('page.notifications',{filter:'unread'}, {scope:'scope-a'});assert.deepEqual(feed.data.actionItems,[{source:'task',id:'pending-task'}]);assert.equal(feed.data.initialFilter,'unread');
 await assert.rejects(read('http.notifications.feed',{token:'private'}, {scope:'scope-a'}),{status:400});
});
test('notification read-mark command invokes the original endpoint once and preserves its rejected result',async()=>{
 const{state,runAppLocalPersonalCommand:command}=await fixture();const request=new Request('https://reylumi.com/api/app-local/command',{method:'POST',headers:{origin:'https://reylumi.com'}});
 const value=await command('http.notifications.viewed',{input:{ids:['owned-id']}},request,'scope-a');assert.equal(value.data.status,409);assert.equal(state.posts,1);
 await assert.rejects(command('http.notifications.viewed',{input:{}},new Request(request.url,{method:'POST',headers:{origin:'https://foreign.invalid'}}),'scope-a'),{status:403});assert.equal(state.posts,1);
});
