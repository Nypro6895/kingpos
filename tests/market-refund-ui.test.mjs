import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import fs from 'node:fs';
const require=createRequire(import.meta.url);
const compiled=await build({stdin:{contents:'export {FinanceRefundOrder} from "./app/(market-platform)/developer-platform/finance-refunds";export {DeveloperPortal} from "./app/(market-platform)/developer-platform/sections";',resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',alias:{'@':process.cwd()},plugins:[{name:'refund-ui-boundaries',setup(b){b.onResolve({filter:/^react(?:\/jsx-runtime)?$/},a=>({path:pathToFileURL(require.resolve(a.path)).href,external:true}));b.onResolve({filter:/^\.\/actions$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export async function platformAction(){return {ok:false,uncertain:true,message:"Synthetic preview only"}}'}));}}]});
const {FinanceRefundOrder,DeveloperPortal}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const order={id:id(1),charge_id:'ch_synthetic',version_id:id(2),amount_cents:1000,fee_cents:100,refunded_cents:0,disputed:false,state:'paid',transfer_id:'tr_synthetic'};
const intent=status=>({id:id(3),order_id:id(1),charge_id:'ch_synthetic',amount_cents:1000,status});
const render=(intents,enabled=true,lang='en',extra={})=>renderToStaticMarkup(React.createElement(DeveloperPortal,{initialPanel:'finance',initialLanguage:lang,availablePanels:['finance']},React.createElement(FinanceRefundOrder,{order:{...order,...extra},intents,enabled})));

test('actual financial refund component separates a new request, pending/recovery and terminal observation',()=>{
 const fresh=render([]);assert.match(fresh,/Request full test refund/);assert.match(fresh,/<input[^>]+type="checkbox"[^>]+required/);
 for(const status of ['requested','pending','requires_action']){const html=render([intent(status)]);assert.match(html,/Continue or reconcile test refund/);assert.match(html,/not bank settlement/);assert.match(html,/existing request is reused/);assert.equal((html.match(/<form/g)??[]).length,1);}
 for(const status of ['succeeded','failed','canceled']){const html=render([intent(status)]);assert.doesNotMatch(html,/<form/);assert.match(html,/Do not create another refund/);assert.match(html,/Access changes only after the authoritative charge/);}
});
test('unavailable/ambiguous history, disabled test configuration, disputed or refunded order cannot offer a refund form',()=>{
 for(const intents of [undefined,null,[null],[intent('unknown')],[intent('pending'),intent('pending')],[{...intent('pending'),charge_id:'ch_foreign'}]]){const html=render(intents);assert.doesNotMatch(html,/<form/);assert.match(html,/could not be verified/);}
 assert.doesNotMatch(render([],false),/<form/);assert.doesNotMatch(render([],true,'en',{disputed:true}),/<form/);assert.doesNotMatch(render([],true,'en',{refunded_cents:1000,state:'revoked'}),/<form/);
});
test('financial pending/recovery/terminal notices translate in Vietnamese and never render invalid money as NaN',()=>{
 const html=render([intent('pending')],true,'vi');assert.match(html,/Provider đang xử lý hoàn tiền/);assert.match(html,/chưa phải quyết toán ngân hàng/);assert.match(html,/Tiếp tục hoặc đối chiếu/);
 assert.doesNotMatch(render([],true,'vi',{amount_cents:NaN}),/NaN|<form/);
 const source=fs.readFileSync('app/(market-platform)/developer-platform/finance-refunds.tsx','utf8'),copy=JSON.parse(fs.readFileSync('lib/vietnamese-developer-market.json'));
 for(const [,text]of source.matchAll(/<DeveloperText text="([^"]+)"/g))assert.equal(typeof copy[text],'string',text);
});
