import {chromium} from 'playwright-core';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const b=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const app=process.env.REWARD_APP_ORIGIN||'http://localhost:4084';const out=process.env.REWARD_UI_OUTPUT||'artifacts/rewardlumi/browser',errors=[];fs.mkdirSync(out,{recursive:true});let ownerPage,customerPage;
try {
 const owner=await b.newContext({viewport:{width:1440,height:950}}),customer=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const p=await owner.newPage(),c=await customer.newPage();ownerPage=p;customerPage=c;for(const page of [p,c]){page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(e.message));page.on('response',async r=>{if(r.url().endsWith('/api/rewards')&&r.status()>=400)console.log('API ERROR',await r.text());});}
 await p.request.get('http://localhost:4079/login-fixture?role=owner',{maxRedirects:0});await p.goto(app+'/reward-system',{timeout:120000});await p.waitForFunction(()=>[...document.querySelectorAll('button')].some(e=>e.textContent==='Confirm & save'&&!e.disabled),null,{timeout:120000});
 await p.screenshot({path:out+'/app-owner-loaded.png',fullPage:true});console.log('Owner loaded');
 await c.request.get('http://localhost:4079/login-fixture?role=personal',{maxRedirects:0});const f=await fetch('http://localhost:4078/fixture').then(r=>r.json());f.visitId=process.env.REWARD_TEST_VISIT||f.visitId;await c.goto(app+'/qr?visit='+f.visitId,{timeout:120000});await c.request.post(app+'/api/rewards',{data:{scope:'personal',op:'cancel',args:{visitId:f.visitId}}});await c.getByRole('button',{name:'Use reward',exact:true}).waitFor();
 await c.screenshot({path:out+'/app-personal-visit.png',fullPage:true});console.log('Personal visit loaded');
 await c.getByRole('button',{name:'Use reward',exact:true}).click();await c.getByRole('button',{name:'Confirm 100 points',exact:true}).click();
 await p.goto(app+'/pos',{timeout:120000});await p.locator('.owner-tools .owner-customer-shortcut:not(.owner-ios-control)').first().click();await p.getByRole('textbox',{name:'Search customers'}).fill('Sophia');await p.getByRole('button',{name:/Sophia Lee/}).click();
 await p.getByRole('button',{name:/Manicure.*60/}).click();
 const dialog=p.locator('dialog[open]');if(await dialog.count())await dialog.getByRole('button',{name:'No staff assignment',exact:true}).click();
 await p.getByRole('button',{name:'✓ Reward confirmed',exact:true}).waitFor();
 await p.screenshot({path:out+'/app-pos-reward-ready.png',fullPage:true});console.log('POS reward confirmed');
 await p.getByRole('button',{name:'✓ Reward confirmed',exact:true}).click();
 await p.screenshot({path:out+'/app-pos-benefits.png',fullPage:true});
 await c.bringToFront();await c.getByText('Confirmed · applied when this ticket is paid',{exact:false}).waitFor();
 await c.getByRole('button',{name:'Use gift card',exact:true}).click();await c.getByRole('button',{name:'Use up to $55.00',exact:true}).first().click();
 await c.getByText('$55.00 gift card authorized for this ticket.',{exact:true}).waitFor();await c.screenshot({path:out+'/app-personal-gift-authorized.png',fullPage:true});
 await p.bringToFront();await p.locator('[data-gift-pos]').getByText('−$55.00',{exact:true}).waitFor();await p.locator('[data-gift-pos]').getByRole('button').first().click();await p.getByRole('dialog',{name:'Gift card',exact:true}).waitFor();await p.screenshot({path:out+'/app-pos-gift-modal.png',fullPage:true});await p.getByRole('button',{name:'Close gift card',exact:true}).click();
 await p.locator('dialog[open]').getByRole('button',{name:'Done',exact:true}).click();await p.locator('[data-owner-gift-summary]').getByText('Amount due',{exact:true}).first().waitFor();await p.screenshot({path:out+'/app-pos-gift-due.png',fullPage:true});
 await p.evaluate(()=>{const original=Storage.prototype.setItem;window.__restoreQaStorage=()=>{Storage.prototype.setItem=original;};Storage.prototype.setItem=function(key,value){if(key.startsWith('kingpos:owner-cart:'))throw new DOMException('Synthetic QA quota failure','QuotaExceededError');return original.call(this,key,value);};});
 await p.locator('.owner-tools .owner-customer-shortcut:not(.owner-ios-control)').first().click();await p.getByRole('textbox',{name:'Search customers'}).fill('Synthetic');await p.getByRole('button',{name:/Synthetic report guest/}).click();
 await p.getByText('Unable to save on this device. Keep this ticket open.',{exact:true}).waitFor();await p.locator('.owner-tools').getByRole('button',{name:'Sophia Lee',exact:true}).waitFor();
 await p.evaluate(()=>window.__restoreQaStorage());await p.getByRole('button',{name:'Submit',exact:true}).click();
 await c.getByText('Visit completed. This visit QR is no longer active.',{exact:true}).waitFor();await c.screenshot({path:out+'/app-personal-paid.png',fullPage:true});await p.screenshot({path:out+'/app-pos-after-payment.png',fullPage:true});
 assert.equal(await c.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.deepEqual(errors,[]);
 const db=process.env.REWARD_TEST_DB,docker=process.env.REWARD_TEST_DOCKER||'C:/Program Files/Docker/Docker/resources/bin/docker.exe';
 assert.match(db||'',/^reward-browser-[a-z0-9]+-db$/);assert.match(f.visitId,/^[a-f0-9-]{36}$/);
 const meta=JSON.parse(execFileSync(docker,['--context','desktop-linux','inspect',db],{encoding:'utf8'}))[0];assert.ok(meta.Config.Labels['com.codex.task']);assert.equal(meta.HostConfig.NetworkMode,'none');
 const sql=`select jsonb_build_object('status',r.status,'giftCents',coalesce((select sum(-delta) from gift_card_ledger where ticket_id=r.ticket_id and kind='redeem'),0),'rewardDebit',coalesce((select sum(delta) from reward_ledger where ticket_id=r.ticket_id and event_key like 'redeem:%'),0),'payments',(select jsonb_agg(jsonb_build_object('method',payment_method,'amount',amount)) from pos_payments where ticket_id=r.ticket_id)) from reward_requests r where visit_id='${f.visitId}';`;
 const ledger=JSON.parse(execFileSync(docker,['--context','desktop-linux','exec','-i',db,'psql','-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8'}));
 fs.writeFileSync(out+'/actual-app-ledger.json',JSON.stringify(ledger,null,2));assert.equal(ledger.status,'redeemed');assert.equal(Number(ledger.giftCents),5500);assert.equal(Number(ledger.rewardDebit),-100);
 assert.deepEqual(ledger.payments,[{method:'other',amount:55}],'Gift must preserve canonical payment facts, not write a gift tender row');
 const cid=f.receipt.customerId;assert.match(cid,/^[a-f0-9-]{36}$/);
 const countTickets=()=>Number(execFileSync(docker,['--context','desktop-linux','exec','-i',db,'psql','-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1'],{input:`select count(*) from pos_tickets where customer_id='${cid}' and status='closed';`,encoding:'utf8'}));const beforeSecond=countTickets();
 await p.locator('.owner-tools .owner-customer-shortcut:not(.owner-ios-control)').first().click();await p.getByRole('textbox',{name:'Search customers'}).fill('Sophia');await p.getByRole('button',{name:/Sophia Lee/}).click();await p.getByRole('button',{name:/Manicure.*60/}).click();
 const nextDialog=p.locator('dialog[open]');if(await nextDialog.count())await nextDialog.getByRole('button',{name:'No staff assignment',exact:true}).click();
 await p.getByRole('button',{name:'Submit',exact:true}).click();
 let ticketCount=0;
 for(let i=0;i<30;i++){
  ticketCount=countTickets();
  if(ticketCount===beforeSecond+1)break;await new Promise(resolve=>setTimeout(resolve,500));
 }
 assert.equal(ticketCount,beforeSecond+1,'a new cart must create its own receipt rather than reuse the completed Gift callback');
 assert.equal(Number(execFileSync(docker,['--context','desktop-linux','exec','-i',db,'psql','-U','postgres','-d','postgres','-At'],{input:`select count(*) from gift_card_ledger l join reward_requests r on r.ticket_id=l.ticket_id where r.visit_id='${f.visitId}' and l.kind='redeem';`,encoding:'utf8'})),1);
 fs.writeFileSync(out+'/actual-app-result.json',JSON.stringify({passed:true,checks:['real Owner POS','real personal check-in','customer consent once','reward reflected in POS total','gift chosen with existing check-in, no second scan','nested gift dialog usable','atomic Submit and visit paid','database confirms -100 points and Gift reduction $55; canonical payment facts unchanged','next cart creates its own receipt without another Gift debit','no browser errors'],errors,ledger,isolatedDatabase:true},null,2));console.log('PASS: actual Next app personal + Owner POS reward/gift checkout; database confirms gift debit and reward debit.');
}catch(e){for(const [name,page]of [['owner',ownerPage],['personal',customerPage]])if(page){console.log('FAILED '+name+' '+page.url(),(await page.locator('body').innerText()).slice(-1800));await page.screenshot({path:out+'/failed-'+name+'.png',fullPage:true});}throw e;}finally{await b.close();}
