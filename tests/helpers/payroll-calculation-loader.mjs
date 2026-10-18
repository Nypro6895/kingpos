import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import ts from 'typescript';
// Execute the checked-in calculation with no Next request, database or network.
// Import declarations are resolved explicitly; business functions are unchanged.
export function loadPayrollCalculation(root=process.cwd(),auth=null){
 const dependencies={};
 function load(file){
   const source=fs.readFileSync(path.join(root,file),'utf8'),tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
   const code=tree.statements.filter(n=>!ts.isImportDeclaration(n)).map(n=>auth&&ts.isFunctionDeclaration(n)&&n.name?.text==='requirePayrollManageContext'?'async function requirePayrollManageContext(){return __auth;}':n.getText(tree)).join('\n');
   const output=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
   const sandbox={exports:{},console,Intl,Date,Map,Set,Math,Number,Promise,Boolean,Array,Object,Error,Buffer,AbortSignal,structuredClone,__auth:auth,...dependencies};
   vm.runInNewContext(output,sandbox,{filename:file});Object.assign(dependencies,sandbox.exports);
 }
 for(const file of ['payroll-money','payroll-write-result','payroll-ledger','payroll-range','payroll-export','daily-pos-report','payroll-tax-company','payroll'])load('lib/'+file+'.ts');
 return dependencies;
}
