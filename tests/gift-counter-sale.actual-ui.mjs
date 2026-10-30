import {chromium} from 'playwright-core';
import fs from 'node:fs';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
const out=process.env.REWARD_UI_OUTPUT,db=process.env.REWARD_TEST_DB;
assert.ok(out);assert.match(db||'',/^reward-browser-[a-z0-9]+-db$/);
const fixture=await fetch('http://127.0.0.1:4078/fixture').then(r=>r.json());assert.equal(fixture.dbName,db);
const docker='C:/Program Files/Docker/Docker/resources/bin/docker.exe';
const meta=JSON.parse(execFileSync(docker,['--context','desktop-linux','inspect',db],{encoding:'utf8'}))[0];assert.equal(meta.HostConfig.NetworkMode,'none');assert.ok(meta.Config.Labels['com.codex.task']);
const sql=text=>execFileSync(docker,['--context','desktop-linux','exec','-i',db,'psql','-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1'],{input:text,encoding:'utf8'}).trim();
const salon=sql(`select location_id from customers where id='${fixture.receipt.customerId}'`);assert.match(salon,/^[a-f0-9-]{36}$/);
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true}),context=await browser.newContext({viewport:{width:1440,height:950}}),page=await context.newPage(),errors=[];
page.setDefaultTimeout(45000);page.on('pageerror',error=>errors.push(error.message));
async function addGift(){await page.locator('.owner-tools').getByRole('button',{name:/Reward|Gift card/i}).last().click();await page.locator('[data-gift-pos]').getByRole('button').first().click();await page.getByRole('button',{name:'Buy gift card',exact:true}).click();await page.getByRole('button',{name:'Add $100 to purchase',exact:true}).click();await page.getByText('$100.00 requested.',{exact:false}).waitFor();await page.getByRole('button',{name:'Close gift card',exact:true}).click();await page.locator('dialog[open]').getByRole('button',{name:'Done',exact:true}).click();}
async function waitSales(count){for(let i=0;i<40;i++){if(Number(sql(`select count(*) from gift_card_counter_sales where salon_id='${salon}'`))===count)return;await new Promise(resolve=>setTimeout(resolve,300));}throw Error('Gift sale was not saved');}
try{
 await page.request.get('http://localhost:4079/login-fixture?role=owner',{maxRedirects:0});await page.goto('http://localhost:4084/pos',{timeout:120000});
 await page.getByRole('button',{name:/Manicure.*60/}).click();const picker=page.locator('dialog[open]');if(await picker.count())await picker.getByRole('button',{name:'No staff assignment',exact:true}).click();
 await addGift();await page.locator('[data-owner-gift-summary]').first().getByText('$160.00',{exact:true}).waitFor();
 const bounds=await page.locator('.owner-receipt [data-owner-gift-summary]').evaluate(node=>{const amount=node.querySelector('.owner-total strong').getBoundingClientRect(),receipt=node.closest('.owner-receipt').getBoundingClientRect();return{amountRight:amount.right,receiptRight:receipt.right};});assert.ok(bounds.amountRight<=bounds.receiptRight,'Gift amount due must fit inside receipt');
 await page.screenshot({path:out+'/gift-mixed-purchase.png',fullPage:true});
 const before=Number(sql(`select count(*) from gift_card_counter_sales where salon_id='${salon}'`));await page.getByRole('button',{name:'Submit',exact:true}).click();await waitSales(before+1);
 const mixed=JSON.parse(sql(`select json_build_object('amount',s.amount_cents,'payment',(select sum(amount) from pos_payments where ticket_id=s.service_ticket_id),'tip',(select tip_value from pos_tickets where id=s.service_ticket_id)) from gift_card_counter_sales s where salon_id='${salon}' order by created_at desc limit 1`));assert.equal(mixed.amount,10000);assert.equal(Number(mixed.payment),60);assert.equal(Number(mixed.tip),0);
 await addGift();await page.locator('[data-owner-gift-summary]').first().getByText('$100.00',{exact:true}).waitFor();await page.screenshot({path:out+'/gift-only-purchase.png',fullPage:true});
 const tickets=Number(sql(`select count(*) from pos_tickets where salon_id='${salon}'`));await page.getByRole('button',{name:'Submit',exact:true}).click();await waitSales(before+2);assert.equal(Number(sql(`select count(*) from pos_tickets where salon_id='${salon}'`)),tickets);
 assert.deepEqual(errors,[]);fs.writeFileSync(out+'/gift-sale-actual-ui-result.json',JSON.stringify({passed:true,mixedAmountDue:160,servicePayment:60,giftPurchase:100,giftOnlyAmountDue:100,giftOnlyCreatesServiceTicket:false,existingSubmitOnly:true,browserErrors:errors},null,2));console.log('PASS actual mixed and Gift-only sale through existing Owner POS Submit.');
}catch(error){await page.screenshot({path:out+'/gift-sale-failed.png',fullPage:true});console.log((await page.locator('body').innerText()).slice(-2000));throw error;}finally{await browser.close();}
