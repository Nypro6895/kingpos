import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {build} from 'esbuild';
import {ticketDetailFixture} from './fixtures/ticket-detail-professional-data.mjs';

// Real page and pure financial/receipt/navigation code; only server identities,
// authorization/data reads and action dispatch are replaced with synthetic seams.
const {outputFiles}=await build({stdin:{contents:`export {calculateTicketTotals} from './lib/pos-ticket-calculations';export {ticketFinancialView} from './lib/pos-ticket-financial-view';export {buildTicketReceipt} from './lib/pos-ticket-receipt';export * from './lib/pos-ticket-navigation';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'esm',alias:{'@':process.cwd()}});
const pure=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
const componentNames=['WorkspaceText','ContextualSupport','SubmitButton','ClosedTicketDetailEditor','TicketDetailView','TicketDetailInlineHistory','TicketPaymentSummary','TicketGiftDelivery','ReceiptPrintActions'];
const file='app/(app)/pos-tickets/[ticketId]/page.tsx';
const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const printed=ts.createPrinter().printFile(ts.factory.updateSourceFile(source,source.statements.filter(s=>!ts.isImportDeclaration(s))));
const code=ts.transpileModule(printed,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText;

function fixture({owner=true,scenario='open',locked=false,gift=false}={}){
 const data=ticketDetailFixture('?scenario='+scenario),calls=[];
 data.ticket.workspace_revision=19;
 if(gift)data.ticket.financial_sources={giftSales:[{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',last4:'4321',amountCents:2500,status:'completed',paymentMethod:'cash',createdAt:data.ticket.created_at}],giftRedeemedCents:0,rewardDiscount:0};
 const context={user:{id:'synthetic-owner'},currentSalon:data.salon,currentMembership:{role:owner?'Owner':'Manager'}};
 const React={createElement:(type,props,...children)=>({type,props:{...props,children}})};
 const deps={React,...pure,...Object.fromEntries(componentNames.map(n=>[n,Symbol(n)])),styles:{service:'service',row:'row',serviceName:'name',amount:'amount',small:'small',notice:'notice',actionForms:'actions'},STAFF_WORKDAY_STATUS_LABELS:{working:'Working'},withExperiencePage:p=>p,
  POS_PAYMENT_METHOD_OPTIONS:[{value:'cash',label:'Cash'}],POS_TICKET_PERMISSIONS:{view:'view',manage:'manage',void:'void'},FINANCIAL_CORRECTION_PERMISSIONS:{request:'request'},
  getWorkspaceTranslation:async()=>s=>s,requireSalonManagePageContext:async()=>context,isOwnerMembership:()=>owner,
  hasPermission:async()=>true,getCurrentSalonPosTicket:async()=>({ticket:data.ticket}),getCurrentSalonPosTicketOptions:async()=>({services:data.services,staff:data.staff}),
  getContextBusinessTimezone:async()=>'America/Chicago',isDailyClosingLocked:async()=>locked,canApplyFinancialCorrections:async()=>true,getTicketTimeline:()=>[],
 };
 for(const name of ['addPosPayment','addPosTicketItem','cancelPosTicket','closePosTicket','deletePosPayment','deletePosTicketItem','reopenPosTicket','updatePosTicketDiscount','updatePosTicketItem','updatePosTicketItemStaff','updatePosTicketTaxRate','updatePosTicketTip','voidPosTicket'])deps[name]=async form=>{calls.push({name,values:Object.fromEntries(form)});};
 const module={exports:{}};new Function('module','exports',...Object.keys(deps),code)(module,module.exports,...Object.values(deps));
 return{data,calls,deps,page:query=>module.exports.default({params:Promise.resolve({ticketId:data.ticket.id}),searchParams:Promise.resolve(query??{})})};
}
function elements(node,{expand=false}={}){
 if(node==null||typeof node!=='object')return[];
 if(Array.isArray(node))return node.flatMap(n=>elements(n,{expand}));
 if(expand&&typeof node.type==='function')return elements(node.type(node.props),{expand});
 return[node,...elements(node.props?.children,{expand})];
}

test('actual page retains owner boundary even when non-owner permission reads allow management',async()=>{
 for(const scenario of ['open','closed']){
  const f=fixture({owner:false,scenario}),result=await f.page({edit:'1'});
  assert.equal(result.type,f.deps.TicketDetailView);
  for(const field of ['editHref','serviceEditor','itemEditors','serviceActions','financialEditor','paymentEditors','paymentEditor','actions'])assert.equal(result.props[field],undefined,`${scenario}: ${field}`);
  assert.equal(f.calls.length,0);
 }
});
test('canonical Gift retail projection appears once in totals, receipt, delivery and payment readback',async()=>{
 const f=fixture({scenario:'closed',gift:true}),result=await f.page();
 const baseline=pure.calculateTicketTotals({items:f.data.ticket.ticket_items,payments:f.data.ticket.payments,discountType:'fixed_amount',discountValue:0,taxRate:0,tipType:'fixed_amount',tipValue:0});
 const expected=pure.ticketFinancialView(f.data.ticket,baseline);
 assert.deepEqual(result.props.totals,expected.totals);
 assert.equal(result.props.totals.total,105);assert.equal(result.props.receipt.totals.grand_total,105);assert.equal(result.props.receipt.totals.paid,105);
 assert.equal(result.props.receipt.items.length,4,'Gift must be added exactly once');
 assert.equal(elements(result.props.giftItems).filter(n=>n.type===f.deps.TicketGiftDelivery).length,1);
 assert.deepEqual(result.props.paymentSummary.props.payments,expected.payments);
 const actions=elements(result.props.actions,{expand:true});
 assert.equal(actions.some(n=>n.props?.action===f.deps.reopenPosTicket),false,'Gift sales cannot regain the legacy Reopen path');
});
test('real edit forms retain revision and the same captured UUID when the same form is retried',async()=>{
 const f=fixture(),result=await f.page({edit:'1'});
 const form=elements(result.props.itemEditors[f.data.ticket.ticket_items[0].id],{expand:true}).find(n=>n.type==='form'&&n.props.action===f.deps.updatePosTicketItem);
 assert.ok(form,'Revision-aware amount editor remains reachable');
 const inputs=elements(form,{expand:true}).filter(n=>n.type==='input');
 const submitted=new FormData();for(const n of inputs.filter(n=>n.props.type==='hidden'))submitted.append(n.props.name,String(n.props.value??''));
 submitted.set('quantity','1');submitted.set('unit_price','30');submitted.set('correction_reason','Synthetic amount edit');
 await form.props.action(submitted);await form.props.action(submitted);
 assert.equal(f.calls.length,2);assert.deepEqual(f.calls[1],f.calls[0]);
 assert.equal(f.calls[0].values.expected_revision,'19');assert.match(f.calls[0].values.request_id,/^[a-f0-9-]{36}$/i);
 assert.equal(f.calls[0].values.item_id,f.data.ticket.ticket_items[0].id);assert.equal(f.calls[0].values.unit_price,'30');
});
test('print/preview props carry only the canonical receipt; rendering never dispatches financial actions',async()=>{
 const f=fixture({scenario:'closed',gift:true}),result=await f.page({returnTo:'/reports?month=2026-11'});
 assert.equal(result.props.backHref,'/reports?month=2026-11');
 assert.equal(result.props.receiptActions.type,f.deps.ReceiptPrintActions);
 assert.equal(result.props.receiptActions.props.receipt,result.props.receipt);
 assert.equal(result.props.receiptActions.props.receiptId,f.data.ticket.id);
 assert.equal(elements(result.props.receiptActions).some(n=>n.type==='form'),false);
 assert.equal(f.calls.length,0);
 const follow=await f.page({edit:'1',returnTo:'/reports?month=2026-11'});
 assert.equal(new URL(follow.props.serviceEditor.props.returnTo,'https://local.test').searchParams.get('returnTo'),'/reports?month=2026-11');
});

test('actual native registry and hosted transport preserve Edit plus the exact safe return query',async()=>{
 const extract=(file,names)=>{
  const ast=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  const statements=ast.statements.filter(s=>ts.isFunctionDeclaration(s)&&names.includes(s.name?.text)||ts.isVariableStatement(s)&&s.declarationList.declarations.some(d=>ts.isIdentifier(d.name)&&names.includes(d.name.text)));
  const printed=ts.createPrinter().printFile(ts.factory.updateSourceFile(ast,statements));
  return ts.transpileModule(printed,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText;
 };
 const daily={exports:{}};new Function('exports','ticket','tax','install',extract('lib/app-local-daily-registry.tsx',['uuid','getAppLocalDailyPage']))(daily.exports,{id:'ticket'},{id:'tax'},{id:'install'});
 const requests=[],host={exports:{}};
 new Function('exports','nativeRequest',extract('lib/app-local-host.ts',['appLocalPath','nativeHost'])+'\nexports.nativeHost=nativeHost;')(host.exports,(...args)=>{requests.push(args);return Promise.resolve();});
 const id=ticketDetailFixture().ticket.id,list=pure.buildTicketListHref({ticketId:id,date:'2026-11-14',q:'Nene & Kim'});
 const destination=pure.buildTicketDetailHref(id,{edit:true,returnTo:list});
 assert.equal(daily.exports.getAppLocalDailyPage('/pos-tickets/'+id).id,'ticket');
 assert.equal(daily.exports.getAppLocalDailyPage(destination),null,'Strict native query gate stays intact; existing entry sends unsupported destinations online.');
 await host.exports.nativeHost.openOnline(destination);
 assert.deepEqual(requests,[['online','open',{path:destination}]]);
 assert.equal(new URL(requests[0][2].path,'https://reylumi.com').searchParams.get('returnTo'),list);
 await assert.rejects(async()=>host.exports.nativeHost.openOnline('//evil.test/pos-tickets/'+id),/Invalid application page/);
 assert.equal(requests.length,1,'Rejected destination never reaches the native transport.');
});
