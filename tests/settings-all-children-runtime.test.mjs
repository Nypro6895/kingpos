import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import ts from 'typescript';
import postcss from 'postcss';import tailwind from '@tailwindcss/postcss';
import {chromium} from 'playwright-core';

const out='artifacts/settings-design-correction/all-pages';
// Only transport is replaced. The fixture bundles the product's actual editors and CSS.
const contents=`import React from 'react';import{createRoot}from'react-dom/client';
import{SettingsChildPages}from'./app/settings/settings-child-pages';
import{AppLocalSalonSettings}from'./components/app-local-salon-settings';
import{StaffAvailabilityEditor}from'./app/booking-setup/booking-setup-editors';
import'./app/booking-setup/booking-setup.css';
import{SalonDetailsPanel,BookingSettingsPanel}from'./app/settings/salon-settings-panels';
import{TeamSettingsPanel,PayrollSettingsPanel}from'./app/settings/team-payroll-panels';
import{OwnershipSettingsPanel,LifecycleSettingsPanel}from'./app/settings/ownership-lifecycle-panels';
import{PosSettingsPanel}from'./app/settings/pos-settings-panel';
import{LoginSecurityPanel}from'./app/settings/login-security/login-security-panel';
import{SalonProfilePreferencesPanel}from'./app/settings/salon-profile-preferences-panel';
import{NotificationPreferencesPanel}from'./app/settings/notification-preferences-panel';
import{ConnectionsPanel}from'./app/settings/connections-panel';
import{BlockedUsersPanel}from'./app/settings/blocked-users-panel';
import{SalonListPanel}from'./app/settings/salon-list-panel';
import{PersonalPublicProfilePanel}from'./app/settings/personal-public-profile-panel';
import{AccountProfileEditor}from'./app/account/account-profile-editor';
import{AccountDeletionPanel}from'./app/account/account-deletion-panel';
import{ShortcutsSettingsPanel}from'./app/settings/shortcuts-settings-panel';
import{ServicesManager}from'./app/services/services-manager';
import'./app/services/services.css';import'./app/settings/direct-settings.css';
const staff={id:'kim',display_name:'Kim',staff_profile_display_name:'Kim',first_name:'Kim',last_name:'Nguyen',is_active:true,job_title:'Nail technician',online_booking_enabled:true,salon_profile_content_posting_enabled:true,profile_display_order:0,bookingStaffIds:[],specialties:[],displayName:"Kim",isActive:true,bookingReady:true};
const user={id:'owner',email:'owner@example.com',first_name:'Giuse',last_name:'Nguyen',display_name:'Giuse',phone:'+13125550123',created_at:'2026-01-01'};
const base={salonId:'one',salonName:'King Nails',canManage:true,canManageSalon:true,canManagePlugins:true};
const profile={...base,kind:'salon-profile',setting:{business_name:'King Nails',phone:'3125550123',email:'salon@example.com',website:'https://example.com',address_line1:'1 Main St',address_line2:'Suite 2',city:'Chicago',state:'IL',postal_code:'60601',country:'US',business_description:'Nail salon'},hours:{status:{kind:'open',isOpen:true,label:'Open',detail:'Until 5 PM'},timeZone:'America/Chicago',weeklyHours:[{dayOfWeek:1,opensAtLocal:'09:00',closesAtLocal:'17:00',sortOrder:0}],specialHours:[]},mapLocation:{address:{formattedAddress:'1 Main St, Chicago IL',cityStateLabel:'Chicago, IL'},status:'unmapped',statusLabel:'Not mapped',refreshEnabled:true,coordinates:null,statusDescription:'Ready'},profileIdentity:{},publicProfileAvailable:false,readiness:{canEnable:true,items:[]}};
const preferences={layout:'booking',show_customer_reviews:true,show_featured:true,show_services:true,show_team:true,allow_staff_posts:true,allow_sharing:true,allow_saves:true,allow_comments:true,customer_review_count:2};
window.writes=[];window.responses={loadBookingRulesSettingsAction:{state:{active:true,subscribed:true,published:true,content:'Please arrive on time.'}},loadBookSmsSettingsAction:{state:{active:true,installed:true,enabled:true,confirmation:true,reminders:true,tokenConfigured:true,accountSid:'fixture',from:'+13125550123'}},loadBookingDepositAction:{state:{active:true,installed:true,subscribed:true,connected:true,enabled:true,mode:'fixed',value:20,checkout:'both'}},loadSalonProfilePreferencesAction:{preferences},loadSalonVerificationAction:{requests:[],error:null},loadSettingsConnections:{salons:[],requests:[],ownerInvites:[],loadedAt:Date.now()},loadBlockedUsers:[],loadSettingsSalonList:{accountId:'business',accounts:[{id:'business',name:'Business'}],salons:[],canCreate:true,createRequestKey:'fixture'},loadPersonalPublicProfileSettings:{bio:'Nail artist',visibility:'public',coverMediaPath:null},loadPluginMarketStatusAction:{rows:[]}};
window.fetch=async(url,options)=>({ok:true,json:async()=>({enabled:true,preferences:{},checkInDefault:false,staffBooking:{salonId:'one',enabled:true}})});
const saved=async()=>{};
const overview={account:user,sessions:[],trustedDevices:[],mfa:{factors:[],unavailableReason:null},preferences:{loginAlertsEnabled:true,smsLoginAlertsEnabled:false,recoveryEmail:null,recoveryPhone:null},smsLoginAlerts:{configured:false},recoveryCodes:{unused:0,total:0,used:0,lastGeneratedAt:null},recoveryRequests:[],activity:[]};
const service={id:'manicure',name:'Manicure',base_price:25,duration_minutes:30,is_active:true,online_booking_enabled:true,category:'Nails',bookingStaffIds:['kim'],addOnServiceIds:[],bookingAddOns:[],readiness:{ready:true,canBook:true,reasons:[],issues:[],missingLabels:[]}};
const items={
 'Salon Settings':<AppLocalSalonSettings data={{...base,setting:profile.setting,lifecycle:{lifecycleStatus:'active',name:'King Nails',status:'active'},operatingSettings:profile.hours,discoveryReadiness:{...profile.readiness,missingLabels:[]},mapLocation:profile.mapLocation,staffDirectory:{staff:[staff]},ownerRoster:{owners:[{id:'owner',name:'Giuse',email:'owner@example.com',isCurrentUser:true,status:'active'}],canLeave:false},closureReview:{canClose:true,blockingRecords:[]},canManageSettings:true,canManageOwnership:true,canManageLifecycle:true,canViewStaff:true,isOwner:true}}/>,
 'Staff working hours':<StaffAvailabilityEditor settingsMode expectedSalonId="one" staff={[staff]} availabilityRules={[]} timeBlocks={[]} timezone="America/Chicago" readinessByStaffId={{}} canManage/>,
 'Salon information':<SalonDetailsPanel data={profile} onSaved={saved}/>,
 'Public profile':<SalonDetailsPanel data={{...profile,kind:'public-profile'}} onSaved={saved}/>,
 'Booking':<BookingSettingsPanel data={{...base,kind:'booking',settings:{timezone:'America/Chicago',online_booking_enabled:true},canManageStaffOnlineBooking:true,setup:{staff:[],availabilityRules:[],timeBlocks:[],timezone:'America/Chicago',readinessByStaffId:{},permissions:{canManageAvailability:true}}}} onSaved={saved}/>,
 'Staff & team':<TeamSettingsPanel data={{...base,kind:'staff-team',staff:[staff],requests:[],canManagePublicTeam:true}} onSaved={saved}/>,
 'Payroll':<PayrollSettingsPanel data={{...base,kind:'payroll',schedule:{cycle_type:'biweekly',biweekly_anchor_date:'2026-11-02'},staff:[{staff,staffProfileDisplayName:'Kim',setting:null}],today:'2026-11-02'}} onSaved={saved}/>,
 'POS & display':<PosSettingsPanel data={{...base,kind:'pos-display',view:{staffCheckInEnabled:true,largeTurnThreshold:50,tipSuggestions:[15,18,20]},snapshot:{},portable:{schemaReady:true,keys:[]},canManagePortable:true}} onSaved={saved}/>,
 'Ownership':<OwnershipSettingsPanel data={{...base,kind:'ownership',roster:{owners:[{id:'owner',name:'Giuse',email:'owner@example.com',isCurrentUser:true}],canLeave:false},invites:[],history:[],historyError:null}} onSaved={saved}/>,
 'Salon status':<LifecycleSettingsPanel data={{...base,kind:'close-salon',lifecycle:{lifecycleStatus:'active'},review:{canClose:true,blockingRecords:[]},closureDetails:{appointments:[],tickets:[]}}} onSaved={saved}/>,
 'Website appearance':<SalonProfilePreferencesPanel expectedSalonId="one"/>,
 'Login & security':<LoginSecurityPanel overview={overview}/>,
 'Notifications':<NotificationPreferencesPanel/>,
 'Connections':<ConnectionsPanel/>,
 'Blocked users':<BlockedUsersPanel/>,
 'Create salon':<SalonListPanel initialCreate createOnly/>,
 'Personal profile':<AccountProfileEditor embedded user={user} createdAtLabel="January 2026"/>,
 'Personal public profile':<PersonalPublicProfilePanel user={user} createdAtLabel="January 2026"/>,
 'Delete account':<AccountDeletionPanel impact={{deletionState:{deletionScheduledFor:null,status:"active"},ownedSalons:[],lastOwnerOperationalSalons:[]}}/>,
 'Shortcuts':<ShortcutsSettingsPanel salonId="one" configuration={{selected:[{id:'book',label:'Book'}],available:[{id:'staff',label:'Staff'}],maxSelected:4}} onSaved={saved}/>,
 'Services & prices':<ServicesManager embedded expectedSalonId="one" initialServiceId={null} data={{canManage:true,services:[service],staff:[staff],addOnLinks:[]}} onSaved={saved}/>
};
window.fixturePages=Object.keys(items);const label=decodeURIComponent(location.hash.slice(1))||'Salon information';createRoot(document.getElementById('root')).render(label==='Salon Settings'?items[label]:<div className="compact-settings settings-hub"><div className="settings-inline-editor"><SettingsChildPages showTitle label={label}>{items[label]}</SettingsChildPages></div></div>);`;

