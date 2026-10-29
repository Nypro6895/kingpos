import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function harness({bot=false,detectorError=false,signalError=false,allowed=true}={}){
 const calls=[];const exports={};const env={VERCEL:'1',NEXT_PUBLIC_SUPABASE_URL:'https://example.test',SUPABASE_SERVICE_ROLE_KEY:'test'};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/abuse-server.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,process:{env},require(n){
  if(n==='@supabase/supabase-js')return {createClient:()=>({rpc:async(name,args)=>{calls.push({name,args});if(name==='abuse_preflight')return {data:{allowed,code:'restricted',message:'Admin restricted this account'},error:null};if(signalError)throw Error('provider unavailable');return {data:false,error:null};}})};
  if(n==='@/lib/abuse-context')return{getSafetyContext:async()=>({deviceHash:'a'.repeat(64),ipHash:'b'.repeat(64),country:'US'})};
  if(n==='@/lib/users/current-user')return{getCurrentKingUser:async()=>({id:'22222222-2222-4222-8222-222222222222'})};
  if(n==='botid/server')return{checkBotId:async()=>{if(detectorError)throw Error('detector unavailable');return{isBot:bot}}};
  if(n==='@/lib/abuse-signals')return{abuseHash:x=>x};return{};
 }});return{assert:exports.assertAbuseRequest,calls};
}
test('bot false positives and signal persistence errors never block social publishing',async()=>{
 for(const action of ['post','comment','report'])for(const signalError of [false,true]){const h=harness({bot:true,signalError});await h.assert(action);assert.ok(h.calls.some(c=>c.name==='record_abuse_bot_event'));}
});
test('detector outages are advisory for social actions; authentication remains enforced',async()=>{
 for(const action of ['post','comment','report']){const h=harness({detectorError:true});await h.assert(action);assert.equal(h.calls.at(-1).args.p_reason,'Safety detector unavailable');}
 await assert.rejects(harness({detectorError:true}).assert('signup'),/temporarily unavailable/);
 await assert.rejects(harness({bot:true}).assert('signup'),/security check/);
});
test('manual preflight restrictions still block social actions before bot detection',async()=>{
 for(const action of ['post','comment','report'])await assert.rejects(harness({allowed:false}).assert(action),/Admin restricted/);
});
