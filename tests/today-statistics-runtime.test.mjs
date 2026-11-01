import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { buildSync } from "esbuild";
import { readFileSync } from "node:fs";
import ts from "typescript";

const output = buildSync({ entryPoints:["lib/today-statistics.ts"], bundle:true, platform:"node", format:"cjs", write:false }).outputFiles[0].text;
const sandbox = { module:{exports:{}}, exports:{}, Intl, Date, console }; sandbox.exports=sandbox.module.exports;
vm.runInNewContext(output,sandbox);
const {buildDayStatistics, localHour, smoothLine, mergeDayStatistics}=sandbox.module.exports;
const base={date:"2026-11-01",timeZone:"America/Chicago",now:"2026-11-01T21:40:00.000Z"};
const ticket=(overrides={})=>({id:"one",status:"closed",closed_at:"2026-11-01T17:30:00.000Z",discount_type:"fixed_amount",discount_value:5,tax_rate:10,tip_type:"fixed_amount",tip_value:20,payments:[{payment_method:"gift_card",amount:30}],ticket_items:[{quantity:2,line_total:999,service_name_snapshot:"Gel",turn_parts:[{amount:30.10},{amount:19.90}]},{quantity:1,line_total:900,is_removed:true}],...overrides});

test("service mix uses split work amounts, quantities and active lines; tips/tax/gift payments never inflate sales",()=>{
 const result=buildDayStatistics({...base,visits:[],tickets:[ticket()]});
 assert.equal(result.closedTickets,1);assert.equal(result.services[0].count,2);assert.equal(result.services[0].sales,50);
 assert.equal(result.hours.reduce((s,h)=>s+(h.sales??0),0),50);
 assert.equal(result.giftCardsRedeemed.amount,30);assert.equal(result.giftCardsRedeemed.count,1);
 assert.equal(result.promotions.amount,5);assert.equal(result.giftCardsSold,null);
});
test("closed time controls sales hour and date, excluding open/voided, duplicates, future and other-day tickets",()=>{
 const result=buildDayStatistics({...base,visits:[],tickets:[ticket(),ticket(),ticket({id:"open",status:"open"}),ticket({id:"void",status:"voided"}),ticket({id:"future",closed_at:"2026-11-01T22:00:00Z"}),ticket({id:"yesterday",closed_at:"2026-11-01T04:59:00Z"})]});
 assert.equal(result.closedTickets,1);assert.equal(result.hours[11].sales,50);assert.equal(result.hours.length,16);
});
test("check-ins count visits once, include completed historical visits, exclude cancelled and wrong local date",()=>{
 const visits=[{id:"a",checked_in_at:"2026-11-01T16:00:00Z",status:"completed"},{id:"a",checked_in_at:"2026-11-01T16:00:00Z",status:"completed"},{id:"b",checked_in_at:"2026-11-01T17:00:00Z",status:"waiting"},{id:"c",checked_in_at:"2026-11-01T18:00:00Z",status:"cancelled"},{id:"old",checked_in_at:"2026-11-01T04:59:00Z",status:"completed"}];
 const result=buildDayStatistics({...base,visits,tickets:[]});assert.equal(result.checkIns,2);assert.equal(result.hours[10].checkIns,1);assert.equal(result.hours[11].checkIns,1);
});
test("missing or forbidden reads remain unavailable; successful empty reads are genuine zeros",()=>{
 const missing=buildDayStatistics({...base,visits:null,tickets:null});assert.equal(missing.checkIns,null);assert.equal(missing.closedTickets,null);assert.equal(missing.services,null);assert.equal(missing.hours[0].sales,null);
 const empty=buildDayStatistics({...base,visits:[],tickets:[]});assert.equal(empty.checkIns,0);assert.equal(empty.closedTickets,0);assert.equal(empty.services.length,0);
});
test("salon day and repeated DST hour use salon timezone, never browser timezone",()=>{
 assert.equal(localHour("2026-11-01T04:59:00Z","America/Chicago").date,"2026-10-31");
 assert.equal(localHour("2026-11-01T06:30:00Z","America/Chicago").hour,1);
 assert.equal(localHour("2026-11-01T07:30:00Z","America/Chicago").hour,1);
 const result=buildDayStatistics({...base,visits:[{id:"first",checked_in_at:"2026-11-01T06:30:00Z",status:"completed"},{id:"second",checked_in_at:"2026-11-01T07:30:00Z",status:"completed"}],tickets:[]});assert.equal(result.hours[1].checkIns,2);
});
test("historical day includes all 24 buckets and service categories prefer immutable snapshots",()=>{
 const result=buildDayStatistics({...base,now:"2026-11-02T22:00:00Z",visits:[],tickets:[ticket({ticket_items:[{quantity:1,line_total:10,service_category_snapshot:"Old category",service:{name:"Renamed",category:"New category"}}]})]});assert.equal(result.hours.length,24);assert.equal(result.services[0].label,"Old category");
});
test("single-point and empty line charts are defined without invented continuation",()=>{
 assert.equal(smoothLine([]),"");assert.equal(smoothLine([{x:4,y:8}]),"M4,8");assert(!smoothLine([{x:0,y:100},{x:30,y:0},{x:60,y:100}]).includes("NaN"));
});

