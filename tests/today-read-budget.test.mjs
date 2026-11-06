import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

test('complete financial reads survive the widget budget and still have a finite deadline',async t=>{
 const file='lib/today-dashboard.ts',source=fs.readFileSync(file,'utf8');
 const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
 const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='measureTodayRead');
 const code=ts.transpileModule(fs.readFileSync('lib/dashboard-deadline.ts','utf8')+'\n'+fn.getText(ast),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const api={};new Function('exports','getReadRequestTiming',code+'\nexports.measure=measureTodayRead;')(api,()=>undefined);
 t.mock.timers.enable({apis:['setTimeout']});
 for(const stage of ['financial_report','financial_compare']){
   let settled=false;
   const pending=api.measure(stage,()=>new Promise(resolve=>setTimeout(()=>resolve('authoritative facts'),2500))).then(value=>{settled=true;return value;});
   t.mock.timers.tick(1801);await Promise.resolve();assert.equal(settled,false);
   t.mock.timers.tick(700);assert.equal(await pending,'authoritative facts');
   const hung=api.measure(stage,()=>new Promise(()=>{})).catch(error=>error.message);
   t.mock.timers.tick(10000);assert.match(await hung,/retry/);
 }
 const optional=api.measure('extras',()=>new Promise(()=>{})).catch(error=>error.message);
 t.mock.timers.tick(1800);assert.match(await optional,/retry/);
});
