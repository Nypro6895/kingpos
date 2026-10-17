import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { taxCompanyPreview } from './fixtures/tax-company-preview.mjs';

test('Tax workspace: compact rows, salon calendars, private notes and named owner connections on desktop/mobile', {timeout:120000}, async()=>{
 const server=await taxCompanyPreview();
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({channel:'chrome',headless:true});
 const output='artifacts/tax-company-refinement-qa';fs.mkdirSync(output,{recursive:true});
 try {
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const width of [1440,390]) {
  await page.setViewportSize({width,height:900});await page.goto(base);
  await page.getByRole('heading',{name:'My salons · 2'}).waitFor();
  assert.equal(await page.getByRole('link',{name:'Open salon',exact:true}).count(),1);
  assert.match(await page.getByRole('list',{name:'Connected salons'}).innerText(),/123 Main Street/);
  await page.getByText('+ Connect another salon',{exact:true}).click();
  await page.getByLabel('Salon ID',{exact:true}).fill('TAX-TEST');await page.getByLabel('Salon password').fill('salon-password-123');await page.getByRole('button',{name:'Add salon',exact:true}).click();
  await page.waitForFunction(()=>window.connected?.login_id==='TAX-TEST');
  await page.getByRole('button',{name:'Sign out Lumi Nail Studio'}).click();await page.waitForFunction(()=>window.disconnected?.salon_id==='salon-one');
  await page.getByText('+ Connect another salon',{exact:true}).click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:`${output}/salons-${width}.png`,fullPage:true});

  await page.goto(base+'?mode=settings');await page.locator('summary').filter({hasText:'People with tax access'}).click();
  await page.locator('summary').filter({hasText:'Salon login'}).click();
  assert.equal(await page.getByText('Taylor Nguyen',{exact:true}).count(),1);assert.equal(await page.getByText('taylor@example.test',{exact:true}).count(),1);
  assert.equal(await page.getByText('$7.90').count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:`${output}/settings-${width}.png`,fullPage:true});
  await page.getByRole('button',{name:'Change password',exact:true}).click();await page.getByLabel('New password',{exact:true}).fill('new-password-123');await page.getByRole('button',{name:'Save new password'}).click();await page.waitForFunction(()=>window.settings?.password==='new-password-123');
  await page.getByRole('button',{name:'Disconnect all accounts'}).click();await page.waitForFunction(()=>window.settings?.disconnect==='true');

  await page.goto(base+'?mode=settings&inactive=1');
  await page.getByRole('switch',{name:'Connect your tax company'}).waitFor();
  assert.equal(await page.getByRole('link',{name:'Open Market',exact:true}).count(),0);
  assert.equal(await page.getByLabel('Salon ID',{exact:true}).count(),0);
  await page.getByRole('switch',{name:'Connect your tax company'}).click();
  await page.getByRole('dialog',{name:'Tax Company',exact:true}).waitFor();
  assert.equal(await page.getByRole('link',{name:'Open Market',exact:true}).getAttribute('href'),'/market?q=Tax%20Company');
  assert.equal(await page.evaluate(()=>window.settings),undefined);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:`${output}/inactive-settings-${width}.png`,fullPage:true});
  await page.goto(base+'?mode=settings&inactive=1&expired=1');
  await page.locator('summary').filter({hasText:'People with tax access'}).click();
  await page.getByRole('button',{name:'Disconnect all accounts'}).click();
  await page.waitForFunction(()=>window.settings?.disconnect==='true');
  assert.equal(await page.getByRole('link',{name:'View tax report →',exact:true}).count(),1);

  await page.goto(base+'?mode=salon');await page.getByRole('heading',{name:'Lumi Nail Studio',exact:true}).waitFor();
  assert.equal(await page.getByRole('combobox',{name:/^Pay period/}).locator('option').count(),2);
  const anna=page.getByRole(width<1024?'article':'row').filter({hasText:'Anna Smith'});
  assert.equal(await anna.getByRole('link',{name:'Download paystub for Anna',exact:true}).count(),1);
  assert.equal(await anna.getByRole('button',{name:'✓ Uploaded',exact:true}).count(),1);
  assert.equal(await page.getByRole('link',{name:/Download paystub for/}).count(),3);
  const annaBox=await anna.boundingBox(),downloadBox=await anna.getByRole('link').boundingBox();
  assert.ok(downloadBox.y>=annaBox.y && downloadBox.y+downloadBox.height<=annaBox.y+annaBox.height,'download stays in employee row');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:`${output}/report-${width}.png`,fullPage:true});
  await page.getByRole(width<1024?'article':'row').filter({hasText:'Sophia Le'}).locator('input[type=file]').setInputFiles({name:'paystub.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 sample')});
  await page.waitForFunction(()=>window.uploaded?.staff_id==='staff-3' && window.uploaded?.tax_salon_id==='salon-one' && window.uploaded?.payroll_run_id==='run-one');
  await page.getByRole('button',{name:'Edit',exact:true}).click();await page.getByLabel('Notes for this salon').fill('Updated reminder');
  await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByText('Saved',{exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.noteRequest),{salonId:'salon-one',content:'Updated reminder',version:1});
  await page.getByRole('button',{name:'Edit',exact:true}).click();await page.getByLabel('Notes for this salon').fill('Keep this draft on failure');await page.evaluate(()=>window.noteFailure=true);
  await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByText('Connection lost. Please try again.').waitFor();
  assert.equal(await page.getByLabel('Notes for this salon').inputValue(),'Keep this draft on failure');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByText('Updated reminder',{exact:true}).waitFor();
  await page.getByRole('combobox',{name:/^Pay period/}).selectOption('2026-09-01:2026-09-15');await page.waitForFunction(()=>window.navigated?.includes('2026-09-01%3A2026-09-15'));
  await page.goto(base+'?mode=salon&monthly=1');await page.getByRole('heading',{name:'Lumi Nail Studio',exact:true}).waitFor();assert.equal(await page.getByRole('combobox',{name:/^Pay period/}).count(),0);
  await page.getByRole('combobox',{name:/^Pay month/}).selectOption('2026-10');await page.waitForFunction(()=>window.navigated?.includes('2026-10-01%3A2026-10-31'));

  await page.goto(base+'?mode=staff');await page.getByRole('heading',{name:'My Pay',exact:true}).waitFor();await page.getByRole('link',{name:'View / download paystub →'}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:`${output}/staff-${width}.png`,fullPage:true});
  await page.goto(base+'?mode=install');await page.getByRole('heading',{name:'Install Reylumi Tax Company'}).waitFor();assert.equal(await page.getByRole('link',{name:'Open Tax Company',exact:true}).count(),1);
 }
 assert.deepEqual(errors,[]);
 } finally { await browser.close();await new Promise(resolve=>server.close(resolve)); }
});

