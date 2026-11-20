import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import {onlineBookingAccessForSave} from '../lib/booking-status.ts';
import {discoverySetupAction} from '../lib/salon-setup-navigation.ts';

const out='artifacts/salon-online-ux-optimization';
const permissions={canManageAssignments:true,canManageAvailability:true,canManageBooking:true,canManageServices:true,canManageStaff:true};
test('one booking switch preserves all eight existing access combinations on unrelated saves',()=>{
 for(const booking_enabled of [false,true])for(const online_booking_visible of [false,true])for(const guest_booking_enabled of [false,true]){
  const s={booking_enabled,online_booking_visible,guest_booking_enabled},open=booking_enabled&&online_booking_visible&&guest_booking_enabled;
  assert.deepEqual(onlineBookingAccessForSave(s,open),{bookingEnabled:booking_enabled,onlineBookingVisible:online_booking_visible,guestBookingEnabled:guest_booking_enabled});
  assert.deepEqual(onlineBookingAccessForSave(s,true),{bookingEnabled:true,onlineBookingVisible:true,guestBookingEnabled:true});
 }
 assert.deepEqual(onlineBookingAccessForSave({booking_enabled:true,online_booking_visible:true,guest_booking_enabled:true},false),{bookingEnabled:true,onlineBookingVisible:false,guestBookingEnabled:true});
});

