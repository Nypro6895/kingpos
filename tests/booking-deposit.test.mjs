import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle=await build({entryPoints:['types/booking-deposit.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {bookingDepositCents:amount,BOOKING_DEPOSIT_MONTHLY_CENTS}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
test('USD amounts use integer cents, clamp fixed deposits, round percentages and reject invalid values',()=>{
 assert.equal(BOOKING_DEPOSIT_MONTHLY_CENTS,590);
 assert.equal(amount(10000,{mode:'fixed',value:20}),2000);
 assert.equal(amount(1500,{mode:'fixed',value:20}),1500);
 assert.equal(amount(9999,{mode:'percent',value:25}),2500);
 assert.equal(amount(9999,{mode:'full',value:20}),9999);
 assert.equal(amount(0,{mode:'fixed',value:20}),0);
 for(const total of [-1,1.1,NaN,Infinity]) assert.throws(()=>amount(total,{mode:'fixed',value:20}),/Invalid/);
 assert.throws(()=>amount(100,{mode:'percent',value:101}),/percentage/);
 assert.throws(()=>amount(100,{mode:'fixed',value:NaN}),/Invalid/);
});
