const { test } = require('node:test');
const assert = require('node:assert/strict');
const { receiptHtml } = require('../checkin-receipt.cjs');
const receipt = { visitId:'00000000-0000-4000-8000-000000000001',queueNumber:12,businessDate:'2026-10-08',salonName:'Salon',customerName:'<script>alert(1)</script>',cells:[[1,2],[3,4]] };
test('Native print layout escapes customer text and uses local QR geometry', () => {
 const html=receiptHtml(receipt);
 assert.match(html,/#12/); assert.match(html,/&lt;script&gt;/); assert.doesNotMatch(html,/<script>/);
 assert.match(html,/default-src 'none'/); assert.match(html,/width:44mm/);
 assert.throws(()=>receiptHtml({...receipt,cells:[[Infinity,1]]}),/Invalid/);
 assert.throws(()=>receiptHtml({...receipt,cells:[['1" onload="alert(1)',1]]}),/Invalid/);
 assert.throws(()=>receiptHtml({...receipt,queueNumber:0}),/Invalid/);
});
