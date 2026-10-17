import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import ts from 'typescript';
const file='app/(app)/payroll/page.tsx';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}};
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(before=false){
 const source=before?execFileSync('git',['show','1ade935:'+file],{encoding:'utf8'}):readFileSync(file,'utf8');
 const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='PayrollPage');
 const code=fn.body.statements.slice(0,fn.body.statements.findIndex(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(ast)==='activeTab'))).map(n=>n.getText(ast)).join('\n');
 const totals=deferred(),download=deferred(),tax=deferred(),calls=[],payload={live:{lines:[{staffId:'a',finalIncome:44.25}]},period:{start:'2026-10-01'},access:{canViewAllPayroll:true}},exports={};let deny=false;
 vm.runInNewContext(ts.transpileModule(`export async function bootstrap({searchParams}){${code};return {data,taxPlugin,downloadEnabled,canManageConnection}}`,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText,{
  exports,Promise,Error,NoPermissionState:'denied',React:{createElement:(type,props)=>({type,props})},
  getWorkspaceTranslation:async()=>x=>x,requireSalonManagePageContext:async()=>{if(deny)throw Error('access denied');return{currentMembership:{owner:true}}},isOwnerMembership:m=>m.owner,
  getPayrollPageData:async args=>{calls.push(['totals',args]);await totals.promise;return payload},
  payrollDataPluginInstalled:async()=>{calls.push(['download']);return download.promise},
  taxCompanySettings:async()=>{calls.push(['tax']);return tax.promise},
 });
 return{read:args=>exports.bootstrap({searchParams:Promise.resolve(args)}),calls,totals,download,tax,payload,deny:()=>deny=true};
}
test('web Payroll overlaps independent configuration and keeps the original payroll and tax result',async()=>{
 const outputs=[];
 for(const before of [true,false]){
  const f=fixture(before),pending=f.read({tab:'tax',preset:'current_month'});await tick();
  assert.equal(f.calls.some(([name])=>name==='download'),!before);
  f.totals.resolve();await tick();assert.ok(f.calls.some(([name])=>name==='tax'),'Tax Company starts even while download is held');
  f.tax.resolve({installed:true});f.download.resolve(true);outputs.push(JSON.parse(JSON.stringify(await pending)));
 }
 assert.deepEqual(outputs[1],outputs[0]);assert.equal(outputs[1].data.live.lines[0].finalIncome,44.25);
});
test('web Payroll keeps authorization, original calculation errors and optional plugin failure handling',async()=>{
 const denied=fixture();denied.deny();await assert.rejects(denied.read({}),/access denied/);assert.deepEqual(denied.calls,[]);
 const failed=fixture(),pending=failed.read({});failed.totals.reject(Error('payroll unavailable'));failed.download.reject(Error('optional unavailable'));const result=await pending;assert.equal(result.type,'denied');assert.equal(result.props.message,'payroll unavailable');
 const optional=fixture(),working=optional.read({});optional.totals.resolve();optional.download.reject(Error('optional unavailable'));const data=await working;assert.equal(data.downloadEnabled,false);assert.equal(data.taxPlugin,null);assert.deepEqual(JSON.parse(JSON.stringify(data.data)),optional.payload);
});
