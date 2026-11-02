import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/reward-discovery.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Intl});
test('coordinates never coerce missing or blank GPS to zero; accepts legitimate 0,0',()=>{
 for(const [lat,lon] of [[null,null],['',''],[' ',0],[undefined,-87],[91,0],[0,181],[NaN,0],[Infinity,0],['not-number',0]])assert.equal(exports.rewardDiscoveryPoint(lat,lon),null);
 assert.equal(exports.rewardDiscoveryPoint(0,0).latitude,0);assert.equal(exports.rewardDiscoveryPoint('41.88','-87.63').longitude,-87.63);
});
test('bounded radius and reward filters; zero earning never advertised',()=>{
 assert.equal(exports.rewardDiscoveryRadius(50),5);assert.equal(exports.rewardDiscoveryRadius(5),5);assert.equal(exports.rewardDiscoveryKind('forged'),'all');
 const zero={spendCents:2000,spendPoints:0,welcomePoints:0,firstBookingPoints:0,visitPoints:0,conversionPoints:0};
 assert.equal(exports.rewardEarnLines(zero).length,0);
 const lines=exports.rewardEarnLines({...zero,conversionPoints:30});assert.equal(lines.length,1);assert.match(lines[0],/another guest.*fully paid/);
});
test('public earning copy states receipt rounding and cards match the selected reward',()=>{
 const salon={spendCents:2000,spendPoints:20,welcomePoints:10,firstBookingPoints:20,visitPoints:0,conversionPoints:30};
 assert.match(exports.rewardEarnLines(salon)[0],/each fully paid receipt.*remainder does not carry/);
 assert.match(exports.rewardCardEarning(salon,'before_after'),/30 points.*Before & After referral/);
 assert.match(exports.rewardCardEarning(salon,'welcome'),/10.*welcome/);
 assert.match(exports.rewardOfferLabel({points:100,valueCents:500,minimumCents:4000}),/100 points.*\$5.00.*\$40.00 minimum/);
});
test('owner example rounds up complete spend thresholds and excludes bonuses',()=>{
 const rule={spendCents:2000,spendPoints:20,offers:[{points:101,valueCents:500}]};
 assert.equal(exports.rewardSpendExample(rule).qualifyingSpendCents,12000);
 assert.equal(exports.rewardSpendExample({...rule,spendPoints:0}),null);
 assert.equal(exports.rewardSpendExample({...rule,spendCents:NaN}),null);
});
test('owner cost example skips unusable offers and never invents a discount',()=>{
 const rule={spendCents:2000,spendPoints:20,offers:[{points:0,valueCents:500},{points:100,valueCents:500}]};
 assert.equal(exports.rewardSpendExample(rule).qualifyingSpendCents,10000);
 assert.equal(exports.rewardSpendExample({...rule,offers:[]}),null);
 assert.equal(exports.rewardSpendExample({...rule,offers:[{points:100,valueCents:0}]}),null);
});
