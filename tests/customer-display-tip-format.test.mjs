import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise the actual formatters without importing checkout/network actions.
const source=fs.readFileSync('app/pos/customer-display/customer-display-client.tsx','utf8');
const ast=ts.createSourceFile('display.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function load(name){
  const declaration=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
  assert.ok(declaration,`Missing ${name}`);
  const js=ts.transpileModule(declaration.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  return vm.runInNewContext(js+';'+name,{Intl});
}
const tip=load('formatTipMoney'),receipt=load('formatMoney');
test('tip amounts omit zero cents and retain nonzero cents',()=>{
  for(const [amount,display] of [[0,'$0'],[5,'$5'],[50,'$50'],[6.75,'$6.75'],[8.1,'$8.1'],[1000,'$1,000']])assert.equal(tip(amount),display);
});
test('receipt accounting values keep their existing cents precision',()=>{
  assert.equal(receipt(45),'$45.00');
  assert.equal(receipt(6.75),'$6.75');
});
