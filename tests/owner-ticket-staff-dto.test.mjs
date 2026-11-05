import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function fixture({ rosterPermission=true, ticketPermission=true }={}) {
  const calls=[];
  const context={user:{id:'owner'},currentSalon:{id:'salon'},currentAccount:{id:'account'},currentBusiness:{id:'business'}};
  const stubs={
    'next/headers':{headers:async()=>new Map()},
    '@/lib/request-business-context':{getRequestBusinessContext:async()=>context},
    '@/lib/experience-context':{getExperienceContext:()=>({scope:'scope'})},
    '@/lib/current-context':{isSalonManageContext:()=>true},
    '@/lib/permissions':{hasPermission:async permission=>permission==='staff.view'?rosterPermission:permission==='tickets.view'?ticketPermission:true},
    '@/lib/staff':{STAFF_PERMISSIONS:{view:'staff.view'},getCurrentSalonStaff:async()=>{calls.push('roster');return {staff:[{id:'kim',display_name:'Kim'},{id:'other',display_name:'Other'}]};}},
    '@/lib/bookings':{localDateTimeToUtcIso:date=>date+':00Z'},
    '@/lib/pos-tickets':{POS_TICKET_PERMISSIONS:{view:'tickets.view',manage:'tickets.manage',void:'tickets.void'},getCurrentSalonPosTickets:async()=>({tickets:[]}),getCurrentSalonPosTicketOptions:async()=>({services:[],staff:[{id:'kim',display_name:'Kim'}]})},
    '@/lib/daily-pos-report':{FINANCIAL_CORRECTION_PERMISSIONS:{request:'correction.request'},canApplyFinancialCorrections:async()=>false,isDailyClosingLocked:async()=>false},
    '@/lib/salon-business-clock':{getContextBusinessDate:async()=>'2026-11-01',getContextBusinessTimezone:async()=>'UTC'},
    '@/lib/owner-pos-read-model':{ownerReadEtag:()=> 'etag',ownerStaffIds:()=>undefined},
    '@/lib/owner-local-workspace':{ownerLocalHref:()=>true},
  };
  const exports={};
  const code=ts.transpileModule(fs.readFileSync('lib/app-local-owner-resources-server.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{exports,require:name=>stubs[name]??{},URLSearchParams,Date,Intl,Error,Number,Object});
  return {read:exports.readAppLocalOwnerResource,calls};
}
test('installed ticket DTO keeps date and search and ignores retired staff filter without roster reads',async()=>{
 const f=fixture();const result=await f.read('owner.tickets',{query:'date=2026-11-01&staff=kim&q=Nail-Fill'},{scope:'scope'});
 assert.equal(result.data.props.selectedDate,'2026-11-01');assert.equal(result.data.props.searchQuery,'Nail-Fill');assert.equal(result.data.props.selectedStaffId,undefined);assert.equal(result.data.props.filterStaff,undefined);assert.equal(f.calls.length,0);assert.equal(new URLSearchParams(result.data.props.returnTo.split('?')[1]).has('staff'),false);
});
test('retired staff filter never reads a wider roster and ticket permission remains required',async()=>{
 const f=fixture({rosterPermission:false});await f.read('owner.tickets',{query:'staff=kim'},{scope:'scope'});assert.equal(f.calls.length,0);
 const denied=fixture({ticketPermission:false});assert.equal((await denied.read('owner.tickets',{}, {scope:'scope'})).data.view,'denied');assert.equal(denied.calls.length,0);
});
