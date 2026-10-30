import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

// Execute the real read assemblers with deterministic I/O. A legacy snapshot is
// deliberately different from current facts, as after a past ticket correction.
const ast=ts.createSourceFile('daily-pos-report.ts',fs.readFileSync('lib/daily-pos-report.ts','utf8'),ts.ScriptTarget.Latest,true);
const functions=['getDailyPosReport','getDailyClosingEffectiveTotals'].map(name=>ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name).getText(ast)).join('\n');
const javascript=ts.transpileModule(functions,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const snapshot={expectedTotal:999,ticketCount:9,finalizedTicketCount:8};
const core={closing:{id:'closing'},closingInputs:{cashAmount:90,tipInput:20},metadata:{ticketCount:2,finalizedTicketCount:1},staffRows:[{staffId:'staff',totalEarned:100,tipAmount:20}],totals:{expectedTotal:90,totalTip:20,serviceDifference:0,tipDifference:0}};
let locked=true;
const exports={};
const dependencies={
 requireReportContext:async()=>({context:{},salon:{id:'salon'}}),
 DAILY_POS_REPORT_PERMISSIONS:{view:'reports.view'},isDateInputValue:()=>true,
 loadLiveDailyPosReport:async()=>core,loadDailyClosingCorrectionRows:async()=>({requests:[],adjustments:[]}),
 getCurrentBusinessDate:async()=>'2026-10-29',getSnapshotTotalsFromClosing:()=>snapshot,
 getLockInfo:async()=>({isLocked:locked,isPastDate:true,status:'auto_locked'}),snapshotDiffersFromLive:()=>true,
 decorateDailyClosingCorrections:async()=>({requests:[],adjustments:[]}),
 buildEffectiveTotalsResult:input=>{assert.equal(input.lock.isLocked,false,'a historical snapshot must not select current monetary totals');return {adjustmentTotals:{},closingInputs:input.core.closingInputs,lock:input.lock,pendingCorrectionCount:0,snapshotTotals:snapshot,totals:input.core.totals};},
};
new Function('exports',...Object.keys(dependencies),javascript)(exports,...Object.values(dependencies));

test('readonly past Reports uses current effective Staff inputs and ticket counts, retaining old snapshots only as evidence',async()=>{
 locked=true;const result=await exports.getDailyPosReport('2026-10-28');
 assert.deepEqual(result.totals,core.totals);assert.deepEqual(result.staffRows,core.staffRows);assert.deepEqual(result.metadata,core.metadata);
 assert.equal(result.lock.isLocked,true);assert.equal(result.snapshotTotals,snapshot);
});
test('Owner can read/edit past live inputs while readonly helper callers retain their access lock',async()=>{
 locked=false;const owner=await exports.getDailyPosReport('2026-10-28');assert.equal(owner.lock.isLocked,false);assert.equal(owner.totals.expectedTotal,90);
 locked=true;const reader=await exports.getDailyClosingEffectiveTotals('2026-10-28');assert.equal(reader.lock.isLocked,true);assert.equal(reader.totals.totalTip,20);assert.equal(reader.snapshotTotals,snapshot);
});
