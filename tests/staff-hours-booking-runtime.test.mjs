import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';

test('inline online booking: toggle, failure, assignment save and responsive permissions',async()=>{
 const compiled=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`import React from 'react';import{createRoot}from'react-dom/client';import{StaffHoursBooking}from'./app/settings/staff-hours-booking';window.calls=[];window.fail=false;const root=createRoot(document.getElementById('root'));const member={id:'ny',is_active:true,online_booking_enabled:false};const setup={services:[{id:'mani',name:'Manicure',is_active:true,online_booking_enabled:true},{id:'pedi',name:'Pedicure',is_active:true,online_booking_enabled:true},{id:'offline',name:'Offline service',is_active:true,online_booking_enabled:false}],assignments:[],permissions:{canManageAssignments:true},readinessByStaffId:{ny:{reasons:[{label:'No working rules'}]}}};window.render=(allowed=true)=>root.render(<div className="availability-compact"><StaffHoursBooking salonId="selected-salon" member={member} setup={{...setup,permissions:{canManageAssignments:allowed}}} canManageOnline={allowed}/></div>);window.render();`},bundle:true,write:false,outdir:'fixture',jsx:'automatic',plugins:[{name:'stubs',setup(b){
 b.onResolve({filter:/workspace-language$/},()=>({path:'language',namespace:'stub'}));
 b.onResolve({filter:/staff-hours-booking-actions$/},()=>({path:'action',namespace:'stub'}));
 b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:a.path==='language'?`export const WorkspaceText=({text})=>text;export const useWorkspaceTranslation=()=>text=>text;`:`export async function saveStaffHoursBooking(input){window.calls.push(input);return window.fail?{ok:false,error:'Save failed'}:{ok:true};}`}));
 }}]});
 const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH,headless:true});
 try {for(const width of [320,430,1280]){
  const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('http://localhost/',r=>r.fulfill({contentType:'text/html',body:`<style>body{margin:0;font-family:Arial}*{box-sizing:border-box}${readFileSync('app/booking-setup/booking-setup.css','utf8')}</style><div id="root"></div><script src="/app.js"></script>`}));
  await page.route('**/app.js',r=>r.fulfill({contentType:'text/javascript',body:compiled.outputFiles.find(f=>f.path.endsWith('.js')).text}));
  await page.goto('http://localhost/');
  const toggle=page.getByRole('switch');await toggle.waitFor();await toggle.check();await page.getByText('On · Select online services').waitFor();
  assert.deepEqual(await page.evaluate(()=>window.calls[0]),{salonId:'selected-salon',staffId:'ny',enabled:true});
  await page.evaluate(()=>window.fail=true);await toggle.click();await page.getByRole('alert').waitFor();assert.equal(await toggle.isChecked(),true);
  await page.evaluate(()=>window.fail=false);await page.locator('summary').click();assert.equal(await page.getByText('Offline service',{exact:true}).count(),0);
  await page.getByLabel('Manicure',{exact:true}).check();await page.getByRole('button',{name:'Save online services',exact:true}).click();
  await page.getByText('On · Online services assigned').waitFor();
  assert.deepEqual(await page.evaluate(()=>window.calls.at(-1)),{salonId:'selected-salon',staffId:'ny',serviceIds:['mani']});
  await page.getByLabel('Pedicure',{exact:true}).check();await page.getByRole('button',{name:'Discard',exact:true}).click();assert.equal(await page.getByLabel('Pedicure',{exact:true}).isChecked(),false);
  await page.evaluate(()=>window.render(false));await page.waitForFunction(()=>document.querySelector("[role=switch]").disabled);assert.equal(await toggle.isDisabled(),true);assert.equal(await page.getByLabel('Manicure',{exact:true}).isDisabled(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
  await page.screenshot({path:`work/staff-hours-online-${width}.png`});await page.close();
 }}finally{await browser.close();}
});


