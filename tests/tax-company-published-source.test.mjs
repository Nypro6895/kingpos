import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundled=await build({entryPoints:['lib/tax-company.ts'],bundle:true,write:false,platform:'node',format:'cjs',alias:{'@':process.cwd()},plugins:[{name:'authorized-client-fixture',setup(b){
 b.onResolve({filter:/^server-only$/},()=>({path:'empty',namespace:'fixture'}));
 b.onResolve({filter:/supabase\/server$/},()=>({path:'client',namespace:'fixture'}));
 b.onResolve({filter:/current-context$/},()=>({path:'context',namespace:'fixture'}));
 b.onResolve({filter:/market-plugins$/},()=>({path:'market',namespace:'fixture'}));
 b.onResolve({filter:/\/lib\/payroll$/},()=>({path:'report-filter',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path==='client'?'export const createAuthenticatedSupabaseServerClient=async()=>globalThis.taxFixture.client;':path==='context'?'export const getCurrentBusinessContext=async()=>({user:{id:"external-tax-person"}});':path==='market'?'export const marketPluginContext=async()=>{throw Error("External source must not need Owner context")};':path==='report-filter'?'export const isTaxCompanyReportableLine=line=>line.final_check_amount>0;':'',loader:'js'}));
}}]});
const module={exports:{}};new Function('module','exports',bundled.outputFiles[0].text)(module,module.exports);
const {taxCompanyReport}=module.exports;
const salon='connected-salon',run={id:'published-run',salon_id:salon,period_start:'2020-10-01',period_end:'2020-10-31',status:'printed',version:2,cycle_type:'monthly'};
function fixture({inactive=false,runs=[run]}={}){
 const calls=[],tables={payroll_runs:runs,payroll_staff_lines:[{salon_id:salon,payroll_run_id:run.id,staff_id:'anna',final_check_amount:150,final_staff_income:200,staff_display_name_snapshot:'Anna'}],payroll_paystubs:[{salon_id:salon,payroll_run_id:run.id,staff_id:'anna',file_url_or_path:'published-stub.pdf'}]};
 const client={rpc:async(name,args)=>{calls.push(['rpc',name,args]);assert.equal(name,'tax_company_scope');return inactive?{error:{message:'Expired'}}:{data:{salon:{id:salon,name:'Connected salon'},payroll_setting:{cycle_type:'monthly'},note:{content:'Owner-approved statement'}}};},from(table){assert.ok(Object.hasOwn(tables,table),`Private source requested: ${table}`);calls.push(['table',table]);let rows=tables[table];const query={select(){return query;},eq(key,value){rows=rows.filter(row=>row[key]===value);return query;},in(key,values){rows=rows.filter(row=>values.includes(row[key]));return query;},order(){return query;},limit(){return query;},returns(){return Promise.resolve({data:rows});},then(resolve,reject){return Promise.resolve({data:rows}).then(resolve,reject);}};return query;},storage:{from(bucket){assert.equal(bucket,'payroll-paystubs');return{createSignedUrl:async(path,ttl)=>{calls.push(['signed',path,ttl]);return{data:{signedUrl:'https://fixture.invalid/'+path}};}};}}};
 globalThis.taxFixture={client};return calls;
}

test('external Tax Company reads only its authorized published statement and attached paystub, preserving saved values',async()=>{
 const calls=fixture({runs:[run,{...run,id:'private-draft',status:'draft',version:3}]});const data=await taxCompanyReport(salon,run.id);
 assert.equal(data.run.id,run.id);assert.equal(data.lines.length,1);assert.equal(data.lines[0].final_staff_income,200);assert.equal(data.lines[0].paystub.view_url,'https://fixture.invalid/published-stub.pdf');
 assert.deepEqual(calls.filter(c=>c[0]==='table').map(c=>c[1]),['payroll_runs','payroll_staff_lines','payroll_paystubs']);assert.deepEqual(calls.filter(c=>c[0]==='rpc').map(c=>c[1]),['tax_company_scope']);
});
test('no published statement stays empty rather than recalculating private live staff inputs',async()=>{
 const calls=fixture({runs:[]});const data=await taxCompanyReport(salon);assert.equal(data.run,null);assert.deepEqual(data.lines,[]);assert.deepEqual(calls.filter(c=>c[0]==='table').map(c=>c[1]),['payroll_runs']);
});
test('expired connection and unpublished requested run fail without reading private financial inputs',async()=>{
 let calls=fixture({inactive:true});await assert.rejects(taxCompanyReport(salon),/connection is inactive/);assert.equal(calls.some(c=>c[0]==='table'),false);
 calls=fixture({runs:[{...run,id:'private-draft',status:'draft'}]});await assert.rejects(taxCompanyReport(salon,'private-draft'),/statement is unavailable/);assert.deepEqual(calls.filter(c=>c[0]==='table').map(c=>c[1]),['payroll_runs']);
});
