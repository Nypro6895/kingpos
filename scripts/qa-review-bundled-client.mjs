import fs from 'node:fs';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const folder='artifacts/review-experience-flow-20261029/',origin=fs.readFileSync(folder+'https-origin.txt','utf8').trim(),key=fs.readFileSync(folder+'qa-entry-key.txt','utf8').trim();
const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(20000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(`${origin}/__review-qa-login?key=${key}&native=1&as=customer&next=/more/reviews`);
 await page.getByRole('heading',{name:'My Reviews',exact:true}).waitFor();
 await page.getByText('QA iPhone salon reply: we can help arrange a repair.',{exact:true}).waitFor();
 const card=page.locator('article').filter({hasText:'QA iPhone salon reply: we can help arrange a repair.'});
 await card.getByRole('button',{name:'Issue shared',exact:true}).click();await card.getByRole('button',{name:'Edit my feedback',exact:true}).click();await card.getByLabel('Optional details',{exact:true}).fill('QA bundled client refresh completed.');const saved=page.waitForResponse(r=>r.url().includes('/api/app-local/command')&&r.request().method()==='POST');await card.getByRole('button',{name:'Save feedback',exact:true}).click();assert.equal((await saved).status(),200);console.log('Pinned command completed');
 
 await card.getByLabel("Optional details",{exact:true}).waitFor({state:"hidden"});
 await card.locator(":scope > p").filter({hasText:"QA bundled client refresh completed."}).waitFor();
 await page.reload({waitUntil:"domcontentloaded"});await page.getByText('QA bundled client refresh completed.',{exact:true}).first().waitFor();
 assert.deepEqual(errors,[]);await page.screenshot({path:folder+'browser/bundled-client.png',fullPage:true});fs.writeFileSync(folder+'browser/bundled-client-results.json',JSON.stringify({ownReviews:true,salonReply:true,pinnedCustomerEdit:true,reloadPersists:true,errors},null,2));console.log('Bundled client: own reviews, salon reply and pinned edit/reload passed.');
}catch(error){fs.writeFileSync(folder+'browser/bundled-client-failure.json',JSON.stringify({message:error.message,text:await page.locator('body').innerText().catch(()=>''),errors},null,2));throw error;}finally{await browser.close();}
