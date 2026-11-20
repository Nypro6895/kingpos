import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs';
import ts from 'typescript';

const bundled=await build({stdin:{resolveDir:process.cwd(),contents:"export * from './lib/staff-ticket-history-context';export * from './lib/ticket-day-bounds';export * from './lib/ticket-history-navigation';",loader:'ts'},bundle:true,write:false,platform:'node',format:'cjs'});
const module={exports:{}};new Function('module','exports',bundled.outputFiles[0].text)(module,module.exports);
const {staffTicketHistoryContexts,ticketDayBounds,ticketNotificationDate,legacyTicketNoticeDate}=module.exports;
const event={id:'change-1',salon_id:'salon',staff_id:'anna',ticket_id:'ticket-1',source_id:'ticket-1',source_table:'ticket',event_action:'updated',period_start:'2026-10-30',period_end:'2026-10-30',created_at:'2026-10-31T15:00:00Z',before_values:{service_total:50,lines:[{service_name:'Manicure',service_total:50}]},after_values:{ticket_number:'T001',service_total:0,lines:[]}};

test('reassigned or past own work gets one context row without inventing a current ticket or changing the supplied totals',()=>{
 const current=['ticket-2'],before=structuredClone(current),events=[event,{...event,id:'other',staff_id:'bella',after_values:{service_total:999}},event];
 const rows=staffTicketHistoryContexts(current,'2026-10-31','anna',events);
 assert.equal(rows.length,1);assert.equal(rows[0].ticketId,'ticket-1');assert.equal(rows[0].businessDate,'2026-10-30');assert.equal(rows[0].changes.length,1);assert.equal(rows[0].values.service_total,0);assert.deepEqual(current,before);assert.ok(!JSON.stringify(rows).includes('999'));
 assert.equal(staffTicketHistoryContexts(['ticket-1'],'2026-10-30','anna',[event]).length,0,'retained zero earning row is reused');
});
test('draft, creation, no-op and an event ID without a proven ticket ID never become edited context rows',()=>{
 const candidates=[{...event,event_action:'draft'},{...event,event_action:'created'},{...event,before_values:event.after_values},{...event,ticket_id:undefined}];
 assert.deepEqual(staffTicketHistoryContexts([],'2026-10-31','anna',candidates),[]);
 const recorded={...event,id:'created',event_action:'created',before_values:{}};
 const rows=staffTicketHistoryContexts([],'2026-10-31','anna',[],recorded);assert.equal(rows.length,1);assert.equal(rows[0].changes.length,0);assert.equal(rows[0].record.id,'created');
});
test('a snapshot with the latest edit wins independent of input order, while A to B to A keeps both edits',()=>{
 const later={...event,id:'change-2',created_at:'2026-10-31T16:00:00Z',before_values:event.after_values,after_values:event.before_values};
 const rows=staffTicketHistoryContexts([],'2026-10-31','anna',[later,event]);assert.equal(rows[0].changes.length,2);assert.equal(rows[0].values.service_total,50);
});
test('a validated notification chooses the original day; ordinary date navigation and malformed links retain their existing date',()=>{
 const inputEvent='00000000-0000-4000-8000-000000000001';
 assert.equal(ticketNotificationDate({date:'2026-10-31',eventDate:'2026-10-29',inputEvent}),'2026-10-29');
 assert.equal(ticketNotificationDate({date:'2026-10-31',eventDate:'2026-10-29',inputEvent:'invalid'}),'2026-10-31');
 assert.equal(ticketNotificationDate({date:['2026-10-30']}),'2026-10-30');
});
test('legacy ticket notices select only a real original day without claiming an edit ID',()=>{
 assert.equal(ticketNotificationDate({eventDate:'2026-10-29'}),'2026-10-29');
 assert.equal(ticketNotificationDate({date:'2026-10-31',eventDate:['2026-10-29']}),'2026-10-29');
 assert.equal(legacyTicketNoticeDate({eventDate:'2024-02-29'}),'2024-02-29');
 assert.equal(legacyTicketNoticeDate({eventDate:'2026-10-29',inputEvent:''}),'2026-10-29');
 for(const eventDate of ['2026-02-29','2026-02-30','2026-13-01','2026-10-32','29-10-2026','2026-10-29T00:00:00Z','']){
  assert.equal(legacyTicketNoticeDate({eventDate}),undefined,eventDate);
  assert.equal(ticketNotificationDate({date:'2026-10-31',eventDate}),'2026-10-31',eventDate);
 }
 assert.equal(legacyTicketNoticeDate({eventDate:'2026-10-29',inputEvent:'malformed'}),undefined);
 assert.equal(ticketNotificationDate({date:'2026-10-31',eventDate:'2026-02-30',inputEvent:'00000000-0000-4000-8000-000000000001'}),'2026-10-31');
});
test('actual web and native Today entry points both forward the original legacy business date',async()=>{
 const read=(file,names)=>{const ast=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);return ast.statements.filter(node=>ts.isFunctionDeclaration(node)&&names.includes(node.name?.text)||ts.isVariableStatement(node)&&node.declarationList.declarations.some(declaration=>names.includes(declaration.name.getText(ast)))).map(node=>node.getText(ast)).join('\n');};
 const entry=read('lib/app-local-page-registry.tsx',['urlFor','queryFor','TodayPage'])+'\n'+read('app/(app)/staff/today/page.tsx',['loadTodayContent']);
 const output=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`import{ticketNotificationDate}from'./lib/ticket-history-navigation';
 const AppLocalTodayClient=()=>null,TodayDashboardClient=()=>null,requireSalonManagePageContext=async()=>({currentSalon:{id:'salon'}}),getTodayDashboard=async(_context,args)=>({date:args.date}),runReadWithDeadline=async data=>data,createLiveResourceSnapshot=data=>({data}),getExperienceContext=()=>({scope:'scope'}),isOwnerMembership=()=>true;
 ${entry}
 export const native=path=>TodayPage({path,context:{context:{scope:'scope'}}}).props;
 export const web=async params=>(await loadTodayContent({searchParams:Promise.resolve(params)})).props;
 `},bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic'});
 const entryModule={exports:{}};new Function('module','exports',output.outputFiles[0].text)(entryModule,entryModule.exports);
 const href='/staff/today?eventDate=2026-10-29#input-history';
 assert.equal(entryModule.exports.native(href).requestedDate,'2026-10-29');
 assert.equal(entryModule.exports.native(href).historyQuery,'?eventDate=2026-10-29');
 assert.equal((await entryModule.exports.web({eventDate:'2026-10-29'})).requestedDate,'2026-10-29');
 assert.equal(entryModule.exports.native('/staff/today?date=2026-10-31&eventDate=2026-02-30#input-history').requestedDate,'2026-10-31');
 assert.equal((await entryModule.exports.web({date:'2026-10-31',eventDate:'2026-02-30'})).requestedDate,'2026-10-31');
});
test('Owner Today reads the entire salon business date across daylight-saving transitions',()=>{
 assert.deepEqual(ticketDayBounds('2026-11-01','America/Chicago'),{openedFrom:'2026-11-01T05:00:00.000Z',openedTo:'2026-11-02T05:59:59.999Z'});
 assert.deepEqual(ticketDayBounds('2026-03-08','America/Chicago'),{openedFrom:'2026-03-08T06:00:00.000Z',openedTo:'2026-03-09T04:59:59.999Z'});
});