const language=`export const WorkspaceText=({text})=>text;export const useWorkspaceTranslation=()=>s=>s;`;
test('real guide uses the actual blocker, ignores opted-out staff, separates publication, and respects permissions',async()=>{
 const result=await build({entryPoints:['app/settings/booking-setup-guide.tsx'],bundle:true,write:false,platform:'node',format:'cjs',external:['react','react/jsx-runtime'],plugins:[{name:'language',setup(b){b.onResolve({filter:/workspace-language$/},()=>({path:'language',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:language}));}}]});
 const m={exports:{}};vm.runInNewContext(result.outputFiles[0].text,{module:m,exports:m.exports,require:createRequire(import.meta.url),URLSearchParams});
 const props={salonId:'salon-b',settings:{booking_enabled:false,online_booking_visible:false,guest_booking_enabled:false},setup:{permissions,services:[{is_active:true,online_booking_enabled:true}],staff:[{id:'alex',display_name:'Alex',is_active:true,online_booking_enabled:true},{id:'cashier',display_name:'Cashier',is_active:true,online_booking_enabled:false}],readinessByStaffId:{alex:{ready:false,reasons:[{code:'booking_disabled'}]},cashier:{ready:false,reasons:[{code:'no_working_hours'}]}}}};
 const render=p=>renderToStaticMarkup(React.createElement(m.exports.BookingSetupGuide,p));
 const html=render(props);assert.match(html,/#booking-access/);assert.doesNotMatch(html,/below|Review services and booking hours|Cashier|staffId=alex/);
 const denied=render({...props,setup:{...props.setup,permissions:{}}});assert.doesNotMatch(denied,/#booking-access/);assert.match(denied,/Ask the salon owner/);
 const p={readiness:{items:[{id:'city',complete:false},{id:'description',complete:true},{id:'salon-status',complete:true}]},enabled:false,available:false};
 const checklist=render({...props,publication:p});assert.match(checklist,/Continue setup/);assert.match(checklist,/salon-information%2Fsalon-address/);assert.match(checklist,/Completed steps/);assert.doesNotMatch(checklist,/Your profile is public/);
 assert.notEqual(discoverySetupAction('city','salon-b').href,discoverySetupAction('description','salon-b').href);
 const unknown=render({...props,publication:{...p,enabled:true,available:null}});assert.doesNotMatch(unknown,/Your profile is public/);
});

async function runtimeBundle(){
 const empty=`export const BookingDepositSettings=()=>null;export const BookingRulesSettings=()=>null;export const BookSmsSettings=()=>null;export const SalonProfilePreferencesPanel=()=>null;export const SalonPublicationStatus=()=>null;export const SalonMediaUploader=()=>null;export const StaffPublicProfileEditor=()=>null;export const DeleteUnusedButton=()=>null;`;
 return build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
 import React,{useState}from'react';import{createRoot}from'react-dom/client';
 import{SettingsChildPages}from'./app/settings/settings-child-pages';
 import{SalonDetailsPanel,BookingSettingsPanel}from'./app/settings/salon-settings-panels';
 import{TeamSettingsPanel}from'./app/settings/team-payroll-panels';import{BookingSetupGuide}from'./app/settings/booking-setup-guide';
 window.writes=[];window.process={env:{}};
 const s={id:'alex',display_name:'Alex',staff_profile_display_name:'Alex',is_active:true,online_booking_enabled:true};
 window.staff=[s];window.setup={staff:window.staff,services:[{id:'mani',name:'Manicure',is_active:true,online_booking_enabled:true}],assignments:[{staff_id:'alex',service_id:'mani',is_active:true,online_bookable:true}],availabilityRules:[],timeBlocks:[],timezone:'America/Chicago',permissions:${JSON.stringify(permissions)},readinessByStaffId:{alex:{staffId:'alex',ready:true,reasons:[]}}};
 const profile={kind:'salon-profile',salonId:'salon-b',canManage:true,setting:{business_name:'Oak Nails',phone:'1234567890',business_description:'Nail care',city:'Chicago',state:'IL',postal_code:'60601',country:'US',address_line1:'1 Main St'},hours:{timeZone:'America/Chicago',weeklyHours:[],specialHours:[]},mapLocation:{providerConfigured:false},readiness:{items:[]}};
 const settings={booking_enabled:false,online_booking_visible:false,guest_booking_enabled:false,same_day_booking_enabled:false,confirmation_mode:'request_confirmation',minimum_lead_time_minutes:0,maximum_advance_window_days:30,slot_interval_minutes:15,default_cleanup_buffer_minutes:0,cancellation_window_minutes:0,timezone_iana:'America/Chicago',ticket_creation_mode:'manual'};
 function App(){const[n,setN]=useState(0);window.reload=()=>setN(v=>v+1);const reload=async()=>window.reload();const mode=new URLSearchParams(location.search).get('mode');return <div className="settings-hub settings-style compact-settings"><div className="settings-inline-editor"><SettingsChildPages showTitle label="Setup">{mode==='overview'?<BookingSetupGuide salonId='salon-b' setup={window.setup} settings={settings} publication={{readiness:{items:[{id:'business-name',complete:true},{id:'city',complete:false},{id:'salon-status',complete:true}]},enabled:false,available:false}}/>:mode==='team'?<TeamSettingsPanel data={{kind:'staff-team',salonId:'salon-b',canManage:true,canManageStaffOnlineBooking:true,staff:window.staff,setup:window.setup,requests:[]}} onSaved={reload}/>:mode==='booking'?<BookingSettingsPanel data={{kind:'booking',salonId:'salon-b',canManage:true,settings,setup:window.setup}} onSaved={reload}/>:<SalonDetailsPanel data={profile} onSaved={reload}/>}</SettingsChildPages></div></div>};createRoot(document.getElementById('root')).render(<App/>);`},bundle:true,write:false,outdir:'fixture',jsx:'automatic',plugins:[{name:'boundaries',setup(b){
  b.onResolve({filter:/workspace-language$/},()=>({path:'language',namespace:'stub'}));
  b.onResolve({filter:/^next\/(link|navigation)$/},a=>({path:a.path,namespace:'stub'}));
  b.onResolve({filter:/(direct-settings-actions|settings-extra-actions|direct-pos-actions|staff-hours-booking-actions|booking-deposit-settings|booking-plugin-settings|time-zone-select|salon-publication-status|salon-profile-preferences-panel|salon-profile-studio|staff-public-profile-editor|delete-unused-button)$/},a=>({path:a.path.split('/').at(-1),namespace:'stub'}));
  b.onResolve({filter:/app\/booking-setup\/actions$/},()=>({path:'availability-actions',namespace:'stub'}));
  b.onLoad({filter:/.*/,namespace:'stub'},({path})=>({loader:'tsx',resolveDir:process.cwd(),contents:path==='language'?language:path==='next/link'?`export default p=><a {...p}/>`:path==='next/navigation'?`export const useSearchParams=()=>new URLSearchParams(location.search);export const useRouter=()=>({refresh(){},replace(){}});`:path==='time-zone-select'?`export const TimeZoneSelect=p=><select {...p}><option value="America/Chicago">America/Chicago</option></select>`:path==='direct-settings-actions'?`
  export async function saveDirectStaff(id,p){window.writes.push({id,p});if(!p.staff_id){const s={...p,id:'new-staff'};window.staff=[...window.staff,s];window.setup={...window.setup,staff:window.staff,readinessByStaffId:{...window.setup.readinessByStaffId,'new-staff':{staffId:'new-staff',ready:false,reasons:[{code:'no_assigned_services'},{code:'no_working_hours'}]}}};}return {ok:true,staffId:p.staff_id||'new-staff'}};
  export async function saveDirectSalonProfile(id,p){window.writes.push({id,p});return {ok:true}};export async function saveDirectBooking(id,p){window.writes.push({id,p});return {ok:true}};export const saveDirectHours=async()=>({ok:true}),saveDirectSpecialHours=saveDirectHours,runDirectStaffRequest=saveDirectHours,saveDirectPayroll=saveDirectHours;`
  :path==='settings-extra-actions'?`export const saveSettingsProfileIdentity=async()=>({ok:true}),refreshSettingsMap=saveSettingsProfileIdentity,saveSettingsPublicTeam=saveSettingsProfileIdentity;`
  :path==='direct-pos-actions'?`export const resetDirectStaffPasscode=async()=>({ok:true});`
  :path==='staff-hours-booking-actions'?`export const saveStaffHoursBooking=async()=>({ok:true});`
  :path==='availability-actions'?`export const saveStaffWeeklyAvailabilityAction=async()=>({ok:true}),cancelStaffTimeBlockAction=saveStaffWeeklyAvailabilityAction,createStaffTimeBlockAction=saveStaffWeeklyAvailabilityAction;`
  :empty}));
 }}]});
}

test('actual profile, team, booking and availability editors: precise deep links, truthful save notices, one booking switch, mobile fit',{timeout:90000},async()=>{
 fs.mkdirSync(out+'/screenshots',{recursive:true});const bundle=await runtimeBundle();
 const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{for(const width of [320,430,1280]){
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const css=bundle.outputFiles.find(f=>f.path.endsWith('.css'))?.text||'';
  await page.route('http://setup.test/**',r=>r.fulfill(r.request().url().endsWith('/app.js')?{contentType:'text/javascript',body:bundle.outputFiles.find(f=>f.path.endsWith('.js')).text}:{contentType:'text/html',body:'<style>body{margin:0;font:14px Arial}*{box-sizing:border-box}[hidden]{display:none!important}'+css+'</style><div id="root"></div><script src="/app.js"></script>'}));
  await page.goto('http://setup.test/settings?mode=overview');await page.getByRole('link',{name:/Continue setup/}).waitFor();assert.equal(await page.locator('.salon-setup-checklist li').count(),5);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:out+'/screenshots/setup-checklist-'+width+'.png',fullPage:true});await page.getByRole('link',{name:/Continue setup/}).click();
  await page.getByLabel('City',{exact:true}).waitFor({state:'visible'});
  await page.goto('http://setup.test/settings?mode=profile#salon-information%2Fsalon-address');await page.getByLabel('City',{exact:true}).waitFor({state:'visible'});await page.getByLabel('City',{exact:true}).fill('Austin');
  await page.getByRole('button',{name:'Save changes',exact:true}).click();await page.waitForFunction(()=>window.writes.length===1);assert.equal(await page.evaluate(()=>window.writes[0].p.city),'Austin');await page.locator('[data-settings-child-id=salon-information] > .settings-child-launch').waitFor({state:'visible'});
  await page.goto('http://setup.test/settings?mode=profile#salon-information%2Fsalon-description');await page.locator('textarea[name=business_description]').waitFor({state:'visible'});assert.equal(await page.getByLabel('City',{exact:true}).isVisible(),false);await page.locator('.settings-child-back').click();await page.getByLabel('Salon name',{exact:true}).waitFor({state:'visible'});
  await page.goto('http://setup.test/settings?mode=team#staff-alex');await page.getByLabel('Phone',{exact:true}).fill('5550100');await page.getByRole('button',{name:'Save staff',exact:true}).click();await page.getByText('Saved.',{exact:true}).waitFor();assert.equal(await page.getByText(/Staff saved\. Choose/).count(),0);
  await page.goto('http://setup.test/settings?mode=team');await page.getByRole('button',{name:'Add staff',exact:true}).click();await page.getByLabel('Display name',{exact:true}).fill('Cashier');await page.getByLabel('Allow online booking',{exact:true}).uncheck();await page.getByRole('button',{name:'Create staff',exact:true}).click();await page.waitForFunction(()=>window.writes.length===1);assert.equal(await page.getByText(/Staff saved\. Choose/).count(),0);
  await page.goto('http://setup.test/settings?mode=team');await page.getByRole('button',{name:'Add staff',exact:true}).click();await page.getByLabel('Display name',{exact:true}).fill('New stylist');await page.getByRole('button',{name:'Create staff',exact:true}).click();await page.getByText(/Staff saved\. Choose/).waitFor();assert.match(await page.getByRole('link',{name:'Continue setting up this staff member'}).getAttribute('href'),/staff-new-staff/);
  await page.goto('http://setup.test/settings?mode=booking#booking-access');await page.getByLabel('Accept online appointments',{exact:true}).check();await page.getByRole('button',{name:'Save booking rules',exact:true}).click();await page.waitForFunction(()=>window.writes.length===1);assert.deepEqual(await page.evaluate(()=>({booking:window.writes[0].p.bookingEnabled,visible:window.writes[0].p.onlineBookingVisible,guest:window.writes[0].p.guestBookingEnabled})),{booking:true,visible:true,guest:true});
  await page.goto('http://setup.test/settings?mode=booking&staffId=alex#booking-hours');await page.locator('.availability-person-toggle[aria-expanded=true]').waitFor();assert.match(await page.locator('.availability-person-toggle[aria-expanded=true]').innerText(),/Alex/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);await page.screenshot({path:out+'/screenshots/actual-editors-'+width+'.png',fullPage:true});await page.close();
 }}finally{await browser.close();}
});
