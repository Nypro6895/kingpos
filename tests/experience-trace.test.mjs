import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function fixture(active) {
  const exports = {}, window = { __reylumiDiagnosticsEnabled: active, addEventListener() {} }, document = {addEventListener(){}};
  const code = ts.transpileModule(readFileSync('lib/experience-trace.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('exports','window','document','performance',code)(exports,window,document,{now:()=>123.456});
  return {...exports,window};
}
test('disabled diagnostics retain no observations or browser diagnostic interface',()=>{
  const f=fixture(false);
  f.recordExperienceTrace('auth.start',{status:200});
  assert.deepEqual(f.getExperienceTraceSnapshot(),[]);
  assert.equal(f.window.__reylumiDiagnostics,undefined);
  assert.equal(f.nextExperienceTraceOperation(),0);
});
test('trace accepts only fixed enums and bounded numeric/boolean fields; never dynamic data',()=>{
  const f=fixture(true), privateText='private-customer-cookie-query';
  f.recordExperienceTrace('auth.start',{source:'app-local',trigger:'mount',reason:'unknown',status:503,durationMs:123,operation:2,blocked:true,scope:privateText,url:privateText,error:privateText});
  f.recordExperienceTrace(privateText,{reason:privateText});
  f.recordExperienceTrace('auth.end',{source:privateText,trigger:privateText,reason:privateText,area:privateText,phase:privateText,durationMs:Infinity,status:NaN});
  const values=f.getExperienceTraceSnapshot();
  assert.equal(values.length,2);assert.equal(JSON.stringify(values).includes(privateText),false);
  assert.deepEqual(values[1],{sequence:2,atMs:123.5,event:'auth.end'});
  assert.equal(values[0].blocked,true);assert.equal(values[0].status,503);
});
test('trace ring is bounded and snapshots are copies; clear drops observations',()=>{
  const f=fixture(true);
  for(let i=0;i<1000;i++)f.recordExperienceTrace('cache.hit',{operation:i,status:-1e9,durationMs:1e9});
  const values=f.window.__reylumiDiagnostics.snapshot();
  assert.equal(values.length,256);assert.equal(values[0].sequence,745);
  assert.equal(values[0].status,-10000);assert.equal(values[0].durationMs,604800000);
  values[0].event='private';assert.equal(f.getExperienceTraceSnapshot()[0].event,'cache.hit');
  f.window.__reylumiDiagnostics.clear();assert.deepEqual(f.getExperienceTraceSnapshot(),[]);
});
