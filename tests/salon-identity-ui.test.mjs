import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url),ts=require('typescript'),cache=new Map();
function load(path) {
 if(cache.has(path))return cache.get(path);
 const mod={exports:{}};
 const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 vm.runInNewContext(code,{exports:mod.exports,console,Intl,require(name){
  if(name==='next/link')return {default:({children,href,...props})=>React.createElement('a',{...props,href},children)};
  if(name.startsWith('@/')){const base=name.slice(2);let target;try{readFileSync(base+'.tsx');target=base+'.tsx';}catch{target=base+'.ts';}return load(target);}
  return require(name);
 }});cache.set(path,mod.exports);return mod.exports;
}
const {SalonTrustLine,SalonVerifiedBadge}=load('components/salon-trust-line.tsx');
const {salonPopularPrice}=load('lib/salon-identity.ts');
const evidence={ruleVersion:'lumi-trust-v2',asOf:'2026-10-05T00:00:00Z',feedbackDays:180,returnDays:90,cohortDays:180,verifiedVisitCount:300,uniqueVisitorCount:100,feedbackCustomerCount:100,goodFeedbackCount:98,issueFeedbackCount:2,eligibleReturnCustomerCount:100,returningCustomerCount:70};
const render=(options={})=>renderToStaticMarkup(React.createElement(SalonTrustLine,{signals:{averageRating:5,verifiedVisitCount:99999,trustEvidence:evidence},name:'Test salon',href:'/explore/salons/salon-a',...options}));
test('Trust row uses canonical visited and independent opinions, not legacy volume or stars',()=>{
 const html=render();assert.match(html,/300 visited/);assert.match(html,/100 opinions/);assert.doesNotMatch(html,/99,999|★|out of 5/);assert.match(html,/Diamond/);
});
test('expanded opinion links reach the correct good and concern filters',()=>{
 const html=render({expanded:true});assert.match(html,/href="\/explore\/salons\/salon-a#feedback-good"/);assert.match(html,/href="\/explore\/salons\/salon-a#feedback-issue"/);assert.match(html,/98 good/);assert.match(html,/2 concerns/);
});
test('empty evidence shows Building and zero counts without a spark',()=>{
 const zeros=Object.fromEntries(Object.keys(evidence).filter(k=>k.endsWith('Count')).map(k=>[k,0]));
 const html=render({signals:{averageRating:null,trustEvidence:{...evidence,...zeros}}});assert.match(html,/Building LUMI Truth/);assert.match(html,/0 visited/);assert.match(html,/0 opinions/);assert.doesNotMatch(html,/data-lumi-trust-level/);
});
test('unknown source never fabricates zero visits or a legacy Trust icon',()=>{
 const html=render({signals:{averageRating:5,verifiedVisitCount:999}});assert.match(html,/Trust unavailable/);assert.match(html,/Visits unavailable/);assert.doesNotMatch(html,/0 visited|data-lumi-trust-level/);
});
test('compact linked cards have no nested anchors or interactive Trust buttons',()=>{
 const html=render({compact:true,staticOnly:true});assert.match(html,/300 visited/);assert.doesNotMatch(html,/<a |<button|100 opinions|Diamond<\/span>/);
});
test('only approved identity renders a blue verification badge',()=>{
 assert.equal(renderToStaticMarkup(React.createElement(SalonVerifiedBadge,{verified:false})), '');
 assert.equal(renderToStaticMarkup(React.createElement(SalonVerifiedBadge,{})), '');
 assert.match(renderToStaticMarkup(React.createElement(SalonVerifiedBadge,{verified:true})),/Verified salon identity/);
});
test('popular group price includes service name and respects single, range and unknown prices',()=>{
 assert.equal(salonPopularPrice({popularServiceName:'Pedicure',popularServiceMinimumPrice:40,popularServiceMaximumPrice:100}),'Pedicure $40–$100');
 assert.equal(salonPopularPrice({popularServiceName:'Pedicure',popularServiceMinimumPrice:40,popularServiceMaximumPrice:40}),'Pedicure $40');
 assert.equal(salonPopularPrice({popularServiceName:'Pedicure',popularServiceMinimumPrice:null,popularServiceMaximumPrice:40}),null);
});