function loadServer(permissions, { failVisits = false, rowCount = 1, failGifts = false } = {}) {
 const queries=[];
 const supabase={async rpc(name,args){queries.push({table:"rpc",name,args,calls:[]});return {data:{counterSales:2500,counterSalesCount:1,redeemed:1000,redeemedCount:2},error:failGifts?{message:"unavailable"}:null}},from(table){const calls=[];const query=new Proxy({}, {get(_,key){
  if(key==='then')return resolve=>{queries.push({table,calls});const range=calls.find(c=>c[0]==='range');const offset=range?.[1]??0;
   const data=Array.from({length:Math.max(0,Math.min(500,rowCount-offset))},(_,i)=>table==='customer_visits'?{id:`v${offset+i}`,checked_in_at:'2026-10-31T16:00:00Z',status:'completed'}:ticket({id:`t${offset+i}`,closed_at:'2026-10-31T17:00:00Z'}));
   return resolve({data,error:table==='customer_visits'&&failVisits?{message:'unavailable'}:null});};
  return (...args)=>{calls.push([key,...args]);return query;};
 }});return query;}};
 const require=id=>id==='server-only'?{}:id==='./permissions'?{hasPermission:async p=>permissions.includes(p)}:id==='./supabase/server'?{createAuthenticatedSupabaseServerClient:async()=>supabase}:id==='./bookings'?{zonedDateTimeToUtcIso:({date})=>`${date}T05:00:00Z`}:id==='./today-statistics'?{buildDayStatistics}:(()=>{throw Error(id)})();
 const source=ts.transpileModule(readFileSync('lib/today-statistics-server.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}};vm.runInNewContext(source,{module,exports:module.exports,require,Date,Promise,Error});return{load:module.exports.loadTodayStatistics,queries};
}
const context={currentSalon:{id:'salon-a'},user:{id:'user-a'}};
test("statistics reads are salon-scoped, permission-gated and fully paginated beyond 500 rows",async()=>{
 const server=loadServer(['booking.view','tickets.view'],{rowCount:501});const result=await server.load(context,'2026-10-31','America/Chicago');assert.equal(result.checkIns,501);assert.equal(result.closedTickets,501);assert.equal(server.queries.length,4);
 for(const q of server.queries){assert(q.calls.some(c=>c[0]==='eq'&&c[1]==='salon_id'&&c[2]==='salon-a'));assert(q.calls.some(c=>c[0]==='lt'));assert(q.calls.some(c=>c[0]==='lte'));assert(!q.calls.some(c=>['insert','update','delete','upsert'].includes(c[0])));}
 const denied=loadServer([]);const hidden=await denied.load(context,'2026-10-31','America/Chicago');assert.equal(denied.queries.length,0);assert.equal(hidden.checkIns,null);assert.equal(hidden.closedTickets,null);
});
test("one failed data source stays unavailable without erasing the other successful series",async()=>{
 const server=loadServer(['booking.view','tickets.view'],{failVisits:true});const result=await server.load(context,'2026-10-31','America/Chicago');assert.equal(result.checkIns,null);assert.equal(result.closedTickets,1);assert.equal(result.errors.length,1);
});

test("independent progressive replies preserve the other series regardless of arrival order",()=>{
 const operations=buildDayStatistics({...base,visits:[{id:'v',checked_in_at:'2026-11-01T17:00:00Z',status:'completed'}],tickets:null});
 const financials=buildDayStatistics({...base,visits:null,tickets:[ticket()]});
 const a=mergeDayStatistics(operations,financials,'tickets'),b=mergeDayStatistics(financials,operations,'visits');
 assert.equal(a.checkIns,1);assert.equal(a.closedTickets,1);assert.equal(a.hours[11].sales,50);assert.equal(a.hours[11].checkIns,1);assert.equal(b.checkIns,1);assert.equal(b.closedTickets,1);assert.equal(b.hours[11].sales,50);
 const updated=mergeDayStatistics(a,buildDayStatistics({...base,visits:[],tickets:null}),'visits');assert.equal(updated.checkIns,0);assert.equal(updated.closedTickets,1);assert.equal(updated.services[0].sales,50);
});
test("progressive statistics failures stay source-specific and clear on recovery",()=>{
 const ops=buildDayStatistics({...base,visits:null,tickets:null,errors:['Check-ins could not be loaded.']});
 const finance=buildDayStatistics({...base,visits:null,tickets:[ticket()]});const missing=mergeDayStatistics(ops,finance,'tickets');assert.equal(missing.checkIns,null);assert.equal(missing.closedTickets,1);assert.equal(missing.errors.length,1);
 const recovered=mergeDayStatistics(missing,buildDayStatistics({...base,visits:[],tickets:null}),'visits');assert.equal(recovered.errors.length,0);assert.equal(recovered.checkIns,0);assert.equal(recovered.closedTickets,1);
});

test("existing gift cashflow stays separate from services and uses cent units",async()=>{
 const server=loadServer(['reports.view']);const result=await server.load(context,'2026-10-31','America/Chicago');assert.equal(result.giftCardsSold.amount,25);assert.equal(result.giftCardsSold.count,1);assert.equal(result.giftCardsRedeemed.amount,10);assert.equal(result.services[0].sales,50);const rpc=server.queries.find(q=>q.table==='rpc');assert.equal(rpc.name,'gift_card_day_cashflow');assert.equal(rpc.args.p_salon,'salon-a');assert.equal(rpc.args.p_date,'2026-10-31');
 const failed=loadServer(['reports.view'],{failGifts:true});const missing=await failed.load(context,'2026-10-31','America/Chicago');assert.equal(missing.giftCardsSold,null);assert.equal(missing.closedTickets,1);assert(missing.errors.includes('Gift card statistics could not be loaded.'));
});
