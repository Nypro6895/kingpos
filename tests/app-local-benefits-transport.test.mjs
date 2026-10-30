import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(file,modules={},globals={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>modules[n]??{},URL,Request,Response,Headers,DOMException,AbortController,setTimeout,clearTimeout,...globals});return exports;}
const role=load('lib/app-local-platform-types.ts'),portable=load('lib/app-local-portable-http-metadata.ts');
for(const mode of ['account','portable'])test(mode+' native Gift/Reward requests make one scoped bridge attempt, preserve errors and never replay',async()=>{
 const scope=mode==='account'?'account':'11111111-1111-1111-1111-111111111111:22222222-2222-2222-2222-222222222222';let active=scope,calls=[];
 const module=mode==='account'?load('lib/app-local-role-http-client.ts',{'./app-local-platform-types':role},{location:{href:'reylumi-app://bundle/pos'}}):load('lib/app-local-portable-http-client.ts',{'./app-local-portable-http-metadata':portable},{location:{href:'reylumi-app://bundle/pos'}});
 const factory=mode==='account'?module.createAppLocalRoleHttpFetch:module.createAppLocalPortableHttpFetch;
 const host={isNative:true,command:async(name,args,options)=>{calls.push({name,args,options});return{status:409,headers:{'content-type':'application/json'},body:'{"error":"Changed"}'};}};
 const fetch=factory({scope:()=>active,host:()=>host,fetch:async()=>{throw Error('Original fetch');}});
 for(const endpoint of ['gift-cards','rewards']){
  const response=await fetch('/api/'+endpoint,{method:'POST',body:JSON.stringify({scope:'pos',op:'submit',args:{sessionId:'synthetic'}})});
  assert.equal(response.status,409);assert.equal((await response.json()).error,'Changed');assert.equal(calls.at(-1).options.scope,scope);
 }
 assert.equal(calls.length,2);
 await assert.rejects(fetch('https://other.invalid/api/gift-cards',{method:'POST',body:'{}'}),/Original fetch/);
 await assert.rejects(fetch('/api/gift-cards?extra=1',{method:'POST',body:'{}'}));
 const controller=new AbortController();controller.abort();await assert.rejects(fetch('/api/rewards',{method:'POST',body:'{}',signal:controller.signal}));assert.equal(calls.length,2);
 host.command=async()=>{active='other';return{status:200,headers:{},body:'{}'};};
 await assert.rejects(fetch('/api/rewards',{method:'POST',body:'{}'}),/changed/);
});
test('account benefit bridge keeps same-origin and current account checks before original handlers',async()=>{
 let calls=0;const original=async req=>{calls++;assert.equal(req.headers.get('cookie'),'synthetic-session');return Response.json({ok:true},{headers:{'Cache-Control':'no-store'}});};
 const modules={'next/server':{NextRequest:Request},'next/headers':{headers:async()=>new Headers({'cookie':'synthetic-session'})},'./request-business-context':{getRequestBusinessContext:async()=>({user:{id:'u'}})},'./experience-context':{getExperienceContext:()=>({scope:'account'})},'./staff-portal-identity':{getStaffPortalIdentity:async()=>({context:{user:{id:'u'}},staff:null})},'./app-local-platform-types':role,'@/app/api/gift-cards/route':{POST:original},'@/app/api/rewards/route':{POST:original}};
 const api=load('lib/app-local-role-http-server.ts',modules),request=new Request('https://reylumi.com/api/app-local/command',{headers:{Origin:'https://reylumi.com'}});
 for(const name of ['http.benefits.gift-cards','http.benefits.rewards'])assert.equal((await api.runAppLocalRoleHttpCommand(name,{input:{scope:'pos',op:'read'}},request,'account')).status,200);
 await assert.rejects(api.runAppLocalRoleHttpCommand('http.benefits.gift-cards',{input:{}},request,'other'),/changed/);
 await assert.rejects(api.runAppLocalRoleHttpCommand('http.benefits.gift-cards',{input:{}},new Request(request.url,{headers:{Origin:'https://other.invalid'}}),'account'),/open the form/);
 assert.equal(calls,2);
});
