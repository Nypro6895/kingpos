import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync('lib/payroll.ts','utf8');
const body=source.slice(source.indexOf('export async function uploadPayrollPaystub('),source.indexOf('type StaffInputHistorySnapshot'));
function setup(conflict=false,uploadFail=false){
 const events=[];const previous='account/salon/run/staff/old.pdf';let newPath;
 const client={from(table){const filters={};let op='read';return {select(){return this;},eq(k,v){filters[k]=v;return this;},update(payload){op='update';newPath=payload.file_url_or_path;return this;},insert(){throw Error('unexpected insert');},async maybeSingle(){if(table==='payroll_staff_lines')return {data:{id:'line'}};if(op==='read')return {data:{file_url_or_path:previous}};assert.equal(filters.file_url_or_path,previous);events.push('save');return conflict?{data:null,error:null}:{data:{file_url_or_path:newPath},error:null};}};},storage:{from(){return {async upload(path){newPath=path;events.push('upload');return {error:uploadFail?{message:'upload failed'}:null};},async remove(paths){events.push(`remove:${paths[0]}`);return {error:null};}};}}};
 const exports={};const deps={requirePayrollContext:async()=>({access:{canManagePayroll:true},supabase:client,salon:{id:'salon'},Account:{id:'account'},user:{id:'user'}}),loadPayrollRunById:async()=>({id:'run',status:'printed'}),sanitizeStorageFileName:s=>s,PAYROLL_PAYSTUB_BUCKET:'payroll-paystubs',PAYROLL_PAYSTUB_SELECT:'*',cleanupPaystubFile:async(path,remove)=>{if(path)await remove(path);},createPaystubViewUrl:async()=> 'signed'};
 new Function('exports',...Object.keys(deps),ts.transpileModule(body,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(exports,...Object.values(deps));
 return {upload:()=>exports.uploadPayrollPaystub({file:{name:'new.pdf',type:'application/pdf',size:10},staffId:'staff',payrollRunId:'run'}),events,previous,get newPath(){return newPath;}};
}
test('replacement saves new reference before removing old file',async()=>{const s=setup();await s.upload();assert.deepEqual(s.events,['upload','save',`remove:${s.previous}`]);assert.notEqual(s.newPath,s.previous);});
test('concurrent replacement removes only the losing upload',async()=>{const s=setup(true);await assert.rejects(s.upload,/changed by another/);assert.deepEqual(s.events,['upload','save',`remove:${s.newPath}`]);});
test('failed file upload keeps old reference and file intact',async()=>{const s=setup(false,true);await assert.rejects(s.upload,/upload failed/);assert.deepEqual(s.events,['upload']);});
