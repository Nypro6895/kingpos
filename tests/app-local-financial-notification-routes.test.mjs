import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

function load(file,name,deps){
 const ast=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true),declaration=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
 assert.ok(declaration,'actual route function '+name);
 const javascript=ts.transpileModule(declaration.getText(ast),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,exports={};
 new Function('exports',...Object.keys(deps),javascript)(exports,...Object.values(deps));return exports[name];
}
const urlFor=path=>new URL(path,'https://reylumi.com');
const general=load('lib/app-local-page-registry.tsx','getAppLocalPage',{urlFor,pages:{get:id=>({id})},getAppLocalHelpGuide:()=>null});
const owner=load('lib/app-local-owner-page-registry.tsx','getAppLocalOwnerPage',{urlFor,pages:{staff:{id:'owner.staff'},customers:{id:'owner.customers'},form:{id:'owner.customer-form'},detail:{id:'owner.customer-detail'},payroll:{id:'owner.payroll'}}});
const appLocalPath=load('lib/app-local-host.ts','appLocalPath',{});
const resolve=path=>general(path)??owner(path);
const event='12345678-1234-4234-8234-123456789abc';

test('registered Owner Today, Staff Daily/My Pay and Payroll pages admit only their explicit financial anchors',()=>{
 for(const [path,id]of [['/staff/today','owner.today'],['/staff/my-work','staff.work'],['/payroll','owner.payroll']])for(const hash of ['#input-history','#ticket-record']){
  const destination=`${path}?inputEvent=${event}&eventDate=2026-10-29&tab=payroll&payPeriodStart=2026-10-16%3A2026-10-31${hash}`;
  assert.equal(resolve(destination)?.id,id,destination);assert.equal(appLocalPath(destination),destination,'handoff retains exact query and fragment');
 }
 assert.equal(resolve('/staff/my-work')?.id,'staff.work');assert.equal(resolve('/payroll?tab=staff')?.id,'owner.payroll');
});
test('financial anchors do not admit unrelated pages or arbitrary/capability-bearing fragments',()=>{
 for(const path of ['/staff/appointments','/staff/workday','/staff','/services','/customers','/support','/market','/not-a-page'])for(const hash of ['#input-history','#ticket-record'])assert.equal(resolve(path+hash),null,path+hash);
 for(const path of ['/staff/today','/staff/my-work','/payroll'])for(const hash of ['#unknown','#payroll-changes','#input-history&access_token=secret','#%69nput-history','#ticket-record/secret'])assert.equal(resolve(path+hash),null,path+hash);
});
test('sensitive callback queries, unsafe paths and excessive query values remain rejected even with an approved financial anchor',()=>{
 for(const path of ['/staff/today','/staff/my-work','/payroll']){
  for(const key of ['token','%74oken','signature','password','code','payment','next','return_to'])assert.equal(resolve(`${path}?${key}=sensitive#input-history`),null,path+' '+key);
  assert.equal(resolve(`${path}?inputEvent=${'a'.repeat(513)}#ticket-record`),null);
 }
 for(const path of ['//other.invalid/staff/my-work#input-history','/staff%2fmy-work#input-history','/staff\\my-work#input-history'])assert.equal(resolve(path),null,path);
});
