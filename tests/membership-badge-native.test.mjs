import test from 'node:test';import assert from 'node:assert/strict';import{build}from'esbuild';import fs from'node:fs';
const built=await build({entryPoints:['lib/app-local-shell-http-client.ts'],bundle:true,write:false,platform:'node',format:'cjs',plugins:[{name:'host',setup(b){b.onResolve({filter:/^\.\/app-local-(host|command-client)$/},a=>({path:a.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export const getAppLocalHost=()=>null;export const getAppLocalCommandScope=()=>undefined;'}));}}]});
const m={exports:{}};new Function('module','exports',built.outputFiles[0].text)(m,m.exports);
test('Native affiliation lookup is a scoped cancellable read, never a persisted command or local-scheme fetch',async()=>{
 const calls=[],id='00000000-0000-4000-8000-000000000001',input=JSON.stringify({ids:[id]}),controller=new AbortController();let scope='owner-A';
 const fetch=m.exports.createAppLocalShellHttpFetch({location:'reylumi-app://bundle/explore',scope:()=>scope,host:()=>({isNative:true,read:async(name,args,options)=>{calls.push({name,args,scope:options.scope,signal:options.signal});return{data:{status:200,headers:{'content-type':'application/json'},body:'{"badges":[]}'}};},command:()=>{throw Error('Not a command');}}),fetch:()=>{throw Error('Not a scheme fetch');}});
 const res=await fetch('/api/membership/salon-badges',{method:'POST',body:input,signal:controller.signal});assert.deepEqual(await res.json(),{badges:[]});assert.equal(calls.length,1);assert.equal(calls[0].name,'http.shell.membership-badges');assert.deepEqual(calls[0].args,{input});assert.equal(calls[0].scope,'owner-A');assert.equal(calls[0].signal,controller.signal);
 scope=undefined;await assert.rejects(()=>fetch('/api/membership/salon-badges',{method:'POST',body:input}),/verify your account/);assert.equal(calls.length,1);
 scope='owner-A';controller.abort();await assert.rejects(()=>fetch('/api/membership/salon-badges',{method:'POST',body:input,signal:controller.signal}));assert.equal(calls.length,1);
 await assert.rejects(()=>fetch('/api/membership/salon-badges',{method:'POST',body:' '.repeat(10001)}),/could not be sent/);assert.equal(calls.length,1);
 const metadata=fs.readFileSync('lib/app-local-shell-metadata.ts','utf8');assert.match(metadata,/name: "http.shell.membership-badges", argumentKeys: \["input"\], retain: false/);
});
test('A native identity change discards the former badge response',async()=>{
 let scope='first';const fetch=m.exports.createAppLocalShellHttpFetch({location:'reylumi-app://bundle/explore',scope:()=>scope,host:()=>({isNative:true,read:async()=>{scope='second';return{data:{status:200,body:'{"badges":[]}',headers:{}}};}}),fetch:()=>{throw Error('fallback');}});
 await assert.rejects(()=>fetch('/api/membership/salon-badges',{method:'POST',body:'{"ids":[]}'}),/account has changed/);
});