test('actual Settings editors: every reachable nested page renders and fits phone widths, preserving lazy verification and safe writes',{timeout:180000},async()=>{
 fs.mkdirSync(out,{recursive:true});
 const base=await postcss([tailwind()]).process(fs.readFileSync('app/globals.css','utf8'),{from:path.resolve('app/globals.css')});fs.writeFileSync(out+'/base.css',base.css);
 const result=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents},bundle:true,write:false,define:{'process.env':'{}'},format:'iife',platform:'browser',jsx:'automatic',outfile:'fixture.js',plugins:[{name:'transport',setup(b){
  b.onResolve({filter:/workspace-language$/},()=>({path:'language',namespace:'stub'}));
  b.onResolve({filter:/^next\/(navigation|link|image)$/},a=>({path:a.path,namespace:'stub'}));
  b.onLoad({filter:/.*/,namespace:'stub'},a=>({loader:'tsx',resolveDir:process.cwd(),contents:a.path==='language'?`export const WorkspaceElement=({children})=>children;export const WorkspaceText=({text})=>text;export const useWorkspaceTranslation=()=>s=>s;`:a.path==='next/navigation'?`export const useRouter=()=>({refresh(){},push(){},replace(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams();`:`export default function Component({children,href,src,alt,...props}){return href?<a href={href} {...props}>{children}</a>:<img src={src} alt={alt}/>}`}));
  b.onLoad({filter:/\.[jt]sx?$/},a=>{
   if(a.path.includes('node_modules'))return;const source=fs.readFileSync(a.path,'utf8');if(!/^\s*["']use server["']/.test(source))return;
   const file=ts.createSourceFile(a.path,source,ts.ScriptTarget.Latest,true),names=[];
   for(const node of file.statements){if(!node.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword))continue;if(ts.isFunctionDeclaration(node)&&node.name)names.push(node.name.text);if(ts.isVariableStatement(node))for(const d of node.declarationList.declarations)if(ts.isIdentifier(d.name))names.push(d.name.text);}
   return {loader:'js',contents:names.map(name=>`export async function ${name}(...args){window.calls??=[];window.calls.push(${JSON.stringify(name)});if(${JSON.stringify(name)} in window.responses)return window.responses[${JSON.stringify(name)}];window.writes.push({name:${JSON.stringify(name)},args:args.map(a=>a instanceof FormData?Object.fromEntries(a):a)});return window.fail?{ok:false,error:'Save failed; draft kept'}:{ok:true,error:null};}`).join('\n')};
  });
 }}]});
 fs.writeFileSync(out+'/fixture.js',result.outputFiles.find(f=>f.path.endsWith('.js')).text);fs.writeFileSync(out+'/fixture.css',result.outputFiles.find(f=>f.path.endsWith('.css')).text);
 fs.writeFileSync(out+'/index.html','<meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;font:14px Arial;background:#fff}button,input,select,textarea{font:inherit}button{cursor:pointer}h1,h2,h3,h4,p{margin:0}[hidden]{display:none!important}</style><link rel="stylesheet" href="base.css"><link rel="stylesheet" href="fixture.css"><div id="root"></div><script src="fixture.js"></script>');
 const server=createServer((req,res)=>{const name=req.url.endsWith('.js')?'fixture.js':req.url.endsWith('base.css')?'base.css':req.url.endsWith('.css')?'fixture.css':'index.html';res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(path.join(out,name)));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true}),origin='http://127.0.0.1:'+server.address().port,coverage=[];
 try{
  const first=await browser.newPage();first.on("pageerror",e=>console.log("INITIAL",e.message));await first.goto(origin);await first.waitForTimeout(100);const labels=await first.evaluate(()=>window.fixturePages);await first.close();
  for(const width of [320,375,430,768])for(const label of labels){
   const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.stack));await page.goto(origin+'/#'+encodeURIComponent(label));await page.waitForTimeout(100);
   const slug=label.toLowerCase().replace(/[^a-z]+/g,'-');
   async function inspect(trail,depth=0){
    assert.deepEqual(errors,[],label+' '+trail.join('/'));
    if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)){await page.screenshot({path:out+'/overflow.png',fullPage:true});console.log(await page.evaluate(()=>[...document.querySelectorAll('*')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(-12).map(e=>({tag:e.tagName,cls:e.className,w:e.getBoundingClientRect().width,text:e.textContent.slice(0,80)}))));assert.fail(label+' overflow '+width+' '+trail.join('/'));}
    const tracks=await page.locator('.settings-toggle-track:visible').evaluateAll(nodes=>nodes.map(n=>({width:n.getBoundingClientRect().width,label:n.parentElement.getBoundingClientRect().right,right:n.getBoundingClientRect().right})));for(const track of tracks){assert.equal(track.width,36,'Compact switch width');assert.ok(track.label-track.right<16,'Switch must be on the trailing edge');}
    const screenshot=slug+'-'+width+(trail.length?'-'+coverage.length:'')+'.png';if(width===375)await page.screenshot({path:out+'/'+screenshot,fullPage:true});
    coverage.push({label,width,trail,screenshot:width===375?screenshot:null});
    if(depth>=3)return;
    const buttons=page.locator('.settings-child-launch:visible'),names=await buttons.allTextContents();
    for(let i=0;i<names.length;i++){
     await page.locator('.settings-child-launch:visible').nth(i).click();await page.waitForTimeout(30);await inspect([...trail,names[i].trim()],depth+1);await page.locator('.settings-child-back').click();await page.waitForTimeout(30);
    }
   }
   if(label==='Website appearance')assert.equal(await page.evaluate(()=>window.calls?.includes('loadSalonVerificationAction')||false),false,'Verification is lazy');
   await inspect([]);
   if(label==='Website appearance')assert.equal(await page.evaluate(()=>window.calls.filter(c=>c==='loadSalonVerificationAction').length),1);
   if(label==='Salon Settings'){const names=await page.locator('.compact-menu button').allTextContents();for(let i=0;i<names.length;i++){await page.locator('.compact-menu button').nth(i).click();await inspect([names[i].trim()]);await page.locator('.compact-back').click();}}
   if(label==='Staff working hours'){await page.locator('.availability-person-toggle').click();await inspect(['Kim']);await page.locator('.availability-day-toggle').first().click();await inspect(['Kim','Monday']);}
   if(label==='Services & prices'){await page.getByRole('button',{name:'New service',exact:true}).click();await inspect(['New service']);}

   assert.equal(await page.evaluate(()=>window.writes.length),0,'Navigation must never write: '+label);await page.close();
  }
  const actions=await browser.newPage({viewport:{width:375,height:900}});await actions.goto(origin+'/#Salon%20information');await actions.locator('.settings-child-launch').first().click();await actions.getByRole('button',{name:'Description',exact:true}).click();await actions.locator('textarea[name=business_description]').fill('Updated salon story');await actions.evaluate(()=>window.fail=true);await actions.getByRole('button',{name:'Save changes',exact:true}).click();await actions.getByRole('alert').waitFor();assert.equal(await actions.locator('textarea[name=business_description]').inputValue(),'Updated salon story');await actions.evaluate(()=>window.fail=false);await actions.getByRole('button',{name:'Save changes',exact:true}).click();await actions.locator('.settings-child-launch').filter({hasText:'King Nails'}).waitFor({state:'visible'});const savedProfile=await actions.evaluate(()=>window.writes.at(-1));assert.equal(savedProfile.name,'saveDirectSalonProfile');assert.equal(savedProfile.args[0],'one');assert.equal(savedProfile.args[1].business_description,'Updated salon story');assert.equal(savedProfile.args[1].city,'Chicago');assert.equal(savedProfile.args[1].address_line2,'Suite 2');
  await actions.goto(origin+'/?case=payroll#Payroll');await actions.getByRole('button',{name:/Kim/}).click();await actions.locator('input[name=commission_rate]').fill('65');await actions.getByRole('button',{name:'Save changes',exact:true}).click();await actions.getByRole('button',{name:/Kim/}).waitFor();const savedPay=await actions.evaluate(()=>window.writes.at(-1));assert.equal(savedPay.name,'saveDirectPayroll');assert.equal(savedPay.args[0],'one');assert.equal(savedPay.args[1].staffId,'kim');assert.equal(savedPay.args[1].commissionRate,65);assert.equal(savedPay.args[1].effectiveFrom,'2026-11-02');assert.equal(savedPay.args[1].expectedSettingId,null);await actions.goto(origin+'/?case=booking#Booking');await actions.getByRole('button',{name:'Edit booking rules',exact:true}).click();await actions.getByLabel('Booking rules',{exact:true}).fill('Updated rules');assert.equal(await actions.getByRole('button',{name:'Save',exact:true}).count(),1,'Only the current plugin save is visible');await actions.getByRole('button',{name:'Save',exact:true}).click();await actions.getByText('Saved.',{exact:true}).waitFor();const savedRules=await actions.evaluate(()=>window.writes.at(-1));assert.equal(savedRules.name,'saveBookingRulesSettingsAction');assert.equal(savedRules.args[0],'one');assert.equal(savedRules.args[1],'Updated rules');await actions.close();
  fs.writeFileSync(out+'/coverage.json',JSON.stringify(coverage,null,2));
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
