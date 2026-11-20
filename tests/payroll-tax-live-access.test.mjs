import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source=fs.readFileSync('lib/payroll.ts','utf8'),ast=ts.createSourceFile('payroll.ts',source,ts.ScriptTarget.Latest,true);
const names=['requirePayrollContext','buildTaxCompanyLines','getPayrollTaxCompanyData'];
const code=names.map(name=>ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name).getText(ast)).join('\n');
const js=ts.transpileModule(code+'\nexport {requirePayrollContext};',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function fixture(permissions,owner=false){
 const state={financialReads:0};const exports={};
 new Function('exports','getCurrentBusinessContext','isSalonManageContext','isOwnerMembership','createAuthenticatedSupabaseServerClient','hasPermission','getLinkedCurrentStaffId','PAYROLL_PERMISSIONS','loadSalonPayrollSetting',js)(exports,
  async()=>({user:{id:'manager'},workspaceType:'salon',salonMode:'manage',currentMembership:{role:owner?'OWNER':'MANAGER'},currentAccount:{id:'account'},currentSalon:{id:'salon'}}),
  context=>context.workspaceType==='salon'&&context.salonMode==='manage',membership=>membership.role==='OWNER',
  async()=>({from(){state.financialReads++;throw Error('Reached private financial read');}}),async permission=>permissions.includes(permission),async()=>null,
  {view:'payroll.view',manage:'payroll.manage',taxCompany:'payroll.tax_company'},async()=>{state.financialReads++;throw Error('Reached private financial read');});
 return{...exports,state};
}
test('internal Tax Company permission alone cannot start either live financial report or fall back to default financial settings',async()=>{
 const f=fixture(['payroll.tax_company']);for(const read of [f.buildTaxCompanyLines,f.getPayrollTaxCompanyData])await assert.rejects(read({}),/requires Payroll view permission/);assert.equal(f.state.financialReads,0);
});
test('explicit Payroll view/manage or Owner authorization still admits live report reads',async()=>{
 for(const [permissions,owner] of [[['payroll.view'],false],[['payroll.manage'],false],[[],true]]){
  const f=fixture(permissions,owner);await assert.rejects(f.getPayrollTaxCompanyData({}),/Reached private financial read/);assert.equal(f.state.financialReads,1);
 }
});
test('non-report Tax Company capability remains available for its existing paystub authorization path',async()=>{
 const f=fixture(['payroll.tax_company']);const auth=await f.requirePayrollContext({taxCompanyOnly:true});assert.equal(auth.access.canViewTaxCompany,true);assert.equal(auth.access.canViewAllPayroll,false);assert.equal(f.state.financialReads,0);
});
