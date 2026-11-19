import test from "node:test";
import assert from "node:assert/strict";
import { getTaxLineComponents, getTaxLineCashNet, summarizeTaxLines, totalTaxFigures, taxLineChangedFields } from "../lib/tax-workspace-model.ts";

const keys=["gross","tax","net","check_gross","check_tax","check_net","cash_gross","cash_tax","cash_net"];
function line(amount=0.1) {
  const zero=Object.fromEntries(keys.map(key=>[key,0]));
  const row={...zero,shown:true,gross:amount,net:amount,tax_applied:false,tax_rate:null,payout_method:"check",check_gross:amount,check_net:amount};
  const none={...zero,shown:true,tax_applied:false,tax_rate:null,payout_method:"cash"};
  return {id:"line",staff_id:"staff",run_id:"first",reported_wage:amount,reported_gross:amount,tax:0,actual_check:amount,wage_check_net:amount,cash_reported:0,tip:0,bonus:0,tax_rate:0,breakdown:{version:1,state:"published",components:{check_wage:row,cash_wage:none,tip:{...none,payout_method:"check"},bonus:none},totals:{...zero,gross:amount,net:amount,check_gross:amount,check_net:amount}}};
}
test("summary adds integer cents and preserves exact known zero component values",()=>{
  const a=line(0.1),b=line(0.2),result=summarizeTaxLines([a,b])[0];
  assert.equal(result.reported_gross,0.3);assert.equal(result.breakdown.totals.gross,0.3);
  assert.equal(getTaxLineComponents(result).check_wage.net,0.3);assert.equal(getTaxLineCashNet(result),0);
  assert.equal(result.tip,0);assert.equal(result.bonus,0);assert.equal(totalTaxFigures([],"gross"),0);
  assert.equal(a.breakdown.components.check_wage.net,0.1,"does not mutate published input");
});
test("any masked or unknown contributing period keeps summary headlines and component totals unknown",()=>{
  const a=line(),b=line();
  b.reported_gross=null;b.cash_reported=null;b.breakdown.totals.gross=null;b.breakdown.totals.cash_net=null;
  b.breakdown.components.cash_wage={...Object.fromEntries(keys.map(key=>[key,null])),shown:false,tax_applied:null,tax_rate:null,payout_method:null};
  const result=summarizeTaxLines([a,b])[0];
  assert.equal(result.reported_gross,null);assert.equal(result.cash_reported,null);assert.equal(result.breakdown.totals.gross,null);assert.equal(getTaxLineCashNet(result),null);
  assert.equal(result.breakdown.components.cash_wage.shown,false);assert.equal(result.breakdown.components.cash_wage.gross,null);
  assert.equal(result.breakdown.totals.check_net,0.2,"independent disclosed Check is still complete");
});
test("missing historical component snapshots never become reconstructed detail or complete year breakdowns",()=>{
  const old=line();delete old.breakdown;
  const values=getTaxLineComponents(old);assert.equal(values.check_wage.gross,null);assert.equal(values.cash_wage.net,null);assert.equal(getTaxLineCashNet(old),null);
  const result=summarizeTaxLines([line(),old])[0];assert.equal(result.reported_gross,0.2);assert.equal(result.breakdown.state,"historical_unavailable");assert.equal(result.breakdown.totals.check_net,null);
});
test("mixed rates and payout channels retain summed actual values without claiming a single rate",()=>{
  const a=line(),b=line();b.breakdown.components.tip.payout_method="cash";b.breakdown.components.tip.tax_rate=5;b.breakdown.components.tip.tax_applied=true;
  const result=summarizeTaxLines([a,b])[0];assert.equal(result.breakdown.components.tip.payout_method,"mixed");assert.equal(result.breakdown.components.tip.tax_rate,null);assert.equal(result.breakdown.components.tip.tax_applied,null);
});
test("breakdown-only revision changes are recognized with no repeated data scans",()=>{
  const a=line(),b=line();assert.deepEqual(taxLineChangedFields(a,b),[]);b.breakdown.components.tip.shown=false;assert.deepEqual(taxLineChangedFields(a,b),["breakdown"]);
});
