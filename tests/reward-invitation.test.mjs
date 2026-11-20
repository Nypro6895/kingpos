import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/reward-invitation.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Number});
const salon={id:'shop',name:'Local salon',city:'Chicago',state:'IL',distanceMiles:1.2,spendPoints:20,visitPoints:0,welcomePoints:10,firstBookingPoints:20,conversionPoints:30,canBook:true};
const eligible={spend:true,visit:false,welcome:true,firstBooking:true,beforeAfter:true};
test('a chosen referral/welcome/spend filter keeps its invitation even on mixed programs',()=>{
 assert.match(exports.rewardInvitation(salon,'before_after',eligible).body,/guest.*Before & After.*pays in full/);
 assert.doesNotMatch(exports.rewardInvitation(salon,'before_after',eligible).title,/Book a visit/);
 assert.match(exports.rewardInvitation(salon,'welcome',eligible).body,/one-time welcome/);
 assert.match(exports.rewardInvitation(salon,'spend',eligible).body,/qualifying services/);
});
test('consumed one-time rewards and unknown eligibility never promise another earning award',()=>{
 const once={...salon,spendPoints:0,conversionPoints:0};
 for(const flags of[undefined,{...eligible,spend:false,firstBooking:false,welcome:false,beforeAfter:false}]){
  const invitation=exports.rewardInvitation(once,'all',flags);
  assert.equal(invitation.title,'Your rewards at this salon');
  assert.doesNotMatch(invitation.body,/can earn|receive your/);
 }
 assert.doesNotMatch(exports.rewardInvitation(once,'welcome',{...eligible,welcome:false}).body,/receive your/);
 assert.match(exports.rewardInvitation(once,'all',{...eligible,firstBooking:true,welcome:false}).title,/first paid booking/);
});
test('no active booking means no direct book target or booking-led recurring headline',()=>{
 assert.equal(exports.rewardVisitTarget({...salon,canBook:false}),'/explore/salons/shop#salon-rewards');
 assert.doesNotMatch(exports.rewardInvitation({...salon,canBook:false},'all',eligible).title,/Book a visit/);
 assert.equal(exports.rewardVisitTarget(salon),'/book/shop?source=explore');
 assert.equal(exports.rewardVisitTarget(salon,'before_after',eligible),'/explore/salons/shop#salon-rewards');
 const mixed={...salon,spendPoints:0,visitPoints:0};
 assert.match(exports.rewardInvitation(mixed,'all',eligible).title,/Share your look/);
 assert.equal(exports.rewardVisitTarget(mixed,'all',eligible),'/explore/salons/shop#salon-rewards');
 assert.equal(exports.rewardVisitTarget({...salon,spendPoints:0,conversionPoints:0},'all',{...eligible,firstBooking:false,welcome:false}),'/explore/salons/shop#salon-rewards');
});
test('precise local context accepts zero distance and never manufactures named-area miles',()=>{
 assert.equal(exports.rewardLocalLabel(salon),'1.2 mi · Chicago, IL');
 assert.equal(exports.rewardLocalLabel({...salon,distanceMiles:0}),'0 mi · Chicago, IL');
 assert.equal(exports.rewardLocalLabel({...salon,distanceMiles:null}),'Chicago, IL');
 assert.equal(exports.rewardLocalLabel({...salon,distanceMiles:NaN,city:null,state:null}),'');
});
test('nail imagery is never used for hair/unknown/mixed categories by default',()=>{
 assert.equal(exports.rewardNailIllustration({...salon,serviceCategories:['Nails']}),true);
 for(const serviceCategories of[[],['Hair'],['Nails','Hair']])assert.equal(exports.rewardNailIllustration({...salon,serviceCategories}),false);
 assert.equal(exports.rewardNailIllustration({...salon,serviceCategories:['Nails']},'Hair'),false);
 assert.equal(exports.rewardNailIllustration({...salon,serviceCategories:['Nails','Hair']},'Nails'),true);
});
