import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
mkdirSync('artifacts/owner-financial-attention/unit',{recursive:true});
await build({entryPoints:['lib/app-local-role-http-client.ts'],bundle:true,platform:'node',format:'cjs',outfile:'artifacts/owner-financial-attention/unit/native.cjs',plugins:[{name:'native-host',setup(b){b.onResolve({filter:/app-local-host$/},()=>({path:'host',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const getAppLocalHost=()=>{throw Error("Unexpected default host")};'}));}}]});
const {createAppLocalRoleHttpFetch}=createRequire(import.meta.url)('../artifacts/owner-financial-attention/unit/native.cjs');
const wire={status:200,headers:{'content-type':'application/json'},body:'{"ok":true}'};
test('native attention read uses scoped uncached named read instead of a write or raw network',async()=>{
 const calls=[];
 const fetch=createAppLocalRoleHttpFetch({scope:()=> 'workspace',host:()=>({isNative:true,read:async(name,args,options)=>{calls.push({name,args,scope:options.scope});return{scope:'workspace',data:wire}},command:()=>{throw Error('Read must not be a command')}}),fetch:()=>{throw Error('Raw network not allowed')}});
 assert.deepEqual(await(await fetch('/api/owner-attention?salonId=salon&item=event%3A1')).json(),{ok:true});
 assert.deepEqual(calls,[{name:'http.owner.attention',args:{salonId:'salon',item:'event:1'},scope:'workspace'}]);
 await assert.rejects(fetch('/api/owner-attention?salonId=salon&unexpected=1'),/Unsupported/);
});
test('native Ignore is a single pinned command preserving viewer and salon identity',async()=>{
 const calls=[];
 const fetch=createAppLocalRoleHttpFetch({scope:()=> 'workspace',host:()=>({isNative:true,command:async(...args)=>{calls.push(args);return wire}}),fetch:()=>{throw Error('Raw network not allowed')}});
 const body={op:'ignore',salonId:'salon',viewerId:'owner',item:'discount:1'};
 await fetch('/api/owner-attention',{method:'POST',body:JSON.stringify(body)});
 assert.deepEqual(calls,[['http.owner.attention',{input:body},{scope:'workspace'}]]);
});
test('native scope changes reject a late read',async()=>{
 let scope='workspace';
 const fetch=createAppLocalRoleHttpFetch({scope:()=>scope,host:()=>({isNative:true,read:async()=>{scope='other';return{scope:'workspace',data:wire}}}),fetch:()=>{throw Error('Raw network not allowed')}});
 await assert.rejects(fetch('/api/owner-attention?salonId=salon'),/account has changed/);
});
