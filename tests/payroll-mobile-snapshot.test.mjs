import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {build} from 'esbuild';
const root=path.resolve('artifacts/payroll-mobile-release-dpl_FjvyKRikrntAAhdQDvk1Mc9GSAtv');
const names={
 '@/lib/salon-business-clock':['getSalonBusinessTimezone'], '@/lib/current-context':['getCurrentBusinessContext','isSalonManageContext'],
 '@/lib/daily-pos-report':['getUtcBoundsForLocalDate','isDateInputValue'], '@/lib/permissions':['hasPermission'],
 '@/lib/staff':['STAFF_SELECT'], '@/lib/staff-payroll-period':['staffPeriodHistory','staffComparisonPeriods','staffPayPeriodChoices','staffPeriodKey'],
 '@/lib/paystub-files':['cleanupPaystubFile'], '@/lib/staff-portal-identity':['getStaffPortalIdentity'], '@/lib/staff-profile':['getStaffPresentationsByStaffId'],
 '@/lib/staff-account':['CURRENT_STAFF_MULTIPLE_MATCHES_MESSAGE','resolveStaffAccountForSalon'], '@/lib/supabase/server':['createAuthenticatedSupabaseServerClient']
};
const result=await build({stdin:{resolveDir:root,contents:`export {buildTaxCompanyLinesForAuth} from './lib/payroll';`,loader:'ts'},bundle:true,write:false,platform:'node',format:'esm',alias:{'@':root},plugins:[{name:'offline-server',setup(b){
 b.onResolve({filter:/.*/},a=>names[a.path]||a.path==='server-only'?{path:a.path,namespace:'offline'}:undefined);
 b.onLoad({filter:/.*/,namespace:'offline'},a=>({contents:(names[a.path]??[]).map(n=>`export const ${n}=()=>{throw Error('Unexpected live data access: ${n}')};`).join('\n')}));
 b.onLoad({filter:/[\\/]lib[\\/]payroll\.ts$/},a=>({loader:'ts',resolveDir:path.dirname(a.path),contents:fs.readFileSync(a.path,'utf8').replace('async function buildTaxCompanyLinesForAuth','export async function buildTaxCompanyLinesForAuth')}));
}}]});
const {buildTaxCompanyLinesForAuth}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const period={startDate:'2026-10-01',endDate:'2026-10-15',cycleType:'semi_monthly'};
const line={staff_id:'staff-1',gross_sales:1000,staff_commission_gross:600,final_check_amount:500,final_cash_amount:0,final_staff_income:500,tax_withheld:100,tax_rate_used:10,tax_company_taxable_gross:600,dailyTotals:[],paystub:{payroll_run_id:'saved-v2',file_name:'v2.pdf'}};
test('tax report binds saved values and paystub to the same version despite unsaved live changes',async()=>{
 const saved={run:{id:'saved-v2',version:2},lines:[line]};
 const live={lines:[{...line,final_check_amount:9999,tax_company_taxable_gross:12000,paystub:{file_name:'wrong.pdf'}}]};
 const data=await buildTaxCompanyLinesForAuth({auth:{},period,latestStatement:saved,live});
 assert.equal(data.source,'statement');assert.equal(data.latestStatement.run.id,'saved-v2');assert.equal(data.lines[0].final_check_amount,500);assert.equal(data.lines[0].paystub.file_name,'v2.pdf');assert.equal(data.summary.totalTaxCompanyTaxableGross,600);
});
test('period with live earnings but no saved version shares no report or paystub',async()=>{
 const data=await buildTaxCompanyLinesForAuth({auth:{},period,latestStatement:null,live:{lines:[line]}});
 assert.equal(data.source,'awaiting_statement');assert.deepEqual(data.lines,[]);assert.equal(data.summary.totalTaxCompanyTaxableGross,0);
});
