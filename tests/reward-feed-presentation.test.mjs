import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(file,imports={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:key=>imports[key],Set,Number});return exports;}
const invitation=load('lib/reward-invitation.ts');
const feed=load('lib/reward-feed-presentation.ts',{'./reward-invitation':invitation});
const salon={id:'one',name:'Nails',spendPoints:20,visitPoints:0,conversionPoints:0,welcomePoints:10,firstBookingPoints:20,canBook:true,serviceCategories:['Nails']};

test('feed avoids repeated business images, keeps local order and hidden salons out',()=>{
 const near={...salon,id:'near'},fresh={...salon,id:'fresh'},hidden={...salon,id:'hidden'};
 assert.deepEqual(Array.from(feed.rewardFeedCandidates([near,fresh,near,hidden],['near'],['hidden']),x=>x.id),['fresh','near']);
 assert.deepEqual(Array.from(feed.rewardFeedCandidates([near],['near']),x=>x.id),['near']);
});
test('promotion headline never substitutes own-visit earning for referral or consumed once-only rewards',()=>{
 assert.match(feed.rewardFeedInvitation(salon).title,/next nail day/);
 assert.match(feed.rewardFeedInvitation({...salon,serviceCategories:['Hair']}).title,/next visit/);
 const once={...salon,spendPoints:0};
 assert.equal(feed.rewardFeedInvitation(once,'Nails').title,'Your rewards at this salon');
 const referral={...once,conversionPoints:30};
 assert.equal(feed.rewardFeedInvitation(referral).title,'Share your look. Earn rewards.');
 assert.doesNotMatch(feed.rewardFeedInvitation(referral).body,/your next visit/);
 assert.equal(feed.rewardFeedInvitation(salon,'Nails',{spend:false,visit:false,beforeAfter:false,welcome:false,firstBooking:false}).title,'Your rewards at this salon');
});
