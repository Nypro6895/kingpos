import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';import {timingSafeEqual}from'node:crypto';
function source(file,globals){const raw=fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),tree=ts.createSourceFile(file,raw,ts.ScriptTarget.Latest,true);const code=tree.statements.filter(n=>!ts.isImportDeclaration(n)).map(n=>n.getText(tree)).join('\n');const sandbox={exports:{},Date,AbortSignal,Error,Buffer,Response,Promise,...globals};vm.runInNewContext(ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,sandbox);return sandbox.exports;}
function worker(jobs,options={}){
 let claims=0;const calls=[],result={lines:['fixture']};
 const client={rpc(name,args){
  calls.push({name,args});
  return{abortSignal:async()=>{
   if(name==='claim_payroll_close_jobs')return{data:claims++?[]:jobs,error:null};
   if(name==='publish_payroll_period_base'&&args.p_input===options.reject)return{data:null,error:{message:'fixture connection lost'}};
   return{data:{baseId:'base'},error:null};
  }};
 }};
 const api=source('lib/payroll-close-worker.ts',{process:{env:options.unconfigured?{}:{NEXT_PUBLIC_SUPABASE_URL:'http://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-not-a-key'}},createClient:()=>client,calculateFrozenPayrollPublication:packet=>{if(packet.invalid)throw Error('fixture invalid');return result;}});
 return{api,calls,result};
}
test('Unconfigured worker is explicit and makes no RPC',async()=>{const{api,calls}=worker([],{unconfigured:true});assert.equal((await api.closeDuePayrollPeriods()).configured,false);assert.equal(calls.length,0);});
test('Worker publishes frozen packet identity and continues after one failed job',async()=>{const jobs=['ok','bad','next'].map(inputId=>({inputId,leaseId:'lease-'+inputId,inputSha256:'hash-'+inputId,packet:{}}));const{api,calls}=worker(jobs,{reject:'bad'}),result=await api.closeDuePayrollPeriods();assert.equal(result.published,2);assert.equal(result.failed,1);const published=calls.filter(c=>c.name==='publish_payroll_period_base');assert.equal(published.length,3);assert.equal(published[0].args.p_input_sha256,'hash-ok');assert.equal(published[0].args.p_lease,'lease-ok');assert.equal(calls.filter(c=>c.name==='fail_payroll_close_job').length,1);assert.equal(calls.find(c=>c.name==='fail_payroll_close_job').args.p_input,'bad');});
test('Calculation failure never publishes a partial result and returns the lease for retry',async()=>{const{api,calls}=worker([{inputId:'bad',leaseId:'lease',packet:{invalid:true}}]);assert.equal((await api.closeDuePayrollPeriods()).failed,1);assert.equal(calls.filter(c=>c.name==='publish_payroll_period_base').length,0);assert.equal(calls.at(-1).name,'fail_payroll_close_job');});
test('Cron endpoint denies absent/wrong authorization before invoking worker',async()=>{let invoked=0;const{GET}=source('app/api/payroll/close-due/route.ts',{process:{env:{CRON_SECRET:'synthetic-fixture'}},timingSafeEqual,closeDuePayrollPeriods:async()=>{invoked++;return{configured:true,published:0,failed:0};}});for(const value of['','Bearer wrong','Bearer synthetic-fixturf'])assert.equal((await GET(new Request('http://fixture.invalid',{headers:{authorization:value}}))).status,401);assert.equal(invoked,0);assert.equal((await GET(new Request('http://fixture.invalid',{headers:{authorization:'Bearer synthetic-fixture'}}))).status,200);assert.equal(invoked,1);});
test('Cron failure stays retryable and does not expose internal error details',async()=>{const{GET}=source('app/api/payroll/close-due/route.ts',{process:{env:{CRON_SECRET:'synthetic-fixture'}},timingSafeEqual,closeDuePayrollPeriods:async()=>{throw Error('fixture internal private detail');}});const r=await GET(new Request('http://fixture.invalid',{headers:{authorization:'Bearer synthetic-fixture'}}));assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/private detail/);});
