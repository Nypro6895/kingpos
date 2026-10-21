import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright-core';
import {campaignFixture} from './fixtures/campaign-progressive-ui.mjs';
test('progressive campaign slots, races, failure fallback and mocked scope transitions',async()=>{
 const fixture=await campaignFixture();const browser=await chromium.launch({headless:true,executablePath:process.env.TEST_BROWSER_PATH});
 fs.mkdirSync('artifacts/campaign-isolated-20261021',{recursive:true});
 try{for(const width of [320,390,1280]){
  const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(fixture.url);await page.getByRole('heading',{name:'Fast salon',exact:true}).waitFor();
  await page.screenshot({path:`artifacts/campaign-isolated-20261021/loading-${width}.png`});
  const result=await page.evaluate(()=>window.runCampaignChecks());assert.equal(result.passed,true);assert.deepEqual(errors,[]);
  fs.writeFileSync(`artifacts/campaign-isolated-20261021/results-${width}.json`,JSON.stringify(result,null,2));
  await page.screenshot({path:`artifacts/campaign-isolated-20261021/complete-${width}.png`});await page.close();
 }}finally{await browser.close();await fixture.close()}
});
