import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium,webkit} from 'playwright-core';
import {campaignSearchPreviewFixture} from './fixtures/campaign-search-preview-ui.mjs';

test('actual search/preview components: roles, refunds, partial media failure, expired status and zero billing',async()=>{
 const fixture=await campaignSearchPreviewFixture();
 const engine=process.env.TEST_BROWSER_ENGINE==='webkit'?'webkit':'chromium';
 let browser;
 try{
  browser=engine==='webkit'?await webkit.launch({headless:true}):await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH,headless:true});
  const out=path.join(process.env.CAMPAIGN_UI_EVIDENCE_DIR??'artifacts/campaign-search-preview',engine,'preview');
  await fs.mkdir(out,{recursive:true});
  for(const width of [320,390,1280]){
   const page=await browser.newPage({viewport:{width,height:900}}),errors=[];
   page.on('pageerror',error=>errors.push(error.message));
   try{
    await page.goto(fixture.url);
    const result=await page.evaluate(()=>window.runCampaignChecks());
    assert.equal(result.ok,true);assert.deepEqual(errors,[],'no browser JS errors');
    await page.screenshot({path:path.join(out,`preview-${width}.png`),fullPage:true});
    await fs.writeFile(path.join(out,`result-${width}.json`),JSON.stringify({...result,width,engine,errors},null,2));
   }finally{await page.close();}
  }
 }finally{await browser?.close();await fixture.close();}
});

test('preview retry denial clears private state and recovery requires newly authorized data',async()=>{
 const fixture=await campaignSearchPreviewFixture();
 const engine=process.env.TEST_BROWSER_ENGINE==='webkit'?'webkit':'chromium';let browser;
 try{
  browser=engine==='webkit'?await webkit.launch({headless:true}):await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH,headless:true});
  const out=path.join(process.env.CAMPAIGN_UI_EVIDENCE_DIR??'artifacts/campaign-search-preview',engine,'preview-permission');await fs.mkdir(out,{recursive:true});
  for(const width of [320,390,1280]){
   const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
   try{
    await page.goto(fixture.url);const result=await page.evaluate(()=>window.runPreviewPermissionChecks());
    assert.equal(result.ok,true);assert.deepEqual(errors,[],'no browser JS errors');
    await page.screenshot({path:path.join(out,`recovered-${width}.png`),fullPage:true});
    await fs.writeFile(path.join(out,`result-${width}.json`),JSON.stringify({...result,width,engine,errors},null,2));
   }catch(error){
    await page.screenshot({path:path.join(out,`failure-${width}.png`),fullPage:true});
    await fs.writeFile(path.join(out,`failure-${width}.json`),JSON.stringify({error:String(error),result:await page.evaluate(()=>window.campaignPermissionResults),width,engine,errors},null,2));throw error;
   }finally{await page.close();}
  }
 }finally{await browser?.close();await fixture.close();}
});
