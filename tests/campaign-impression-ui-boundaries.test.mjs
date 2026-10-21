import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {campaignFixture} from './fixtures/campaign-progressive-ui.mjs';

test('actual UI: early click, hidden card, uncertain response and late old-scope claim cannot earn duplicate views',async()=>{
 const fixture=await campaignFixture(),browser=await chromium.launch({headless:true,executablePath:process.env.TEST_BROWSER_PATH});
 try{
  const page=await browser.newPage({viewport:{width:390,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(fixture.url);
  await page.waitForFunction(()=>window.setCampaignFixture);
  const mode=async(value,role='Guest')=>{await page.evaluate(({value,role})=>window.setCampaignFixture({mode:value,role,visible:true}),{value,role});await page.getByRole('heading',{name:value+' salon',exact:true}).waitFor()};
  const count=(value,kind)=>page.evaluate(({value,kind})=>window.campaignRequests.filter(x=>x.body.kind===kind&&x.body.ticket===value+'-'+value+' salon').length,{value,kind});
  await mode('early');await page.getByRole('link',{name:'Discover this post →'}).click();
  assert.equal(await count('early','click'),0,'early navigation does not record an unearned click/view');
  await page.waitForTimeout(1300);assert.equal(await count('early','view'),1);
  await page.getByRole('link',{name:'Discover this post →'}).click();assert.equal(await count('early','click'),1);
  await page.evaluate(()=>{document.dispatchEvent(new Event('visibilitychange'));document.dispatchEvent(new Event('visibilitychange'))});
  await page.waitForTimeout(1100);assert.equal(await count('early','view'),1,'visibility notifications cannot duplicate a claim');
  await mode('hide');await page.getByRole('button',{name:'Hide sponsored post'}).click();await page.waitForTimeout(1200);assert.equal(await count('hide','view'),0);
  await page.evaluate(()=>document.getElementById('root').style.marginTop='2000px');await mode('offscreen');await page.waitForTimeout(1200);assert.equal(await count('offscreen','view'),0);
  await page.evaluate(()=>document.getElementById('root').style.marginTop='0');await page.waitForTimeout(1300);assert.equal(await count('offscreen','view'),1);
  await mode('uncertain');await page.getByRole('heading',{name:'uncertain salon'}).waitFor({state:'detached'});
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await page.waitForTimeout(1300);assert.equal(await count('uncertain','view'),1,'uncertain claim never retried automatically');
  await mode('claim-delayed');await page.waitForFunction(()=>window.campaignRequests.some(x=>x.body.kind==='view'&&x.body.ticket.startsWith('claim-delayed')));
  await mode('replacement','Personal');await page.waitForTimeout(800);
  assert.equal(await page.getByRole('heading',{name:'claim-delayed salon'}).count(),0,'late old-scope claim cannot revive old card');
  const before=await page.evaluate(()=>window.campaignRequests.filter(x=>x.body.kind==='select').length);
  await mode('replacement','Personal');assert.equal(await page.evaluate(()=>window.campaignRequests.filter(x=>x.body.kind==='select').length),before,'unchanged scope does not add a new delivery request');
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await fixture.close()}
});
