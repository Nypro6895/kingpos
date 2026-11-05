import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';

const out='artifacts/salon-online-settings';fs.mkdirSync(out+'/screenshots',{recursive:true});
const index={managed:[{id:'salon-a',name:'Oak Nails',owner:true,status:'active',role:'Owner',permissions:{},owners:[]},{id:'salon-b',name:'Pine Nails',owner:true,status:'active',role:'Owner',permissions:{},owners:[]}],staff:[],accounts:[],hasBusinessWorkspace:true};
async function fixture(){return build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`import React from 'react';import{createRoot}from'react-dom/client';import{SettingsHubClient}from'./app/settings/settings-hub-client';window.index=${JSON.stringify(index)};window.calls=[];window.vi=new URLSearchParams(location.search).has('vi');createRoot(document.getElementById('root')).render(<SettingsHubClient user={{email:'owner@example.com'}} createdAtLabel="Today" index={window.index} initialSection={new URLSearchParams(location.search).get('section')||''}/>);`},bundle:true,write:false,outdir:'fixture',jsx:'automatic',plugins:[{name:'fixtures',setup(b){
 b.onResolve({filter:/^next\/link$/},()=>({path:'link',namespace:'fixture'}));
 b.onResolve({filter:/components\/workspace-language$/},()=>({path:'language',namespace:'fixture'}));
 b.onResolve({filter:/(?:\.\/|app\/settings\/)(direct-settings-panel|settings-hub-actions|deferred-personal-section|personal-public-profile-panel|connections-panel|salon-list-panel|blocked-users-panel)$/},a=>({path:a.path.split('/').at(-1),namespace:'fixture'}));
 b.onResolve({filter:/app\/account\/account-profile-editor$/},()=>({path:'profile',namespace:'fixture'}));
 b.onResolve({filter:/staff-hours-booking-actions$/},()=>({path:'staff-action',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({loader:'tsx',resolveDir:process.cwd(),contents:path==='language'?`import{translateVietnamese}from'./lib/vietnamese-dictionary';export const useWorkspaceTranslation=()=>s=>translateVietnamese(s,window.vi);export const WorkspaceText=({text})=>useWorkspaceTranslation()(text);`
 :path==='link'?`export default p=><a {...p}/>`
 :path==='settings-hub-actions'?`export const loadSettingsHub=async()=>window.index;`
 :path==='staff-action'?`export async function saveStaffHoursBooking(input){window.calls.push(input);return {ok:true}}`
 :path==='direct-settings-panel'?`import{useState}from'react';import{SettingsDetails}from'./app/settings/settings-child-pages';import{SettingsEditSection,InlineForm,Field}from'./app/settings/direct-settings-ui';import{StaffBookingGuide}from'./app/settings/booking-setup-guide';import{StaffHoursBooking}from'./app/settings/staff-hours-booking';import{salonSetupHref}from'./lib/salon-setup-navigation';export function DirectSettingsPanel({kind,salonId}){const [assigned,setAssigned]=useState(false),[hours,setHours]=useState(false);const staffId='staff-a';const readiness={staffId,ready:assigned&&hours,reasons:[...assigned?[]:[{code:'no_assigned_services',label:'No assigned services'}],...hours?[]:[{code:'no_working_hours',label:'No working hours'}]]};const setup={staff:[],services:[{id:'mani',name:'Manicure',is_active:true,online_booking_enabled:true}],assignments:[],permissions:{canManageAssignments:true},readinessByStaffId:{[staffId]:readiness}};return kind==='staff-team'?<SettingsEditSection id={'staff-'+staffId} title="Alex" closeOnSave={false}><StaffBookingGuide salonId={salonId} readiness={readiness}/></SettingsEditSection>:kind==='booking'?<SettingsDetails id="booking-hours"><summary>Staff availability & time off</summary><p>Alex booking hours</p><StaffHoursBooking salonId={salonId} member={{id:staffId,is_active:true,online_booking_enabled:true}} setup={setup} canManageOnline onSaved={()=>setAssigned(true)}/><InlineForm save={async f=>{window.calls.push({salonId,staffId,hours:f.get('hours')});return {ok:true}}} onSaved={()=>setHours(true)}><Field name="hours" label="Working hours" value="09:00–17:00"/></InlineForm></SettingsDetails>:<InlineForm save={async()=>({ok:true})} onSaved={()=>{}}><Field name="draft" label="Salon draft" value=""/><a href={salonSetupHref(salonId,'staff-team','staff-'+staffId)}>Review staff setup</a></InlineForm>}`
 :`export const ${({'profile':'AccountProfileEditor','deferred-personal-section':'DeferredPersonalSection','personal-public-profile-panel':'PersonalPublicProfilePanel','connections-panel':'ConnectionsPanel','salon-list-panel':'SalonListPanel','blocked-users-panel':'BlockedUsersPanel'})[path]}=()=>null;`}));
}}]});}

