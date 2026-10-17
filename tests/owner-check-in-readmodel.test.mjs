import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import {execFileSync} from 'node:child_process';

const staffA='11111111-1111-4111-8111-111111111111',staffB='22222222-2222-4222-8222-222222222222',missing='33333333-3333-4333-8333-333333333333';
function state(){return {scope:'scope-owner-a',authenticated:true,manage:true,permission:true,unavailable:false,legacy:false,reads:[],contexts:0,context:{user:{id:'viewer-a'},currentBusiness:{id:'business-a'},currentAccount:{id:'account-a',name:'Account'},currentSalon:{id:'salon-a',name:'Salon A'}},staff:[{id:staffA,salon_id:'salon-a',display_name:'Anna',job_title:'Artist',is_active:true,pos_enabled:true,passcode_is_default:false},{id:staffB,salon_id:'salon-a',display_name:'Binh',job_title:'Artist',is_active:true,pos_enabled:true,passcode_is_default:true}],days:[{staff_id:staffA,salon_id:'salon-a',work_date:'2026-10-16',status:'working',check_in_at:'2026-10-16T14:00:00Z',check_in_sequence:1,queue_turn_count:2},{staff_id:staffB,salon_id:'salon-a',work_date:'2026-10-16',status:'not_checked_in',check_in_at:null,check_in_sequence:null,queue_turn_count:0}]};}
async function moduleFrom(file,s,before=false){
 globalThis.__ownerReadFixture=s;
 const result=await build({...(before?{stdin:{contents:execFileSync('git',['show','1ade935:'+file],{encoding:'utf8'}),resolveDir:process.cwd(),loader:'ts'}}:{entryPoints:[file]}),bundle:true,write:false,format:'esm',platform:'node',alias:{'@':process.cwd()},plugins:[{name:'authorized-read-fixture',setup(b){
  b.onResolve({filter:/^(?:server-only|next\/headers|next\/server)$/},a=>({path:a.path,namespace:'fixture'}));
  b.onResolve({filter:/^@\/lib\//},a=>a.path==='@/lib/owner-pos-read-model'||a.path==='@/lib/owner-local-workspace'?undefined:{path:a.path,namespace:'fixture'});
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path==='server-only'?'':`
   const s=globalThis.__ownerReadFixture;
   export const headers=async()=>new Headers(s.unavailable?{'x-reylumi-auth-unavailable':'1'}:{});
   export const connection=async()=>{};
   export const getRequestBusinessContext=async()=>{s.contexts++;return{...s.context,user:s.authenticated?s.context.user:null}};
   export const isSalonManageContext=()=>s.manage;
   export const getExperienceContext=()=>({scope:s.scope});
   export const requireSalonManagePageContext=async()=>{if(!s.authenticated||!s.manage)throw Error('Denied');return s.context};
   export const requirePermission=async()=>{if(!s.permission)throw Error('No permission')};
   export const hasPermission=async()=>s.permission;
   export const POS_TICKET_PERMISSIONS={view:'tickets.view',manage:'tickets.manage',void:'tickets.void'};
   export const BOOKING_PERMISSIONS={view:'booking.view'};
   export const DAILY_POS_REPORT_PERMISSIONS={view:'reports.view',requestCorrection:'reports.correct'};
   export const FINANCIAL_CORRECTION_PERMISSIONS={request:'tickets.correct'};
   export const getCurrentSalonPosSettings=async()=>({staffCheckInEnabled:true});
   export const getContextBusinessDate=async()=> '2026-10-16';export const getContextBusinessTimezone=async()=>{await s.timezoneGate;return 'America/Chicago'};
   export const isMissingSupabaseColumnError=(e,column)=>e?.code==='42703'&&e.message.includes(column);
   class Query{
    constructor(table){this.table=table;this.filters=[];s.reads.push(this)}
    select(value){this.fields=value;return this}eq(k,v){this.filters.push([k,v]);return this}in(k,v){this.filters.push([k,v]);return this}order(){return this}
    maybeSingle(){return Promise.resolve({data:{workspace_preferences:{}},error:s.settingsError})}
    then(resolve,reject){if(s.legacy&&this.table==='staff_workdays'&&this.fields.includes('queue_turn_count'))return Promise.resolve({data:null,error:{code:'42703',message:'queue_turn_count does not exist'}}).then(resolve,reject);
     const rows=this.table==='staff'?s.staff:s.days;return Promise.resolve({data:rows.filter(row=>this.filters.every(([k,v])=>Array.isArray(v)?v.includes(row[k]):row[k]===v)).map(row=>Object.fromEntries(this.fields.split(',').map(key=>[key.trim(),row[key.trim()]]))),error:null}).then(resolve,reject)}
   }
   export const createAuthenticatedSupabaseServerClient=async()=>({from:table=>new Query(table)});
   export const getCurrentSalonPosDeskData=async()=>{if(!s.desk)throw Error('Full desk must not load for Check-in');await s.deskGate;return s.desk};
   export const normalizeWorkspacePreferences=value=>value;
   export const getCurrentSalonBookingWorkspace=async()=>{throw Error('Not requested')};
   export const getCurrentSalonPosTickets=async()=>{throw Error('Not requested')};export const getCurrentSalonPosTicketOptions=async()=>{throw Error('Not requested')};
   export const getOperationalReport=async()=>{throw Error('Not requested')};export const getDailyPosReport=async()=>{throw Error('Not requested')};
   export const canApplyFinancialCorrections=async()=>false;export const canEditDailyPosClosing=async()=>false;export const isDailyClosingLocked=async()=>false;
   export const getDefaultReportDate=async()=> '2026-10-16';export const normalizeReportDate=async value=>value;export const isDateInputValue=value=>Boolean(value);export const localDateTimeToUtcIso=value=>value+'Z';
  `}));
 }}]});
 return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64')+'#'+crypto.randomUUID());
}

