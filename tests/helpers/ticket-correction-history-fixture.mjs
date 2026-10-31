import fs from 'node:fs';
import ts from 'typescript';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';

export const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
export const replacements={
 '@/components/workspace-language':'export const WorkspaceText=({text})=>text;export const WorkspaceElement=({as:Tag="div",children,...props})=><Tag {...props}>{children}</Tag>;',
 '@/app/pos-tickets/actions':'export const correctClosedPosTicketInline=async()=>{};export const submitLockedStaffFinancialCorrection=async()=>{};',
 'next/navigation':'export const useSearchParams=()=>new URLSearchParams(typeof location!=="undefined"?location.search:"");',
};
export const fixturePlugin={name:'isolated-ticket-transport',setup(b){
 if(b.initialOptions.platform==='node')b.onLoad({filter:/\.module\.css$/},()=>({loader:'js',contents:'export default new Proxy({},{get:(_,key)=>String(key)});'}));
 b.onResolve({filter:/.*/},a=>Object.hasOwn(replacements,a.path)?{path:a.path,namespace:'fixture'}:undefined);
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'tsx',contents:replacements[a.path],resolveDir:process.cwd()}));
}};
export async function sourceHelper(){
 const result=await build({stdin:{contents:"export * from './lib/pos-ticket-adjustment-history';",loader:'ts',resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'cjs'});
 const module={exports:{}};new Function('module','exports',result.outputFiles[0].text)(module,module.exports);return module.exports;
}
function actualFunctions(file,names,deps={}){
 const source=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
 const functions=names.map(name=>{
  const declaration=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);assert.ok(declaration,'actual source function '+name);
  return 'export '+declaration.getText(ast);
 }).join('\n');
 const javascript=ts.transpileModule(functions,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,exports={};
 new Function('exports',...Object.keys(deps),javascript)(exports,...Object.values(deps));return exports;
}
export async function portableFunctions(){
 const helper=await sourceHelper();
 const normalize=actualFunctions('app/pos/portable/actions.ts',['normalizePortableString','normalizePortableNullableString','readPortableResultPayload','normalizePortableTicketAdjustment'],helper);
 const mapper=actualFunctions('app/pos/portable/ticket/portable-ticket-client.tsx',['itemLineTotal','normalizeServiceLookupName','resolvePortableTicketServiceId','toEditableTicket']);
 return {...helper,...normalize,...mapper};
}
export function ownerTicket(){
 return {id:id(1),workspace_revision:7,opened_at:'2026-10-20T16:00:00Z',status:'closed',source_booking_id:null,customer:null,discount_type:'fixed_amount',discount_value:0,tip_type:'fixed_amount',tip_value:10,tax_rate:0,
  staff_earnings:[{staff_id:id(10),tip_amount:10,tip_is_manual:false,manual_tip_amount:null}],
  ticket_items:[{id:id(20),assigned_staff_id:id(10),assigned_staff:{id:id(10),display_name:'Anna'},service_id:id(30),service:{id:id(30),name:'Manicure'},created_at:'2026-10-20T16:00:00Z',line_total:60,turn_parts:[{id:id(40),amount:60,turn_index:1,turn_type:'large'}]}]};
}
export function adjustments(){
 const before=ownerTicket(),after=ownerTicket();before.ticket_items[0].line_total=50;before.ticket_items[0].turn_parts[0].amount=50;
 return [
  ['draft','Draft construction should be hidden'],['created','Initial submission should be hidden'],['updated','After-submit price correction'],[undefined,'Legacy correction retained'],
 ].map(([event_action,reason],i)=>({id:id(100+i),ticket_id:id(1),action:'item_corrected',event_action,before_snapshot:i===3?{}:{ticket:before},after_snapshot:i===3?{}:{ticket:after},created_at:'2026-10-29T16:05:00Z',created_by:id(90),created_by_user:{id:id(90),display_name:'Salon Owner',email:null},reason}));
}
export async function portableTicket(rows=adjustments()){
 const {normalizePortableTicketAdjustment,toEditableTicket}=await portableFunctions();
 const own=ownerTicket();
 const normalized=rows.map(normalizePortableTicketAdjustment).filter(Boolean);
 return toEditableTicket({id:own.id,workspaceRevision:7,openedAt:own.opened_at,status:own.status,sourceBookingId:null,customerName:null,
  discountType:own.discount_type,discountValue:0,tipType:own.tip_type,tipValue:10,taxRate:0,adjustments:normalized,
  staffEarnings:[{staffId:id(10),tipAmount:10,tipIsManual:false,manualTipAmount:null}],
  items:[{id:id(20),staffId:id(10),staffName:'Anna',serviceId:id(30),serviceName:'Manicure',createdAt:own.opened_at,lineTotal:60,runningTurnBig:1,runningTurnSmall:0,
   turnParts:[{id:id(40),amount:60,turnIndex:1,turnType:'large',ticketId:own.id,ticketItemId:id(20),staffId:id(10),workDate:'2026-10-20'}]}],
 },[{id:id(30),name:'Manicure'}]);
}
export const props={businessDateCompactLabel:'Oct 20',canApplyFinancialCorrection:false,canEdit:true,dailyNumber:24,isBusinessDateLocked:true,returnTo:'/pos-tickets?date=2026-10-20',services:[{id:id(30),name:'Manicure'}],staff:[{id:id(10),display_name:'Anna'}],timeZone:'America/Chicago'};
export async function renderer(){
 const output=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {DailyPosTicketCard} from './app/pos-tickets/closed-ticket-correction-form';export const render=(ticket,props)=>renderToStaticMarkup(<DailyPosTicketCard {...props} ticket={ticket}/>);"},bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',external:['react','react/jsx-runtime','react-dom/server','react-dom'],plugins:[fixturePlugin]});
 const module={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);return module.exports.render;
}
