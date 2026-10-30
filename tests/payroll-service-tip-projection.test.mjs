import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import fs from 'node:fs';
import ts from 'typescript';

const bundled=await build({entryPoints:['lib/payroll-live-dashboard.ts'],bundle:true,write:false,platform:'node',format:'cjs'});
const module={exports:{}};new Function('module','exports',bundled.outputFiles[0].text)(module,module.exports);
const {payrollLiveDashboard,hasCompletePayrollReceipts}=module.exports;
const ast=ts.createSourceFile('payroll.ts',fs.readFileSync('lib/payroll.ts','utf8'),ts.ScriptTarget.Latest,true);
const source=ast.statements.find(statement=>ts.isFunctionDeclaration(statement)&&statement.name?.text==='buildShopSummary').getText(ast).replace('function buildShopSummary','export function buildShopSummary');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const summaryExports={};new Function('exports','roundMoney','moneyCents','hasCompletePayrollReceipts',code)(summaryExports,value=>Math.round(value*100)/100,value=>Math.round(Number(value)*100),hasCompletePayrollReceipts);
const {buildShopSummary}=summaryExports;
const row=(service,tip,expectedService=900,expectedTip=100)=>({businessDate:'2026-10-01',actualIncome:service,actualTipIncome:tip,posIncome:expectedService,tips:expectedTip,difference:service===null?null:service-expectedService,tipDifference:tip===null?null:tip-expectedTip});
const line={final_cash_amount:300,final_check_amount:400,tax_withheld:0};

test('service receipt excludes tip, owner remainder includes actual tip once before total staff cost',()=>{
  const result=payrollLiveDashboard([line],[row(900,100)],'2026-10-02');
  assert.equal(result.collected,900);assert.equal(result.tipsCollected,100);assert.equal(result.staffCost,700);assert.equal(result.remaining,300);assert.equal(result.differences.length,0);
});
test('missing tip remains unknown; an explicitly entered zero is a real tip shortage',()=>{
  const missing=payrollLiveDashboard([line],[row(900,null)],'2026-10-02');assert.equal(missing.remaining,null);assert.equal(missing.missingTips.length,1);
  const zero=payrollLiveDashboard([line],[row(900,0)],'2026-10-02');assert.equal(zero.remaining,200);assert.equal(zero.differences.length,1);assert.equal(zero.shortDays,1);
});
test('opposite service and tip differences remain separately reviewable instead of canceling',()=>{
  const result=payrollLiveDashboard([line],[row(920,80)],'2026-10-02');
  assert.equal(result.differences.length,1);assert.equal(result.differences[0].difference,20);assert.equal(result.differences[0].tipDifference,-20);assert.equal(result.shortDays,1);assert.equal(result.overDays,1);
});

test('tip-only entries contribute known tip total while incomplete receipts keep the period remainder unknown',()=>{
 const rows=[{...row(900,100),corrections:[],staffObligation:700},{...row(null,20,200,20),businessDate:'2026-10-02',corrections:[],staffObligation:140}];
 const result=payrollLiveDashboard([line],rows,'2026-10-03');assert.equal(result.collected,900);assert.equal(result.tipsCollected,120);assert.equal(result.remaining,null);assert.equal(result.receiptsComplete,false);
 const summary=buildShopSummary(rows);assert.equal(summary.totalActualIncome,900);assert.equal(summary.totalActualTip,120);assert.equal(summary.shopNetIncome,null);
});
test('whole-period future obligations cannot be subtracted from partial receipts as a confirmed remainder',()=>{
 const rows=[{...row(900,100),corrections:[],staffObligation:700},{...row(null,null,0,0),businessDate:'2026-10-30',corrections:[],staffObligation:100}];
 assert.equal(payrollLiveDashboard([line],rows,'2026-10-29').remaining,null);assert.equal(buildShopSummary(rows).shopNetIncome,null);
 rows[1].staffObligation=0;assert.equal(payrollLiveDashboard([line],rows,'2026-10-29').remaining,300);assert.equal(buildShopSummary(rows).shopNetIncome,300);
});
test('a known tip-only discrepancy remains visible while service input is still missing',()=>{
 const result=payrollLiveDashboard([line],[row(null,80)],'2026-10-02');
 assert.equal(result.collected,null);assert.equal(result.tipsCollected,80);assert.equal(result.differences.length,1);assert.equal(result.differences[0].tipDifference,-20);assert.equal(result.shortDays,1);assert.equal(result.remaining,null);
});
