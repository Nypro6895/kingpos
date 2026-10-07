import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createHash } from 'node:crypto';

function harness({ dbError=null, release={href:'/desktop-updates/test.exe',version:'1.0.0'}, user={id:'owner',status:'active'} }={}) {
 const writes=[];const calls=[];
 const client={from:()=>({upsert:async value=>{writes.push(value);return {error:dbError};}}),rpc:async(name,args)=>{calls.push({name,args});return {data:true,error:dbError};}};
 const dependencies={
  'next/headers':{cookies:async()=>({get:()=>({value:'login-one'})})},
  'node:crypto':{createHash},
  '@/lib/account-security-shared':{ACCOUNT_LOGIN_SESSION_COOKIE:'session'},
  '@/lib/supabase/server':{createAuthenticatedSupabaseServerClient:async()=>client,getAccessTokenFromRequest:async()=>null},
  '@/lib/users/current-user':{getCurrentKingUser:async()=>user},
  '@/lib/windows-pos-release':{getWindowsPosRelease:async()=>release},
 };
 const exports={};
 const source=ts.transpileModule(readFileSync('app/api/pos/windows-download/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(source,{exports,require:name=>dependencies[name],Response,URL,Date});
 return {writes,calls,post:(action,origin='https://pos.example',pos=true)=>exports.POST(new Request('https://pos.example/api/pos/windows-download',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify({action,pos})}))};
}
test('download suppresses reminders; later preserves the download while allowing reminders',async()=>{
 const h=harness();
 assert.equal((await h.post('download')).status,200);
 assert.ok(h.writes[0].downloaded_at);assert.equal(h.writes[0].remind_after_download,false);
 await h.post('later');assert.equal(h.writes[1].remind_after_download,true);assert.equal(h.writes[1].never_remind,false);assert.equal('downloaded_at' in h.writes[1],false);
 await h.post('never');assert.equal(h.writes[2].never_remind,true);
});
test('check uses the login identity and atomic database decision',async()=>{
 const h=harness();assert.equal((await (await h.post('check')).json()).show,true);
 assert.equal(h.calls[0].args.p_session,createHash('sha256').update('login-one').digest('hex'));
 assert.equal(h.calls[0].args.p_pos,true);assert.equal(h.writes.length,0);
});
test('missing installer does not consume the reminder',async()=>{
 const h=harness({release:null});assert.equal((await (await h.post('check')).json()).show,false);assert.equal(h.calls.length,0);
});
test('rejects unauthenticated and cross-origin writes; reports database failures',async()=>{
 const h=harness();assert.equal((await h.post('never','https://other.example')).status,403);assert.equal(h.writes.length,0);
 assert.equal((await harness({user:null}).post('download')).status,401);
 assert.equal((await harness({dbError:{message:'unavailable'}}).post('download')).status,503);
 assert.equal((await h.post('invalid')).status,400);
});
