import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const folder='artifacts/review-experience-flow-20261029/';
const origin=fs.readFileSync(folder+'https-origin.txt','utf8').trim(),key=fs.readFileSync(folder+'qa-entry-key.txt','utf8').trim();
const login=(role,next)=>`${origin}/__review-qa-login?key=${key}&as=${role}&next=${encodeURIComponent(next)}`;
const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(60000);
const checks=[];
try{
 await page.goto(login('owner','/salon-profile#customer-experiences'));
 const textarea=page.getByLabel('Reply as the salon',{exact:true});await textarea.fill('QA reply draft survives a network failure.');
 const replyRoute=`${origin}/salon-profile*`;
 const fail=route=>route.request().method()==='POST'?route.abort('failed'):route.continue();
 await page.route(replyRoute,fail);await page.getByRole('button',{name:'Reply',exact:true}).click();
 await page.getByText('Your reply could not be saved. Your draft is still here. Please try again.',{exact:true}).waitFor();assert.equal(await textarea.inputValue(),'QA reply draft survives a network failure.');checks.push('Owner reply network failure preserves draft and shows an actionable error');
 await page.unroute(replyRoute,fail);await page.getByRole('button',{name:'Reply',exact:true}).click();await page.getByText('QA reply draft survives a network failure.',{exact:true}).waitFor();checks.push('Retry posts the preserved owner reply');
 await page.goto(login('customer','/more/reviews'));
 const card=page.locator('article').filter({hasText:'QA network draft fixture'});await card.getByRole('button',{name:'Issue shared',exact:true}).click();await card.getByRole('button',{name:'Edit my feedback',exact:true}).click();
 await card.getByLabel('Optional details',{exact:true}).fill('QA customer edit survives network failure.');
 const editRoute=`${origin}/more/reviews*`;await page.route(editRoute,fail);await card.getByRole('button',{name:'Save feedback',exact:true}).click();
 await card.getByText('Feedback could not be saved. Your draft is still here. Please try again.',{exact:true}).waitFor();assert.equal(await card.getByLabel('Optional details',{exact:true}).inputValue(),'QA customer edit survives network failure.');checks.push('Customer edit network failure preserves draft');
 await page.unroute(editRoute,fail);await card.getByRole('button',{name:'Cancel',exact:true}).click();await page.reload();await page.getByText('QA network draft fixture',{exact:true}).first().waitFor();checks.push('Cancel after failed edit preserves the stored customer review');
 fs.writeFileSync(folder+'browser/resilience-results.json',JSON.stringify({checks},null,2));console.log(JSON.stringify({checks},null,2));
}catch(error){fs.writeFileSync(folder+'browser/resilience-failure.json',JSON.stringify({checks,message:error.message,text:await page.locator('body').innerText().catch(()=>'' )},null,2));throw error;}finally{await browser.close();}