test('salon setup: ordered settings, actionable staff guidance, saved feedback, correct salon/staff, drafts and responsive layout',{timeout:120000},async()=>{
 const bundle=await fixture(),browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{for(const width of [320,430,1280]){
 const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const css=['settings-hub.css','settings-controls.css','settings-child-pages.css','settings-compact-children.css'].map(p=>fs.readFileSync('app/settings/'+p,'utf8')).join('\n');
 await page.route('http://setup.test/**',r=>r.fulfill(r.request().url().endsWith('/app.js')?{contentType:'text/javascript',body:bundle.outputFiles.find(f=>f.path.endsWith('.js')).text}:{contentType:'text/html',body:`<style>body{margin:0;font-family:Arial}*{box-sizing:border-box}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}${css}</style><div id="root"></div><script src="/app.js"></script>`}));
 await page.goto('http://setup.test/settings?section=salon-salon-a');
 const labels=await page.locator('.settings-category').first().locator('.settings-row-label strong').allTextContents();assert.deepEqual(labels,['Salon information','Services & prices','Team','Hours & booking','Go online']);
 await page.getByRole('button',{name:/^Team /}).click();await page.getByRole('button',{name:'Alex',exact:true}).click();
 await page.getByRole('link',{name:/Choose services for this staff member/}).click();await page.getByLabel('Manicure',{exact:true}).waitFor();
 assert.equal(new URL(page.url()).searchParams.get('section'),'salon-salon-a-booking');assert.equal(new URL(page.url()).searchParams.get('staffId'),'staff-a');assert.equal(new URL(page.url()).hash,'#staff-services-staff-a');
 await page.getByLabel('Manicure',{exact:true}).check();await page.getByRole('button',{name:'Save online services',exact:true}).click();await page.getByRole('link',{name:/Add booking hours for this staff member/}).waitFor();assert.equal(await page.getByRole('link',{name:/Choose services for this staff member/}).count(),0);assert.deepEqual(await page.evaluate(()=>window.calls[0]),{salonId:'salon-a',staffId:'staff-a',serviceIds:['mani']});
 await page.screenshot({path:out+'/screenshots/staff-services-'+width+'.png',fullPage:true});
 await page.getByRole('link',{name:/Add booking hours for this staff member/}).click();await page.getByLabel('Working hours').fill('10:00–18:00');await page.getByRole('button',{name:'Save changes',exact:true}).click();await page.getByText('Booking setup is complete for this staff member.',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
 await page.goto('http://setup.test/settings?section=salon-salon-b-salon-profile');await page.getByLabel('Salon draft').fill('Keep this draft');
 page.once('dialog',d=>d.dismiss());await page.getByRole('link',{name:'Review staff setup'}).click();assert.equal(await page.getByLabel('Salon draft').inputValue(),'Keep this draft');assert.ok(page.url().includes('salon-salon-b-salon-profile'));
 page.once('dialog',d=>d.accept());await page.getByRole('link',{name:'Review staff setup'}).click();await page.getByRole('link',{name:/Add booking hours for this staff member/}).waitFor();await page.getByRole('link',{name:/Add booking hours for this staff member/}).click();await page.getByLabel('Working hours').waitFor();assert.equal(new URL(page.url()).searchParams.get('section'),'salon-salon-b-booking');
 await page.screenshot({path:out+'/screenshots/staff-hours-'+width+'.png',fullPage:true});assert.deepEqual(errors,[]);await page.close();
 }}finally{await browser.close();}
});
