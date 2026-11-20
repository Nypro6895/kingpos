import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const compiled=await build({entryPoints:['lib/customer-checkout-view.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {customerCheckoutView}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const draft={customer:{id:'customer'},subtotal:100,discount:5,tip:19,total:114};
const reward={request:{status:'confirmed',valueCents:500},checkout:{customerId:'customer',subtotalCents:10000,discountCents:500,tipCents:1900,totalCents:11400,giftCents:2500,rewardValueCents:500,points:60,earningEnabled:true}};
const gift={id:'gift',status:'open',approved:true,total:11400,amount:2500,purchase:0,expires:new Date(Date.now()+600000).toISOString()};
test('receipt splits a reward already included in the total and applies gift once',()=>{
 const v=customerCheckoutView(draft,reward,gift);assert.equal(v.discount,0);assert.equal(v.rewardDiscount,500);assert.equal(v.amountDue,8900);assert.equal(v.estimatedPoints,60);
});
test('ordinary discounts stay distinct from the reward',()=>{
 const v=customerCheckoutView({...draft,discount:15,total:104},reward,null);assert.equal(v.discount,1000);assert.equal(v.rewardDiscount,500);assert.equal(v.amountDue,10400);assert.equal(v.estimatedPoints,null);
});
test('a confirmed reward waits for the POS discount instead of inventing a lower total',()=>{
 const v=customerCheckoutView({...draft,discount:0,total:119},reward,null);assert.equal(v.rewardDiscount,0);assert.equal(v.amountDue,11900);assert.equal(v.estimatedPoints,null);
});
test('stale completed, expired, or mismatched gift sessions cannot reduce a new receipt',()=>{
 for(const other of [{...gift,status:'completed'},{...gift,total:11000},{...gift,expires:new Date(0).toISOString()},{...gift,approved:false}]){
  const v=customerCheckoutView(draft,reward,other);assert.equal(v.giftAmount,0);assert.equal(v.amountDue,11400);assert.equal(v.estimatedPoints,null);
 }
});
test('estimates cannot cross customer or receipt revisions and never become available balance',()=>{
 for(const changed of [{customerId:'other'},{tipCents:1800},{discountCents:0},{totalCents:11000},{giftCents:0},{rewardValueCents:0},{earningEnabled:false}])assert.equal(customerCheckoutView(draft,{...reward,checkout:{...reward.checkout,...changed}},gift).estimatedPoints,null);
});
