import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';
test('staff creation: immediate form, cached options, customer suggestions, assignment and owner permission', {skip:!process.env.ESBUILD_MODULE_PATH,timeout:60000}, async()=>{
  const {build}=await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
  const result=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`import React from 'react';import{createRoot}from'react-dom/client';import{StaffCreateAppointment,StaffCreationPermission}from'./app/staff/appointments/staff-create-appointment';createRoot(document.getElementById('root')).render(<><StaffCreateAppointment salonId="11111111-1111-4111-8111-111111111111" date="2026-10-10"/><StaffCreationPermission salonId="11111111-1111-4111-8111-111111111111"/></>);`},bundle:true,write:false,outdir:'fixture',platform:'browser',jsx:'automatic',plugins:[{name:'router',setup(b){b.onResolve({filter:/^next\/navigation$/},()=>({path:'router',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export const useRouter=()=>({refresh:()=>{window.refreshes=(window.refreshes||0)+1}})'}));}}]});
  const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH,headless:true});
  try{
    const page=await browser.newPage({viewport:{width:375,height:812}});let enabled=true,failSwitch=false,calls=[],catalogCalls=0;
    const catalog={enabled:true,staffId:'self',timezone:'America/Chicago',staff:[{id:'self',name:'Tram'},{id:'other',name:'David'}],services:[{id:'service',name:'Manicure'}],assignments:[{staffId:'self',serviceId:'service'},{staffId:'other',serviceId:'service'}]};
    await page.route('http://localhost/',r=>r.fulfill({contentType:'text/html',body:'<style>*,::before,::after{box-sizing:border-box}'+readFileSync('app/staff/appointments/staff-appointments.css','utf8')+'</style><div id="root"></div><script src="/bundle.js"></script>'}));
    await page.route('**/bundle.js',r=>r.fulfill({contentType:'text/javascript',body:result.outputFiles[0].text}));
    await page.route('**/api/staff/create-appointment**',async r=>{
      if(r.request().method()==='GET'){if(r.request().url().includes('catalog=1')){catalogCalls++;await new Promise(resolve=>setTimeout(resolve,1500));}return r.fulfill({json:{...catalog,enabled}});}
      const body=r.request().postDataJSON();if(body.action==='customers')return r.fulfill({json:[{id:'customer-1',name:'Existing Customer',phone:'5551234567'}]});calls.push(body);await new Promise(resolve=>setTimeout(resolve,100));
      if(body.action==='permission'){if(failSwitch)return r.fulfill({status:403,json:{message:'Save rejected'}});enabled=body.enabled;return r.fulfill({json:{enabled}});}
      return r.fulfill({status:enabled?200:403,json:enabled?{ok:true,bookingId:'booking',assignedToSelf:body.appointment.staffId==='self'}:{message:'Owner disabled appointment creation'}});
    });
    await page.goto('http://localhost/');await page.getByRole('button',{name:'Create appointment',exact:true}).click();
    const dialog=page.getByRole('dialog');await dialog.getByLabel('Customer name').fill('Ready while loading');assert.equal(await dialog.getByLabel('Professional').isDisabled(),true);await page.waitForFunction(()=>document.querySelector('select')?.value==='self');assert.equal(await dialog.getByLabel('Professional').inputValue(),'self');
    const rect=await dialog.boundingBox();assert.ok(rect.x>=0&&rect.x+rect.width<=375);
    await dialog.getByLabel('Customer name').fill('Existing');await dialog.getByRole('option',{name:'Existing Customer 5551234567'}).click();assert.equal(await dialog.getByLabel('Phone',{exact:true}).inputValue(),'5551234567');await dialog.getByLabel('Professional').selectOption('other');await dialog.getByLabel('Manicure').check();await dialog.getByLabel('Time',{exact:true}).fill('10:00');
    enabled=false;await dialog.getByRole('button',{name:'Create appointment',exact:true}).click();await dialog.getByRole('alert').waitFor();assert.equal(await page.evaluate(()=>window.refreshes||0),0);
    enabled=true;await dialog.getByRole('button',{name:'Create appointment',exact:true}).click();await dialog.getByRole('status').waitFor();assert.match(await dialog.getByRole('status').innerText(),/their schedule/);assert.equal(calls[0].appointment.key,calls[1].appointment.key);assert.equal(calls[1].appointment.staffId,'other');assert.equal(calls[1].appointment.customerId,'customer-1');assert.equal(await page.evaluate(()=>window.refreshes),1);
    await dialog.getByRole('button',{name:'Done'}).click();await page.getByRole('button',{name:'Create appointment',exact:true}).click();assert.equal(await dialog.getByLabel('Professional').isDisabled(),false);assert.equal(catalogCalls,1);await dialog.getByLabel('Phone',{exact:true}).fill('555');await dialog.getByRole('option',{name:'Existing Customer 5551234567'}).waitFor();await dialog.getByLabel('Phone',{exact:true}).press('ArrowDown');await dialog.getByLabel('Phone',{exact:true}).press('Enter');assert.equal(await dialog.getByLabel('Customer name').inputValue(),'Existing Customer');await dialog.getByLabel('Phone',{exact:true}).fill('5559991234');assert.equal(await dialog.locator('[name=customerId]').inputValue(),'');await dialog.getByRole('button',{name:'Close create appointment'}).click();const toggle=page.getByRole('switch');failSwitch=true;await toggle.click();await page.getByRole('alert').waitFor();assert.equal(await toggle.getAttribute('aria-checked'),'true');failSwitch=false;await toggle.click();await page.waitForFunction(()=>document.querySelector('[role=switch]')?.getAttribute('aria-checked')==='false');await page.reload();await page.waitForFunction(()=>!document.querySelector('.staff-create-trigger'));assert.equal(await page.getByRole('button',{name:'Create appointment',exact:true}).count(),0);
  }finally{await browser.close();}
});


