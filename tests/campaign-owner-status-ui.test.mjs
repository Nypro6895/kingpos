import test from 'node:test';

import assert from 'node:assert/strict';

import fs from 'node:fs/promises';

import path from 'node:path';

import {chromium,webkit} from 'playwright-core';

import {campaignOwnerStatusFixture} from './fixtures/campaign-owner-status-ui.mjs';

test('actual owner workspace exposes reconciliation and keeps only valid period controls',async()=>{

  const fixture=await campaignOwnerStatusFixture(),engine=process.env.TEST_BROWSER_ENGINE==='webkit'?'webkit':'chromium';let browser;

  try{

    browser=engine==='webkit'?await webkit.launch({headless:true}):await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH,headless:true});

    const out=path.join(process.env.CAMPAIGN_UI_EVIDENCE_DIR??'artifacts/campaign-owner-status',engine,'workspace');await fs.mkdir(out,{recursive:true});

    for(const width of [320,390,1280]){

      const page=await browser.newPage({viewport:{width,height:900}}),errors=[],checks=[];page.on('pageerror',error=>errors.push(error.message));

      const article=title=>page.locator('article').filter({has:page.getByRole('heading',{name:title,exact:true})});

      try{

        await page.goto(fixture.url);await page.getByRole('heading',{name:'Expired running',exact:true}).waitFor();

        for(const title of ['Expired running','Expired paused','Expired renewal']){

          assert.ok((await article(title).textContent()).includes(title==='Expired paused'?'Paused · period ended — awaiting reconciliation':'Period ended — awaiting reconciliation'),title+' shows pending reconciliation');

          assert.equal(await article(title).getByRole('button',{name:/^(Pause|Resume)$/,exact:true}).count(),0,title+' has no invalid period action');

          assert.equal(await article(title).getByRole('button',{name:'Settings',exact:true}).count(),1,title+' retains settings and cancellation access');checks.push(title+' pending with valid controls');

        }

        assert.ok((await article('Settled paused').textContent()).includes('Paused · period ended'));

        assert.equal(await article('Settled paused').getByRole('button',{name:'Run again',exact:true}).count(),0,'settled owner pause must not disappear into Run again');

        assert.equal(await article('Settled paused').getByRole('button',{name:'Resume in new period',exact:true}).count(),1);checks.push('owner pause survives settlement with explicit new-period control');

        assert.ok((await article('Scheduled campaign').textContent()).includes('Scheduled'));checks.push('scheduled status visible');

        assert.equal(await article('Current running').getByRole('button',{name:'Pause',exact:true}).count(),1);

        assert.equal(await article('Current paused').getByRole('button',{name:'Resume',exact:true}).count(),1);

        assert.equal(await article('Admin paused').getByRole('button',{name:'Resume',exact:true}).count(),1,'unexpired non-owner pause retains existing Resume');

        assert.deepEqual(await page.evaluate(()=>window.ownerCampaignActions),[],'viewing status causes no mutations');checks.push('current controls retained and initial view nonmutating');

        await page.screenshot({path:path.join(out,`workspace-initial-${width}.png`),fullPage:true});

        await article('Expired running').getByRole('button',{name:'View results →',exact:true}).click();

        assert.ok((await page.locator('dialog').textContent()).includes('Period ended — awaiting reconciliation'));

        await page.getByRole('button',{name:'Settings & credit limit',exact:true}).click();

        assert.equal(await page.getByRole('button',{name:'Cancel this campaign',exact:true}).count(),1);

        assert.equal(await page.locator('dialog input[type="checkbox"]').count(),1,'keep-running setting remains available');

        await page.getByRole('button',{name:'Close dialog',exact:true}).click();checks.push('detail status and settlement recovery retained');

        await article('Expired renewal').getByRole('button',{name:'Settings',exact:true}).click();

        assert.equal(await page.locator('dialog input[type="checkbox"]').isChecked(),true,'existing renewal choice unchanged');

        await page.getByRole('button',{name:'Close dialog',exact:true}).click();checks.push('no pause/auto-renew policy rewrite');

        await article('Current running').getByRole('button',{name:'Pause',exact:true}).click();

        await article('Current running').getByRole('button',{name:'Resume',exact:true}).waitFor();

        await article('Current running').getByRole('button',{name:'Resume',exact:true}).click();

        await article('Current running').getByRole('button',{name:'Pause',exact:true}).waitFor();checks.push('valid pause and resume remain usable');

        await article('Admin paused').getByRole('button',{name:'Resume',exact:true}).click();

        await article('Admin paused').getByRole('button',{name:'Pause',exact:true}).waitFor();

        const adminResume=(await page.evaluate(()=>window.ownerCampaignActions)).at(-1);assert.equal(adminResume.episode,null,'non-owner pause sends no guessed owner episode');assert.equal(adminResume.resumeIntent,'non_owner','non-owner pause requires explicit intent from displayed row');checks.push('unexpired non-owner pause resumes with explicit mode and no invented token');

        const actionsBefore=await page.evaluate(()=>window.ownerCampaignActions.length);

        await article('Settled paused').getByRole('button',{name:'Resume in new period',exact:true}).click();

        await page.getByRole('heading',{name:'Resume in a new period?',exact:true}).waitFor();

        assert.equal(await page.evaluate(()=>window.ownerCampaignActions.length),actionsBefore,'new-period resume needs explicit confirmation');

        const confirmation=await page.locator('dialog').textContent();

        for(const value of ['120','10','600'])assert.ok(confirmation.includes(value),'confirmation includes saved limit, duration and available credits');

        await page.screenshot({path:path.join(out,`workspace-resume-confirmation-${width}.png`),fullPage:true});

        await page.getByRole('button',{name:'Resume campaign',exact:true}).click();

        await article('Settled paused').getByRole('button',{name:'Pause',exact:true}).waitFor();

        assert.equal((await page.evaluate(()=>window.ownerCampaignActions)).at(-1).episode,'33333333-3333-4333-8333-000000000003','resume sends the displayed pause episode');checks.push('new period requires confirmation and snapshot episode');

        await article('Expired paused').getByRole('button',{name:'Settings',exact:true}).click();

        await page.getByRole('button',{name:'Cancel this campaign',exact:true}).click();

        await page.getByRole('button',{name:'Cancel campaign',exact:true}).click();

        await article('Expired paused').waitFor({state:'detached'});checks.push('explicit cancel recovery remains usable');

        await page.getByRole('button',{name:'History',exact:true}).click();

        assert.ok((await article('Expired running').textContent()).includes('Period ended — awaiting reconciliation'));

        assert.equal(await article('Expired running').getByRole('button',{name:/^(Pause|Resume)$/,exact:true}).count(),0);

        assert.equal(await article('Expired paused').getByRole('button',{name:'Run again',exact:true}).count(),1,'settled terminal campaign retains Run again');checks.push('history reflects pending versus terminal status');

        const actions=await page.evaluate(()=>window.ownerCampaignActions);assert.deepEqual(actions.map(({id,action})=>({id,action})),[{id:'current-running',action:'pause'},{id:'current-running',action:'resume'},{id:'admin-paused',action:'resume'},{id:'settled-paused',action:'resume'},{id:'expired-paused',action:'cancel'}]);assert.equal(actions[1].episode,'33333333-3333-4333-8333-000000000004','same-period resume keeps the current pause episode');

        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'workspace has no horizontal overflow');assert.deepEqual(errors,[]);

        await page.screenshot({path:path.join(out,`workspace-${width}.png`),fullPage:true});

        await fs.writeFile(path.join(out,`result-${width}.json`),JSON.stringify({ok:true,width,engine,checks,errors,scope:'Actual workspace/modal; synthetic campaign rows and mocked server actions, no production'},null,2));

      }finally{await page.close();}

    }

  }finally{await browser?.close();await fixture.close();}

});

