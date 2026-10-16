import test from 'node:test';
import assert from 'node:assert/strict';
import {build}from'esbuild';
const scope='v3:'+'a'.repeat(64);
async function readFixture(){
 const state=globalThis.appReadFixture={calls:[],value:{schemaVersion:1,status:200,scope,etag:'"same"',updatedAt:1,data:{name:'Staff A'}},status:0};
 const result=await build({entryPoints:['app/api/app-local/read/route.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'bounded-api',setup(b){b.onResolve({filter:/^(?:next\/|@\/lib\/app-local-)/},a=>a.path.endsWith('scope-id')?undefined:{path:a.path,namespace:'fixture'});b.onLoad({filter:/.*/,namespace:'fixture'},a=>{
  if(a.path==='next/server')return{contents:'export async function connection(){}',loader:'js'};
  if(a.path==='next/headers')return{contents:'export async function headers(){return new Headers()}',loader:'js'};
  return{contents:`export const ${a.path.endsWith('owner-resources-server')?'readAppLocalOwnerResource':a.path.endsWith('role-resources-server')?'readAppLocalRoleResource':a.path.endsWith('platform-resources-server')?'readAppLocalPlatformResource':a.path.endsWith('role-http-server')?'readAppLocalRoleHttpResource':a.path.endsWith('http-server')&&!a.path.includes('business')&&!a.path.includes('portable')?'readAppLocalHttpResource':a.path.endsWith('personal-resources-server')?'readAppLocalPersonalResource':a.path.endsWith('staff-relay-server')?'readAppLocalStaffRelayResource':a.path.endsWith('explore-server')?'readAppLocalExploreResource':a.path.endsWith('owner-page-registry-server')?'readAppLocalOwnerPageResource':a.path.endsWith('business-server')?'readAppLocalBusinessResource':a.path.endsWith('public-server')?'readAppLocalPublicResource':a.path.endsWith('daily-server')?'readAppLocalDailyResource':a.path.endsWith('business-http-server')?'readAppLocalBusinessHttpResource':a.path.endsWith('secondary-server')?'readAppLocalSecondaryResource':a.path.endsWith('payroll-tax-server')?'readAppLocalPayrollTaxResource':a.path.endsWith('commerce-server')?'readAppLocalCommerceResource':a.path.endsWith('shell-server')?'readAppLocalShellResource':a.path.endsWith('portable-server')?'readAppLocalPortableResource':a.path.endsWith('portable-http-server')?'readAppLocalPortableHttpResource':'readAppLocalDisplayResource'}=async(name,args,options)=>{if(!${a.path.endsWith('owner-resources-server')})return null;const s=globalThis.appReadFixture;s.calls.push({name,args,scope:options.scope,etag:options.etag});if(s.status)throw Object.assign(Error('fixture failure'),{status:s.status});return s.value;}`,loader:'js'};
 });}}]});
 return{state,...await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'))};
}
test('large named reads remain read-only, require same origin, preserve 304 and explicit authority failures',async()=>{
 const{state,GET,POST}=await readFixture(),url='https://reylumi.com/api/app-local/read',args={query:'x'.repeat(3500)},make=(origin='https://reylumi.com',body=JSON.stringify({name:'owner.check-in',scope,args}))=>new Request(url,{method:'POST',headers:{origin,'content-type':'application/json','if-none-match':'"same"'},body});
 assert.equal((await POST(make('https://foreign.invalid'))).status,403);assert.equal(state.calls.length,0);
 assert.equal((await POST(make(undefined,'x'.repeat(131073)))).status,413);assert.equal(state.calls.length,0);
 const result=await POST(make());assert.equal(result.status,200);assert.equal((await result.json()).data.name,'Staff A');assert.equal(state.calls[0].args.query.length,3500);
 state.value={...state.value,status:304};delete state.value.data;
 const notModified=await GET(new Request(url+'?'+new URLSearchParams({name:'owner.check-in',scope,args:'{}'}),{headers:{'if-none-match':'"same"'}}));assert.equal(notModified.status,304);assert.equal(await notModified.text(),'');assert.equal(notModified.headers.get('x-reylumi-scope'),scope);
 for(const status of[401,403,404,409,503]){state.status=status;assert.equal((await POST(make())).status,status);}
});
