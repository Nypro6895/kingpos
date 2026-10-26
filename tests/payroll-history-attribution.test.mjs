import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';
import {createRequire} from 'node:module';import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';
const result=await build({entryPoints:['lib/payroll-live-history-presentation.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {payrollHistoryStaffLabel}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
test('active Staff label is unchanged; removed Staff retains original name and identifier',()=>{
 const row={staff_id:'original',staff_snapshot:{id:'original',displayName:'Original Name'}};
 assert.equal(payrollHistoryStaffLabel(row,{original:'Current Name'}),'Current Name');
 assert.equal(payrollHistoryStaffLabel({...row,staff_id:null},{}),'Original Name (original)');
 assert.equal(payrollHistoryStaffLabel({staff_id:null,staff_snapshot:{id:'original',displayName:null}},{}),'original');
 assert.equal(payrollHistoryStaffLabel({staff_id:null},{}),'');
});
test('actual history UI renders removed Staff attribution and notes while preserving active labels',async()=>{
 const compiled=await build({entryPoints:['app/payroll/payroll-change-history.tsx'],bundle:true,platform:'node',format:'cjs',write:false,packages:'external',external:['react','react/jsx-runtime'],alias:{'@':process.cwd()},plugins:[{name:'view-isolation',setup(b){
  b.onResolve({filter:/^(next\/link|@\/components\/workspace-language)$|\.module\.css$/},args=>({path:args.path,namespace:'view'}));
  b.onLoad({filter:/.*/,namespace:'view'},args=>({contents:args.path==='next/link'?"import React from 'react';export default ({children,...props})=>React.createElement('a',props,children)":args.path.endsWith('.css')?'export default {}':'export const WorkspaceText=({text})=>text;',loader:'js'}));
 }}]});
 const module={exports:{}};new Function('require','module','exports',compiled.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
 const change={id:'change',staff_id:null,staff_snapshot:{id:'original-uuid',displayName:'Original Name'},source_table:'payroll_period_staff_inputs',period_start:'2026-01-01',period_end:'2026-01-15',created_at:'2026-01-16T12:00:00Z',actor_id:'owner',before_values:{note:'Before note',bonus_amount:10},after_values:{note:'After note',bonus_amount:25}};
 const deleted=renderToStaticMarkup(React.createElement(module.exports.PayrollChangeHistory,{changes:[change]}));
 assert.match(deleted,/Original Name \(original-uuid\)/);assert.match(deleted,/Before note/);assert.match(deleted,/After note/);assert.match(deleted,/\$10\.00/);assert.match(deleted,/\$25\.00/);
 const active=renderToStaticMarkup(React.createElement(module.exports.PayrollChangeHistory,{changes:[{...change,staff_id:'original-uuid'}],staffNames:{'original-uuid':'Active Name'}}));assert.match(active,/Active Name/);assert.doesNotMatch(active,/Original Name/);
});
