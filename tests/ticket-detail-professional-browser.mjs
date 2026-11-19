import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { ticketDetailPreview } from './fixtures/ticket-detail-professional-preview.mjs';

const out=path.resolve('artifacts/ticket-detail-professional/browser');
fs.mkdirSync(out,{recursive:true});
const fixture=await ticketDetailPreview({baseline:true});
await new Promise(resolve=>fixture.server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${fixture.server.address().port}`;
const ticketId='22222222-2222-4222-8222-222222222222';
const detail=`/pos-tickets/${ticketId}`;
const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const evidence={kind:'synthetic-production-component-qa',source:fixture.getSource(),runtimeErrors:[],externalRequests:[],cases:[],checks:[]};
const onlyCard=process.argv.includes('--card-only');
const finalLabels=process.argv.includes('--final-labels');
try{
 const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1,timezoneId:'America/Chicago'});
 page.on('pageerror',error=>evidence.runtimeErrors.push(error.stack||error.message));
 await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==origin){evidence.externalRequests.push(url.href);return route.abort()}return route.continue()});
 const open=async(route,query={})=>{
   const url=new URL(route,origin);for(const [key,value]of Object.entries(query))url.searchParams.set(key,String(value));
   await page.goto(url.href,{waitUntil:'networkidle'});
   await page.waitForFunction(()=>window.qaMounted||window.qaMountError);
   assert.equal(await page.evaluate(()=>window.qaMountError),undefined,'Component fixture mount failed');
   await page.evaluate(()=>document.fonts.ready);
 };
 const measure=async()=>page.evaluate(()=>{
   const nav=document.querySelector('.workspace-mobile-nav');const r=nav?.getBoundingClientRect();
   const main=document.querySelector('main');
   return{width:innerWidth,scrollWidth:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,mainHeight:main?.getBoundingClientRect().height,navTop:r?.top,navBottom:r?.bottom};
 });
 // Exact canonical pre-edit source snapshot and current card, same props/styles.
 for(const lang of ['en','vi']){
   const pixels=[];const dom=[];
   for(const version of ['before','after']){
     await open('/pos-tickets',{card:version,lang});
     const card=page.locator('[data-qa-card] article').first();await card.waitFor();
     await page.mouse.move(0,0);
     const png=await card.screenshot({path:path.join(out,`main-card-${version}-${lang}-390.png`),animations:'disabled'});
     pixels.push(await sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject:true}));
     dom.push((await card.innerText()).replace(/\s+/g,' ').trim());
   }
   assert.deepEqual(dom[1],dom[0],`Main card content changed (${lang})`);
   assert.deepEqual(pixels[1].info,pixels[0].info,`Main card dimensions changed (${lang})`);
   let changed=0;for(let i=0;i<pixels[0].data.length;i++)if(pixels[0].data[i]!==pixels[1].data[i])changed++;
   assert.equal(changed,0,`Main card visual pixels changed (${lang}): ${changed}`);
   evidence.checks.push(`Main card ${lang}: exact pixel match with canonical pre-edit source; all displayed values unchanged`);
 }
 if(!onlyCard){
  for(const lang of ['en','vi'])for(const width of finalLabels?[390]:[320,390,768,1280])for(const scenario of finalLabels?['closed']:['closed','long']){
   await page.setViewportSize({width,height:844});await open(detail,{scenario,lang});
   const metrics=await measure();assert.ok(metrics.scrollWidth<=width+1,`Horizontal overflow ${lang}/${width}/${scenario}: ${JSON.stringify(metrics)}`);
   const main=page.locator('main').first();const text=await main.innerText();
   assert.ok(text.includes('T00078'));assert.ok(text.includes('$80.00'));assert.ok(text.includes('$0.00'));
   assert.ok(text.includes('Express Pedicure'));assert.ok(text.includes('Full Set'));assert.ok(text.includes('Ombre'));
   assert.ok(!text.includes('Booking snapshot / line'),'Technical snapshot ID leaked into overview');
   if(lang==='vi'){assert.ok(!text.includes('Price breakdown'),'Price breakdown is untranslated');assert.ok(!text.includes('Final Receipt'),'Receipt status is untranslated');assert.ok(!text.includes('Đóng cửa'),'Ticket closed uses salon-closure wording');}
   if(scenario==='closed')assert.ok(!text.includes('Performed by Kim'),'Repeated assigned/performed technician clutter returned');
   if(width<1024){assert.ok(metrics.navBottom<=844+1,'Mobile nav outside viewport');await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));const last=await main.locator('button:visible,a:visible,summary:visible').last().boundingBox();const nav=await page.locator('.workspace-mobile-nav').boundingBox();if(last&&nav)assert.ok(last.y+last.height<=nav.y+2,'Last ticket control overlaps mobile navigation '+JSON.stringify({lang,width,scenario,last,nav}));}
   await page.evaluate(()=>scrollTo(0,0));
   await page.screenshot({path:path.join(out,`detail-${scenario}-${lang}-${width}.png`),fullPage:true});
   evidence.cases.push({lang,width,scenario,...metrics});
  }
  await page.setViewportSize({width:390,height:844});
  // Historical snapshots survive catalog renaming.
  await open(detail,{scenario:'snapshot',lang:'en'});
  const snapshotText=await page.locator('main').first().innerText();
  assert.ok(snapshotText.includes('Express Pedicure'));assert.ok(!snapshotText.includes('Renamed current catalog service'));
  evidence.checks.push('Service overview preserves stored service snapshots after catalog rename');
  for(const scenario of finalLabels?[]:['open','unpaid','partial','view-only','voided','cancelled','empty']){
    await open(detail,{scenario,lang:'en'});const text=await page.locator('main').first().innerText();
    const metrics=await measure();assert.ok(metrics.scrollWidth<=391,`Scenario overflow: ${scenario}`);
    if(scenario==='unpaid')assert.ok(text.includes('$80.00'));
    if(scenario==='partial'){assert.ok(text.includes('$30.00'));assert.ok(text.includes('$50.00'));}
    if(['view-only','voided','cancelled'].includes(scenario))assert.equal(await page.locator('main form').count(),0,`${scenario}: mutation forms visible`);
    evidence.cases.push({scenario,lang:'en',width:390,...metrics});
    await page.screenshot({path:path.join(out,`detail-${scenario}-en-390.png`),fullPage:true});
  }
  await open(detail,{scenario:'money',lang:'en'});
  const summary=page.locator('main summary').filter({hasText:/Price breakdown/i}).first();
  if(await summary.count())await summary.click();
  const moneyText=await page.locator('main').first().innerText();
  for(const value of ['$80.00','$8.00','$7.20','$12.50','$91.70'])assert.ok(moneyText.includes(value),`Missing distinct canonical amount ${value}`);
  evidence.checks.push('Distinct discount $8, tax $7.20, tip $12.50 and canonical total $91.70 render without conflation');
  await page.screenshot({path:path.join(out,'detail-money-en-390.png'),fullPage:true});
  // Closed editor is the actual pencil destination, including its canonical guard.
  const listReturn=`/pos-tickets?date=2026-11-14&q=Nene&ticketId=${ticketId}`;
  for(const lang of ['en','vi'])for(const width of finalLabels?[390]:[320,390,768,1280]){
    await page.setViewportSize({width,height:844});
    await open(detail,{scenario:'closed',lang,edit:1,returnTo:listReturn});
    await page.locator('[data-receipt-editor]').waitFor();
    const metrics=await measure();assert.ok(metrics.scrollWidth<=width+1,`Edit overflow ${lang}/${width}`);
    assert.equal(await page.locator('[name=expected_revision]').inputValue(),'7');
    assert.ok(await page.locator('[name=correction_reason]').isVisible());
    const hero=await page.locator('[data-ticket-detail]>header').innerText();
    assert.ok(hero.includes(lang==='vi'?'Tổng tiền đã lưu':'Saved total'),'Saved total is not distinguished from draft editor total');
    await page.screenshot({path:path.join(out,`detail-edit-${lang}-${width}.png`),fullPage:true});
    evidence.cases.push({scenario:'edit-closed',lang,width,...metrics});
  }
  await page.setViewportSize({width:390,height:844});
  await open(detail,{scenario:'closed',lang:'en',edit:1,returnTo:listReturn});
  await page.locator('[data-receipt-line]').first().getByRole('button',{name:'$25.00',exact:true}).click();
  await page.locator('[data-receipt-line]').first().locator('input[type=number]').fill('27.35');
  await page.locator('[data-receipt-line]').first().locator('input[type=number]').press('Enter');
  await page.locator('[name=correction_reason]').fill('Owner verified same-staff booking service correction');
  evidence.sameStaffBookingCorrection={saveDisabled:await page.locator('[data-receipt-editor]').getByRole('button',{name:'Save',exact:true}).isDisabled(),editorText:await page.locator('[data-receipt-editor]').innerText()};
  await page.screenshot({path:path.join(out,'detail-edit-same-staff-changed-en-390.png'),fullPage:true});
  await open(detail,{scenario:'editable',lang:'en',edit:1,returnTo:listReturn});
  const save=page.locator('[data-receipt-editor]').getByRole('button',{name:'Save',exact:true});
  assert.ok(await save.isDisabled(),'Unchanged correction must not save');
  await page.locator('[data-receipt-line]').first().getByRole('button',{name:'$25.00',exact:true}).click();
  await page.locator('[data-receipt-line]').first().locator('input[type=number]').fill('27.35');
  await page.locator('[data-receipt-line]').first().locator('input[type=number]').press('Enter');
  assert.ok(await save.isDisabled(),'Correction without reason must not save');
  await page.locator('[name=correction_reason]').fill('Owner verified service correction');
  assert.ok(await save.isEnabled(),'Valid correction should enable Save');
  await save.click();await page.waitForFunction(()=>window.qaActions.length===1);
  const correction=await page.evaluate(()=>window.qaActions[0]);
  assert.equal(correction.name,'correctClosedPosTicketInline');
  assert.equal(correction.values.ticket_id,ticketId);assert.equal(correction.values.expected_revision,'7');
  assert.equal(correction.values.correction_reason,'Owner verified service correction');
  assert.ok(JSON.parse(correction.values.item_updates).some(item=>item.parts.some(part=>Number(part.amount)===27.35)),'Changed cents absent from correction payload');
  assert.ok(correction.values.return_to.startsWith(detail));
  evidence.checks.push('Closed editor preserves revision7, requires reason and actual change, saves27.35 cents precisely to inert real-action boundary');
  await open(detail,{scenario:'editable',lang:'en',edit:1,returnTo:listReturn});
  await page.locator('[name=correction_reason]').fill('Unsaved correction draft');
  await page.locator('[data-receipt-editor]').getByRole('link',{name:'Cancel',exact:true}).click();
  await page.waitForFunction(()=>window.qaMounted&&!new URLSearchParams(location.search).has('edit'));
  assert.equal(await page.locator('[data-receipt-editor]').count(),0);
  assert.deepEqual(await page.evaluate(()=>window.qaActions),[],'Cancel submitted a correction');
  evidence.checks.push('Cancel returns to ticket overview without submitting; filtered list return context retained');
  await open('/pos-tickets',{card:'after',lang:'en'});
  const pencil=page.locator('[data-qa-card]').getByRole('link',{name:'Edit',exact:true});
  assert.ok((await pencil.getAttribute('href')).includes('edit=1'));
  await pencil.click();await page.locator('[data-receipt-editor]').waitFor();
  assert.equal(new URL(page.url()).searchParams.get('returnTo'),listReturn);
  await page.locator('[data-ticket-detail]').getByRole('link',{name:'POS tickets',exact:true}).click();
  await page.locator('[data-qa-card]').waitFor();
  const returned=new URL(page.url());assert.equal(returned.pathname,'/pos-tickets');assert.equal(returned.searchParams.get('date'),'2026-11-14');assert.equal(returned.searchParams.get('q'),'Nene');assert.equal(returned.searchParams.get('ticketId'),ticketId);
  evidence.checks.push('Main-card pencil opens edit detail; POS tickets back link preserves date, search and focused ticket');
  for(const [name,action]of [['Reopen Ticket','reopenPosTicket'],['Void Ticket','voidPosTicket']]){
    await open(detail,{scenario:'closed',lang:'en'});
    await page.locator('[data-ticket-detail]>details').filter({has:page.locator('summary',{hasText:/^Actions$/})}).locator(':scope>summary').click();
    const group=page.locator('[data-ticket-detail] details').filter({has:page.locator(':scope>summary',{hasText:new RegExp('^'+name+'$')})}).last();
    await group.locator(':scope>summary').click();
    const form=group.locator('form');const actionButton=form.getByRole('button',{name,exact:true});
    await actionButton.click();assert.equal(await page.evaluate(()=>window.qaActions.length),0,'Empty required reason submitted');
    assert.equal(await form.locator('[name=note]').evaluate(input=>input.validity.valueMissing),true);
    await form.locator('[name=note]').fill('Owner verified synthetic reason');await actionButton.click();
    await page.waitForFunction(()=>window.qaActions.length===1);const call=await page.evaluate(()=>window.qaActions[0]);
    assert.equal(call.name,action);assert.equal(call.values.note,'Owner verified synthetic reason');assert.equal(call.values.ticket_id,ticketId);
  }
  evidence.checks.push('Reopen/Void remain available only with permission and require a reason before action submission');
  await open(detail,{scenario:'editable',lang:'en',edit:1,locked:1});
  const lockDialog=page.getByRole('dialog');await lockDialog.waitFor();
  assert.ok((await lockDialog.innerText()).includes('Locked Business Date'));
  await lockDialog.getByRole('button',{name:'Continue',exact:true}).click();
  await page.locator('[data-receipt-editor]').waitFor();
  assert.ok(await page.getByRole('button',{name:'Apply Correction',exact:true}).isDisabled());
  assert.ok(await page.getByRole('button',{name:'Submit Correction Request',exact:true}).isDisabled());
  evidence.checks.push('Locked date retains explicit confirmation and separate financial correction request/apply controls');
  // Open editing keeps real payment forms and canonical checkout eligibility.
  for(const scenario of ['unpaid','partial','empty','open']){
    await open(detail,{scenario,lang:'en',edit:1});
    await page.locator('[data-ticket-detail]>details').filter({has:page.locator('summary',{hasText:/^Actions$/})}).locator(':scope>summary').click();
    const checkout=page.getByRole('button',{name:'Checkout',exact:true});
    assert.equal(await checkout.count(),scenario==='open'?1:0,`Checkout guard wrong for ${scenario}`);
    if(scenario==='unpaid'||scenario==='partial'){
      const paymentForm=page.locator('form').filter({has:page.locator('[name=payment_method]')});
      assert.equal(await paymentForm.locator('[name=amount]').inputValue(),scenario==='partial'?'50.00':'80.00');
      await paymentForm.locator('[name=payment_method]').selectOption('cash');
      await paymentForm.getByRole('button',{name:'Add Payment',exact:true}).click();
      await page.waitForFunction(()=>window.qaActions.length===1);const call=await page.evaluate(()=>window.qaActions[0]);
      assert.equal(call.name,'addPosPayment');assert.equal(call.values.ticket_id,ticketId);assert.equal(call.values.payment_method,'cash');
      assert.equal(call.values.amount,scenario==='partial'?'50.00':'80.00');
      assert.equal(new URL(call.values.return_to,origin).searchParams.get('edit'),'1');
    }
    if(scenario==='open'){
      await checkout.click();await page.waitForFunction(()=>window.qaActions.length===1);
      assert.equal((await page.evaluate(()=>window.qaActions[0])).name,'closePosTicket');
    }
  }
  evidence.checks.push('Open editor defaults to canonical remaining payment, retains edit return URL, and exposes Checkout only for full valid payment');
 }
 assert.deepEqual(evidence.runtimeErrors,[],'Browser runtime errors');assert.deepEqual(evidence.externalRequests,[],'External network attempted');
 evidence.passed=true;
 console.log(JSON.stringify({passed:true,cases:evidence.cases.length,checks:evidence.checks,source:evidence.source},null,2));
}catch(error){evidence.passed=false;evidence.failure=error.stack;throw error}
finally{fs.writeFileSync(path.join(out,finalLabels?'verification-final-labels.json':'verification.json'),JSON.stringify(evidence,null,2));await browser.close();await fixture.dispose();}
