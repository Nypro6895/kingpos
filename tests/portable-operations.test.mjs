import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { createHash, generateKeyPairSync, pbkdf2Sync, privateDecrypt, constants } from 'node:crypto';

test('durable tickets: offline burst, reload, retry identity, PIN sealing and scope isolation', {
  skip: !process.env.ESBUILD_MODULE_PATH || !process.env.TEST_BROWSER_PATH, timeout: 60000,
}, async () => {
  const { build } = await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
  const repo = resolve('.').replaceAll('\\','/');
  const bundle = await build({ stdin: { contents: `import {portableBookingTime} from '${repo}/lib/portable-booking-time'; window.bookingTime=portableBookingTime; import * as ops from '${repo}/lib/portable-operations'; import * as staff from '${repo}/lib/portable-offline-staff'; import * as transport from '${repo}/lib/pos-local-display'; import {mergePortableStaff} from '${repo}/app/pos/portable/portable-workspace-state'; window.mergeStaff=mergePortableStaff; window.transport=transport; window.ops=ops; window.staff=staff;`, resolveDir: repo }, bundle:true, write:false, platform:'browser' });
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength:2048 });
  const digest = createHash('sha256').update('salon:staff:1234:salt').digest('hex');
  const staffBundle = { scope:'salon:key',salonId:'salon',expiresAt:Date.now()+3600000,
    publicKey:publicKey.export({type:'spki',format:'der'}).toString('base64'),
    staff:[{id:'staff',salt:'salt',verifierSalt:'salt2',verifier:pbkdf2Sync(digest,'salt2',100000,32,'sha256').toString('hex')}] };
  let available = false;
  const received = [], committed = new Set();
  let lostReply = true;
  const server = createServer(async (req,res) => {
    if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
    if(req.url==='/api/pos/portable/offline-staff'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(staffBundle));return;}
    if(req.url==='/api/pos/portable/operations'){
      if(!available){res.statusCode=503;res.end('{}');return;}
      let body='';for await(const chunk of req) body+=chunk;
      const op=JSON.parse(body); received.push(op.id); committed.add(op.id);
      if(lostReply){lostReply=false;res.destroy();return;}
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({kind:'ok',data:{ticketId:op.id}}));return;
    }
    res.setHeader('Content-Type','text/html');res.end('<script src="/bundle.js"></script>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH,headless:true});
  try {
    const context=await browser.newContext();const page=await context.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    assert.equal(await page.evaluate(()=>window.bookingTime('2026-09-23T09:00','America/Chicago')),'2026-09-23T14:00:00.000Z');
    assert.equal(await page.evaluate(()=>window.bookingTime('2026-03-08T02:30','America/Chicago')),null);
    const merged = await page.evaluate(() => window.mergeStaff([], {businessDate:'2026-09-23',preparedDay:'2026-09-23',timezone:'America/Chicago',staffRoster:[{id:'new',today_status:'not_checked_in',turns:{queueTurns:0}}],attendanceByStaffId:{new:{status:'working',checkInAt:'2026-09-23T18:00:00Z',queueTurnCount:2}}}));
    assert.equal(merged.length,1);assert.equal(merged[0].today_status,'working');assert.equal(merged[0].turns.queueTurns,2);
    await page.evaluate(()=>window.staff.prepareOfflineStaff('salon:key'));
    await context.setOffline(true);
    await assert.rejects(page.evaluate(()=>window.staff.verifyAndSealStaffPasscode('salon:key','staff','9999')),/Incorrect staff PIN/);
    const sealed=await page.evaluate(()=>window.staff.verifyAndSealStaffPasscode('salon:key','staff','1234'));
    assert.equal(privateDecrypt({key:privateKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(sealed,'base64')).toString(),'1234');
    await page.evaluate(async()=>{
      for(let n=1;n<=3;n++) await window.ops.savePortableOperation('salon:key','receipt',{total:n*10,localDraftKey:'draft-a'});
    });
    const original=await page.evaluate(()=>window.ops.listPortableOperations('salon:key'));
    assert.equal(original.length,3);assert.equal(received.length,0);
    assert.ok(await page.evaluate(()=>window.ops.portableCheckpoint('salon:key','draft-a')));
    assert.equal(await page.evaluate(()=>window.ops.portableCheckpoint('salon:key','different-tab')),0);
    await context.setOffline(false);await page.reload();
    assert.deepEqual((await page.evaluate(()=>window.ops.listPortableOperations('salon:key'))).map(op=>op.id),original.map(op=>op.id));
    assert.equal((await page.evaluate(()=>window.ops.listPortableOperations('other:key'))).length,0);
    available=true;
    await page.evaluate(()=>window.ops.syncPortableOperations('salon:key'));
    await page.evaluate(()=>window.ops.syncPortableOperations('salon:key'));
    assert.deepEqual(received,[original[0].id,original[0].id,original[1].id,original[2].id]);
    assert.equal(committed.size,3);
    assert.ok((await page.evaluate(()=>window.ops.listPortableOperations('salon:key'))).every(op=>op.state==='synced'));
    const display = await context.newPage(); await display.goto(`http://127.0.0.1:${server.address().port}`);
    await display.evaluate(() => window.transport.connectLocalReceipt('display-token', { preview: value => window.preview = value }));
    await page.evaluate(() => {
      window.transport.connectLocalReceipt('display-token', { tip: request => request.cartId === 'cart-a' && request.revision === 'revision-a', customer: request => request.cartId === 'cart-a' && request.revision === 'revision-a', dismissCompleted: cartId => window.dismissedCart = cartId }).publish({ cartId:'cart-a',revision:'revision-a',payload:{token:'display-token',staffLines:[],subtotal:50,total:50,totalBeforeTip:50,tax:0,discount:0,tip:0} });
    });
    await display.waitForFunction(() => window.preview?.cartId === 'cart-a');
    await context.setOffline(true);
    assert.equal(await display.evaluate(()=>window.transport.requestLocalReceiptTip('display-token',window.preview,10)),true);
    assert.equal(await display.evaluate(()=>window.transport.requestLocalReceiptTip('display-token',{...window.preview,revision:'old'},10)),false);
    assert.equal(await display.evaluate(()=>window.transport.requestLocalReceiptCustomer('display-token',window.preview,{id:'customer-a',name:'Maya',phone:'5551234567'})),true);
    assert.equal(await display.evaluate(()=>window.transport.requestLocalReceiptCustomer('display-token',{...window.preview,cartId:'old-cart'},{id:'customer-a',name:'Maya'})),false);
    const lifecycle=await display.evaluate(()=>{
      const base={status:'draft',completed_at:null,reset_at:null,customer_handoff_started_at:'old'};
      const closed=window.transport.localReceiptSnapshot(base,{...window.preview,completedAt:'2026-09-23T18:00:00Z',resetAt:'2026-09-23T18:00:30Z'});
      const empty=window.transport.localReceiptSnapshot(closed,{...window.preview,payload:{...window.preview.payload,staffLines:[],subtotal:0,total:0,totalBeforeTip:0}});
      return {closed,empty,initial:window.transport.localReceiptSnapshot(null,window.preview)};
    });
    assert.equal(lifecycle.initial.total,50);assert.equal(lifecycle.initial.token,'display-token');
    assert.equal(lifecycle.closed.status,'closed');assert.equal(lifecycle.closed.total,50);
    assert.equal(lifecycle.empty.status,'draft');assert.equal(lifecycle.empty.completed_at,null);assert.equal(lifecycle.empty.customer_handoff_started_at,null);
    await display.evaluate(()=>window.transport.dismissLocalReceipt('display-token','cart-a'));
    await page.waitForFunction(()=>window.dismissedCart==='cart-a');
    // A storage failure must reject, allowing the real form to retain its cart.
    await page.evaluate(()=>{IDBObjectStore.prototype.add=()=>{throw new DOMException('Full','QuotaExceededError');};});
    await assert.rejects(page.evaluate(()=>window.ops.savePortableOperation('salon:key','receipt',{total:40})),/Full/);
  } finally { await browser.close();await new Promise(resolve=>server.close(resolve)); }
});
