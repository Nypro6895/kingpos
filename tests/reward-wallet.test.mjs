import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/reward-wallet.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Date,Number,Infinity});
const offer={id:'five',title:'$5 off',points:100,valueCents:500,minimumCents:4000};
const card=(id,available,joinedAt)=>({salonId:id,salonName:id,enabled:true,available,pending:0,reserved:0,offers:[offer],request:null,...(joinedAt?{joinedAt}:{})});

test('Beauty uses latest membership even with fewer or zero points, never largest balance',()=>{
 const rows=[card('old-high-balance',1000,'2026-10-01T00:00:00Z'),card('latest-zero',0,'2026-11-03T00:00:00Z'),card('middle',200,'2026-11-01T00:00:00Z')];
 assert.equal(exports.newestRewardMembership(rows).salonId,'latest-zero');
 assert.equal(exports.rewardWalletCards(rows).map(c=>c.salonId).join(','),'latest-zero,middle,old-high-balance');
 assert.equal(rows[0].salonId,'old-high-balance','helper does not mutate the response');
});
test('missing membership dates never masquerade as the newest joined salon',()=>{
 assert.equal(exports.newestRewardMembership([card('legacy',999)]),null);
 assert.equal(exports.newestRewardMembership([card('invalid',999,'bad date'),card('dated',0,'2026-11-01T00:00:00Z')]),null);
 assert.equal(exports.newestRewardMembership([card('unknown',999),card('dated',0,'2026-11-01T00:00:00Z')]),null);
});
test('equal millisecond timestamps preserve authoritative server order',()=>{
 const rows=[card('micros-newer',1,'2026-11-03T00:00:00.000999Z'),card('micros-older',999,'2026-11-03T00:00:00.000001Z')];
 assert.equal(exports.rewardWalletCards(rows).map(c=>c.salonId).join(','),'micros-newer,micros-older');
});
test('offer progress uses available points alone, excluding pending and held',()=>{
 const item={...card('shop',20),pending:100,reserved:100};
 const next=exports.rewardWalletOffer(item);
 assert.equal(next.remaining,80);assert.equal(next.progress,20);
 assert.equal(exports.rewardWalletBalanceLine(item),'100 pending · 100 held for a visit');
 assert.equal(exports.rewardWalletOffer({...item,available:120}).remaining,0);
 assert.equal(exports.rewardWalletOffer({...item,available:120}).progress,100);
 assert.equal(exports.rewardWalletOffer({...item,offers:[]}),null);
});
test('paused balances remain visible, and malformed private replies are not zero balances',()=>{
 assert.doesNotThrow(()=>exports.validateRewardWallet([{...card('paused',120),enabled:false}]));
 assert.doesNotThrow(()=>exports.validateRewardWallet([]));
 for(const value of [undefined,null,{},[{}],[{...card('bad',0),available:null}],[{...card('bad',0),pending:-1}],[{...card('bad',0),offers:[{}]}],[{...card('bad',0),history:[{id:'x',reason:'X',delta:1,at:'not-a-date'}]}]]) assert.throws(()=>exports.validateRewardWallet(value));
});