test('owner Check-in reads only roster/day/config and applies the exact IDs at both table queries',async()=>{
 const s=state(),api=await moduleFrom('lib/owner-pos-read-model.ts',s);
 const data=await api.loadOwnerCheckInData({context:s.context,ids:[staffB]});
 assert.deepEqual(data.staff.map(x=>x.id),[staffB]);assert.equal(data.staff[0].status,'not_checked_in');assert.equal(data.checkInEnabled,true);
 assert.deepEqual(s.reads.map(x=>x.table).sort(),['staff','staff_workdays']);
 for(const row of s.reads){assert(row.filters.some(([k,v])=>k==='salon_id'&&v==='salon-a'));assert(row.filters.some(([k,v])=>['id','staff_id'].includes(k)&&v[0]===staffB));}
 assert(!s.reads.some(x=>/customers|services|turn_parts|waiting/.test(x.table)));
 s.reads=[];s.legacy=true;const legacy=await api.loadOwnerCheckInData({context:s.context,ids:[staffA]});assert.equal(legacy.staff[0].checkInSequence,null);assert.equal(legacy.staff[0].queueTurnCount,0);assert.equal(s.reads.filter(x=>x.table==='staff_workdays').length,2);
});

test('named owner Check-in returns stable versions, body-free no-change and explicit removed IDs',async()=>{
 const s=state(),api=await moduleFrom('lib/app-local-owner-resources-server.ts',s);
 const first=await api.readAppLocalOwnerResource('owner.check-in',{query:''},{scope:s.scope});
 assert.equal(first.status,200);assert.equal(first.data.view,'check-in');assert.equal(first.data.props.data.staff.length,2);assert.match(first.etag,/^"[a-f0-9]{64}"$/);
 const same=await api.readAppLocalOwnerResource('owner.check-in',{query:''},{scope:s.scope,etag:first.etag});assert.equal(same.status,304);assert.equal('data' in same,false);
 const patch=await api.readAppLocalOwnerResource('owner.check-in',{query:'',ids:[staffB,missing]},{scope:s.scope});
 assert.deepEqual(patch.data.props.data.staff.map(x=>x.id),[staffB]);assert.deepEqual(patch.data.props.removedIds,[missing]);
 s.days[0].status='break';const changed=await api.readAppLocalOwnerResource('owner.check-in',{query:''},{scope:s.scope,etag:first.etag});assert.equal(changed.status,200);assert.notEqual(changed.etag,first.etag);
});

test('named owner reader rejects wrong authority, unknown names and malformed filters before data reads',async()=>{
 const s=state(),api=await moduleFrom('lib/app-local-owner-resources-server.ts',s);
 assert.equal(await api.readAppLocalOwnerResource('owner.arbitrary-table',{},{}),null);assert.equal(s.contexts,0);
 await assert.rejects(()=>api.readAppLocalOwnerResource('owner.check-in',{}, {scope:'scope-other'}),e=>e.status===409);assert.equal(s.reads.length,0);
 await assert.rejects(()=>api.readAppLocalOwnerResource('owner.check-in',{query:'token=secret'},{scope:s.scope}),e=>e.status===400);
 s.unavailable=true;await assert.rejects(()=>api.readAppLocalOwnerResource('owner.check-in',{}, {scope:s.scope}),e=>e.status===503);s.unavailable=false;
 s.authenticated=false;await assert.rejects(()=>api.readAppLocalOwnerResource('owner.check-in',{}, {scope:s.scope}),e=>e.status===401);
 s.authenticated=true;s.manage=false;await assert.rejects(()=>api.readAppLocalOwnerResource('owner.check-in',{}, {scope:s.scope}),e=>e.status===403);
 s.manage=true;s.permission=false;const denied=await api.readAppLocalOwnerResource('owner.check-in',{}, {scope:s.scope});assert.equal(denied.data.view,'denied');assert.equal(s.reads.length,0);
});


test('POS settings no longer wait behind desk/timezone, and the complete authorized DTO is unchanged',async()=>{
 const values=[];
 for(const before of [true,false]){
  const s=state();s.desk={today:'2026-10-16',staff:s.staff,services:[{id:'service-a',price:44.25}],defaults:{taxEnabled:false}};
  let deskReady,timezoneReady;s.deskGate=new Promise(r=>deskReady=r);s.timezoneGate=new Promise(r=>timezoneReady=r);
  const api=await moduleFrom('lib/app-local-owner-resources-server.ts',s,before);
  const pending=api.readAppLocalOwnerResource('owner.workspace',{}, {scope:s.scope});await new Promise(r=>setImmediate(r));
  assert.equal(s.reads.some(q=>q.table==='pos_settings'),!before,'only the improved path starts preferences before the desk finishes');
  deskReady();timezoneReady();const result=await pending;values.push(result);
  assert.deepEqual(s.reads.find(q=>q.table==='pos_settings').filters,[['salon_id','salon-a']]);
  s.settingsError={message:'unavailable'};await assert.rejects(api.readAppLocalOwnerResource('owner.workspace',{}, {scope:s.scope}),e=>e.status===503);
 }
 assert.deepEqual(values[1].data,values[0].data);assert.equal(values[1].etag,values[0].etag);
});
