import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {mkdirSync} from 'node:fs';
mkdirSync('artifacts/owner-financial-attention/unit',{recursive:true});
await build({entryPoints:['lib/owner-attention-presentation.ts'],bundle:true,platform:'node',format:'cjs',outfile:'artifacts/owner-financial-attention/unit/presentation.cjs'});
const {attentionTicketAmounts,attentionChangeDetails}=createRequire(import.meta.url)('../artifacts/owner-financial-attention/unit/presentation.cjs');
test('amounts keep recorded tender separate from services, discount, tax and tips',()=>{
 assert.deepEqual(attentionTicketAmounts({service_total:100,discount_amount:10,tax_rate:5,tip_amount:10,recorded_payment_total:100}),{service:100,discount:10,tip:10,total:104.5,paid:100,remaining:4.5});
 assert.equal(attentionTicketAmounts({service_total:50,discount_amount:50,recorded_payment_total:0}).remaining,0);
 assert.equal(attentionTicketAmounts({service_total:50,recorded_payment_total:55}).remaining,-5);
});
test('exact event shows service price, discount and deleted payment differences',()=>{
 const before={service_total:50,discount_type:'fixed_amount',discount_value:0,discount_amount:0,recorded_payment_total:50,lines:[{id:'line',service_name:'Full Set',staff_name:'Kim',service_total:50,quantity:1,unit_price:50}],payments:[{id:'p',method:'cash',amount:50}]};
 const after={...before,service_total:40,discount_value:5,discount_amount:5,recorded_payment_total:0,lines:[{...before.lines[0],unit_price:40,service_total:40}],payments:[]};
 const details=attentionChangeDetails({item_key:'event:1',business_date:'2026-11-01',occurred_at:'2026-11-01T16:00:00Z',facts:{before,after}});
 assert.ok(details.some(row=>row.before.includes('50')&&row.after.includes('40')));
 assert.ok(details.some(row=>row.label.toLowerCase().includes('discount')));
 assert.ok(details.some(row=>row.label.toLowerCase().includes('payment')));
});
test('earlier discount receipt never invents a previous amount',()=>{
 const details=attentionChangeDetails({item_key:'discount-current:1',business_date:'2026-11-01',occurred_at:'2026-11-01T16:00:00Z',facts:{before:{},after:{service_total:50,discount_amount:10}}});
 assert.ok(details.length);assert.ok(details.every(row=>row.comparison==='recorded'));
});
