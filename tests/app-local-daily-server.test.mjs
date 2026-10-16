import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const id='11111111-1111-4111-8111-111111111111';
async function fixture(){
  const state=globalThis.dailyFixture={context:{scope:'owner-a',user:{id:'viewer-a'},currentSalon:{id:'salon-a',name:'My salon'},currentAccount:{id:'account-a'},manage:true},permissions:new Set(['tickets.view','tickets.manage','tickets.void']),calls:[],ticket:{id,salon_id:'salon-a',status:'open'},hold:null,headers:{},taxError:null};
  const stubs={
    'server-only':'',
    'next/headers':'export const headers=async()=>new Headers(globalThis.dailyFixture.headers);',
    'request-business-context':'export const getRequestBusinessContext=async()=>globalThis.dailyFixture.context;',
    'experience-context':'export const getExperienceContext=context=>({scope:context.scope});',
    'current-context':'export const isSalonManageContext=context=>context.manage===true;',
    'route-context-guards':'export const requireSalonManagePageContext=async()=>globalThis.dailyFixture.context;',
    'permissions':'export const hasPermission=async name=>globalThis.dailyFixture.permissions.has(name);',
    'pos-tickets':`export const POS_TICKET_PERMISSIONS={view:'tickets.view',manage:'tickets.manage',void:'tickets.void'};export async function getCurrentSalonPosTicket(id){const s=globalThis.dailyFixture;s.calls.push(['ticket',id]);if(s.hold)await s.hold;return{context:s.returnContext??s.context,ticket:s.ticket}}export async function getCurrentSalonPosTicketOptions(context){globalThis.dailyFixture.calls.push(['options',context.currentSalon.id]);return{services:[{id:'service-a'}],staff:[{id:'staff-a'}]}}`,
    'tax-company':`export async function taxCompanySalons(){const s=globalThis.dailyFixture;s.calls.push(['tax-list']);if(s.taxError)throw s.taxError;return[{id:'salon-b',active:true}]}export async function taxCompanyReport(...args){const s=globalThis.dailyFixture;s.calls.push(['tax-report',...args]);if(s.taxError)throw s.taxError;return{salon:{id:args[0]},lines:[],period:{value:args[2]},note:{content:'Private note',version:2}}}`,
  };
  const out=await build({entryPoints:['lib/app-local-daily-server.ts'],bundle:true,write:false,format:'esm',platform:'node',alias:{'@':process.cwd()},plugins:[{name:'daily-server-fixture',setup(b){b.onResolve({filter:/.*/},a=>{const key=Object.keys(stubs).find(key=>a.path===key||a.path.endsWith('/'+key));return key?{path:key,namespace:'fixture'}:undefined});b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:stubs[a.path]}));}}]});
  return{state,api:await import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'))};
}
test('daily reads reject invalid targets and changed identity before querying private data',async()=>{
  const{state,api}=await fixture();
  assert.equal(await api.readAppLocalDailyResource('arbitrary.table',{}, {scope:'owner-a'}),null);
  await assert.rejects(api.readAppLocalDailyResource('owner.ticket-detail',{ticketId:id,salonId:'other'},{scope:'owner-a'}),{status:400});
  await assert.rejects(api.readAppLocalDailyResource('owner.ticket-detail',{ticketId:'bad'},{scope:'owner-a'}),{status:400});
  await assert.rejects(api.readAppLocalDailyResource('owner.ticket-detail',{ticketId:id},{scope:'other'}),{status:409});
  state.context.user=null;
  await assert.rejects(api.readAppLocalDailyResource('owner.ticket-detail',{ticketId:id},{scope:'owner-a'}),{status:401});
  assert.deepEqual(state.calls,[]);
});
test('ticket detail retains view/manage/void checks and never returns a different salon or getter context',async()=>{
  const{state,api}=await fixture();state.permissions.delete('tickets.view');
  await assert.rejects(api.readAppLocalDailyResource('owner.ticket-detail',{ticketId:id},{scope:'owner-a'}),{status:403});assert.deepEqual(state.calls,[]);
  state.permissions.add('tickets.view');state.ticket.salon_id='other';
  await assert.rejects(api.readAppLocalDailyResource('owner.ticket-detail',{ticketId:id},{scope:'owner-a'}),{status:404});
  state.ticket.salon_id='salon-a';state.returnContext={...state.context,scope:'owner-b'};
  await assert.rejects(api.readAppLocalDailyResource('owner.ticket-detail',{ticketId:id},{scope:'owner-a'}),{status:409});
  assert.equal(state.calls.some(row=>row[0]==='options'),false);
  delete state.returnContext;state.permissions.delete('tickets.manage');
  const result=await api.readAppLocalDailyResource('owner.ticket-detail',{ticketId:id},{scope:'owner-a'});
  assert.equal(result.data.canManageTickets,false);assert.equal(result.data.canVoidTickets,true);assert.deepEqual(result.data.options,{services:[],staff:[]});
});
test('conditional ticket reads recheck authority and change revision when status or permissions change',async()=>{
  const{state,api}=await fixture(),args={ticketId:id};
  const first=await api.readAppLocalDailyResource('owner.ticket-detail',args,{scope:'owner-a'});
  assert.deepEqual(first.data.options.staff,[{id:'staff-a'}]);
  const same=await api.readAppLocalDailyResource('owner.ticket-detail',args,{scope:'owner-a',etag:first.etag});
  assert.equal(same.status,304);assert.equal(Object.hasOwn(same,'data'),false);assert.equal(state.calls.filter(row=>row[0]==='ticket').length,2);
  state.ticket.status='closed';
  const closed=await api.readAppLocalDailyResource('owner.ticket-detail',args,{scope:'owner-a',etag:first.etag});
  assert.equal(closed.status,200);assert.notEqual(closed.etag,first.etag);assert.deepEqual(closed.data.options,{services:[],staff:[]});
  state.permissions.delete('tickets.view');
  await assert.rejects(api.readAppLocalDailyResource('owner.ticket-detail',args,{scope:'owner-a',etag:closed.etag}),{status:403});
});
test('tax reads use original account-connection getters and never acquire durable workspace retention',async()=>{
  const{state,api}=await fixture();
  const list=await api.readAppLocalDailyResource('customer.tax-salons',{}, {scope:'owner-a'});assert.equal(list.data[0].id,'salon-b');
  const report=await api.readAppLocalDailyResource('customer.tax-report',{salonId:id,period:'2026-10-01:2026-10-15'},{scope:'owner-a'});
  assert.equal(report.data.note.version,2);assert.deepEqual(state.calls.at(-1),['tax-report',id,undefined,'2026-10-01:2026-10-15']);
  state.taxError=Object.assign(new Error('Connection is inactive'),{status:403});
  await assert.rejects(api.readAppLocalDailyResource('customer.tax-report',{salonId:id},{scope:'owner-a'}),/Connection is inactive/);
  const metadata=await build({entryPoints:['lib/app-local-daily-metadata.ts'],bundle:true,write:false,format:'esm',platform:'node'});const m=await import('data:text/javascript;base64,'+Buffer.from(metadata.outputFiles[0].text).toString('base64'));
  assert.equal(m.APP_LOCAL_DAILY_READS['customer.tax-report'].retention,'none');assert.equal(m.APP_LOCAL_DAILY_READS['customer.tax-salons'].retention,'none');
});
test('cancelled private reads cannot deliver late results and unavailable auth never calls a getter',async()=>{
  const{state,api}=await fixture();let done;state.hold=new Promise(resolve=>done=resolve);const controller=new AbortController();
  const pending=api.readAppLocalDailyResource('owner.ticket-detail',{ticketId:id},{scope:'owner-a',signal:controller.signal});
  while(!state.calls.length)await new Promise(resolve=>setImmediate(resolve));controller.abort();done();await assert.rejects(pending,{name:'AbortError'});
  state.calls=[];state.headers={'x-reylumi-auth-unavailable':'1'};
  await assert.rejects(api.readAppLocalDailyResource('owner.ticket-detail',{ticketId:id},{scope:'owner-a'}),{status:503});assert.deepEqual(state.calls,[]);
});
