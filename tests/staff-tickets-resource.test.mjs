import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
function load(path,mocks){const exports={};new Function('require','exports',ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(name=>{assert.ok(name in mocks,name);return mocks[name]},exports);return exports;}
const helpers=load('lib/staff-tickets.ts',{});
const experience=load('lib/staff-my-work-experience.ts',{});

test('ticket dates validate actual calendar dates without throwing',()=>{
 for(const date of ['2026-02-30','2025-02-29','2026-99-99','0000-01-01','Infinity','','2026-1-1',undefined])assert.equal(helpers.validStaffTicketDate(date),false,String(date));
 for(const date of ['2024-02-29','0001-01-01','9999-12-31','2020-01-01'])assert.equal(helpers.validStaffTicketDate(date),true,date);
 assert.equal(experience.staffMyWorkActiveTab('tickets'),'tickets');
});

test('ticket API preserves auth/scope/staff guards and passes date through',async()=>{
 let identity={context:{user:{id:'u'},currentSalon:{id:'salon'},currentAccount:{id:'account'}},staff:{id:'staff'}};
 let calls=[];
 const {GET}=load('app/api/experience/my-work/route.ts',{
  '@/lib/staff-offline-binding-server':{getTrustedStaffOfflineBinding:async()=>true},'@/lib/supabase/auth-rejection':{AuthRejectionError:class AuthRejectionError extends Error{}},'@/lib/staff-tickets':helpers,'@/lib/experience-context':{getExperienceContext:()=>({scope:'scope'})},
  '@/lib/experience-live-resource-server':{createLiveResourceSnapshot:d=>d,liveResourceResponse:(_,d)=>Response.json(d)},
  '@/lib/staff-portal-identity':{getStaffPortalIdentity:async()=>identity},
  '@/lib/staff-my-work-resource-server':{loadStaffMyWorkResource:async(i,p)=>{calls.push(p);return{ticketsData:{date:p.ticketDate}}}},
  'next/server':{connection:async()=>{}},'next/headers':{headers:async()=>new Headers()},
 });
 const request=(extra='')=>GET(new Request('https://fixture.test/api/experience/my-work?tab=tickets&scope=scope&staffId=staff'+extra));
 let response=await request('&ticketDate=2020-02-29');assert.equal(response.status,200);assert.deepEqual(calls[0],{tab:'tickets',payPeriodStart:undefined,ticketDate:'2020-02-29'});
 assert.equal((await request('&ticketDate=2026-02-30')).status,400);assert.equal((await request('&ticketDate=2026-99-99')).status,400);assert.equal(calls.length,1);
 assert.equal((await GET(new Request('https://fixture.test/api/experience/my-work?tab=tickets&scope=other&staffId=staff'))).status,409);
 assert.equal((await GET(new Request('https://fixture.test/api/experience/my-work?tab=tickets&scope=scope&staffId=coworker'))).status,409);
 identity={...identity,staff:null};assert.equal((await request()).status,403);
 identity={context:{user:null}};assert.equal((await request()).status,401);assert.equal(calls.length,1);
});

test('ticket resource verifies RPC identity and fails closed without hiding query errors',async()=>{
 let result={data:{date:'2020-02-29',staffId:'staff',tickets:[]},error:null};const calls=[];
 const context={user:{id:'u'},currentSalon:{id:'salon'}};
 const identity={context,staff:{id:'staff'},supabase:{rpc:async(name,args)=>{calls.push({name,args});return name==='get_my_staff_tickets'?result:name==='get_salon_business_timezone'?{data:'America/Chicago',error:null}:{data:null,error:null}}}};
 const {loadStaffMyWorkResource:loader}=load('lib/staff-my-work-resource-server.ts',{
  'server-only':{},'./staff-tickets':helpers,'./staff-my-work-experience':experience,
  '@/lib/experience-context':{getExperienceContext:()=>({scope:'scope'})},
  '@/lib/payroll':{},'@/lib/staff-portal-identity':{canReuseStaffPortalReadIdentity:()=>false},'./salon-business-clock':{getSalonBusinessTimezone:async()=> 'America/Chicago'},
  '@/lib/staff-profile':{getStaffProfileAvatarUrl:()=>null,getStaffProfileDisplayName:()=> 'Staff'},
  '@/lib/staff-workdays':{getCurrentStaffAssignedWork:async()=>({today:'2026-10-30',workTickets:[],excludedTicketCount:0}),getTodaysStaffWorkday:async()=>({workday:null}),STAFF_WORKDAY_STATUS_LABELS:{not_checked_in:'Not checked in'}},
 });
 const data=await loader(identity,{tab:'tickets',ticketDate:'2020-02-29'});assert.equal(data.today,'2026-10-30');assert.equal(data.ticketsData.date,'2020-02-29');assert.deepEqual(calls.find(c=>c.name==='get_my_staff_tickets').args,{p_salon_id:'salon',p_work_date:'2020-02-29'});
 result={data:{date:'2020-02-29',staffId:'coworker',tickets:[]},error:null};await assert.rejects(loader(identity,{tab:'tickets',ticketDate:'2020-02-29'}),/identity/);
 result={data:null,error:{message:'migration unavailable'}};await assert.rejects(loader(identity,{tab:'tickets',ticketDate:'2020-02-29'}),/migration unavailable/);
 await assert.rejects(loader(identity,{tab:'tickets',ticketDate:'2020-99-99'}),/Invalid ticket date/);
});
import {createHash} from 'node:crypto';
test('native named read carries ticket date and retains scope/staff/parameter guards',async()=>{
 const resources=load('lib/app-local-role-resources.ts',{}),calls=[];
 const staffId='00000000-0000-4000-8000-000000000001',scope='v3:'+'a'.repeat(64);
 const identity={context:{user:{id:'u'},currentSalon:{id:'salon'},currentAccount:{id:'account'}},staff:{id:staffId}};
 const empty={};let result={ticketsData:{date:'2024-02-29',staffId,tickets:[]}};
 const {readAppLocalRoleResource:read}=load('lib/app-local-role-resources-server.ts',{
  'server-only':{},'node:crypto':{createHash},'./staff-tickets':helpers,
  './request-business-context':empty,'./experience-context':{getExperienceContext:()=>({scope})},'./current-context':empty,
  './supabase/server':empty,'./customer-bookings':empty,'./account-social':empty,'./customer-experience-resource-server':empty,
  './staff-experience-resource-server':empty,'./today-dashboard':empty,'./today-dashboard-sections':empty,'./explore-reference-favorites':empty,
  './staff-portal-identity':{getStaffPortalIdentity:async()=>identity},
  './staff-my-work-resource-server':{loadStaffMyWorkResource:async(_,params)=>{calls.push(params);return result}},
  './bounded-get':{runReadWithDeadline:promise=>promise},
  './read-context-scope':{runWithReadContext:read=>read(),runWithReadAbortSignal:(_,read)=>read()},'./app-local-role-resources':resources,
 });
 const args={staffId,tab:'tickets',ticketDate:'2024-02-29'};
 const reply=await read('staff.my-work',args,{scope});assert.equal(reply.status,200);assert.deepEqual(calls[0],{tab:'tickets',payPeriodStart:undefined,ticketDate:'2024-02-29'});
 await assert.rejects(read('staff.my-work',{...args,ticketDate:'2025-02-29'},{scope}),e=>e.status===400);
 await assert.rejects(read('staff.my-work',{...args,extra:'denied'},{scope}),e=>e.status===400);
 await assert.rejects(read('staff.my-work',args,{scope:'wrong'}),e=>e.status===409);
 await assert.rejects(read('staff.my-work',{...args,staffId:'00000000-0000-4000-8000-000000000002'},{scope}),e=>e.status===409);
 result={ticketsData:null};await assert.rejects(read('staff.my-work',args,{scope}),e=>e.status===503);
});
