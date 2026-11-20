import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
const output='artifacts/terminology-step1-20261110';
const slot={date:'2026-11-12',startAt:'2026-11-12T15:00:00Z',endAt:'2026-11-12T15:30:00Z',label:'9:00 AM',lines:[{unitPrice:40,durationMinutes:30,staffName:"QA Professional",serviceName:"Manicure",cleanupBufferMinutes:0,displayOrder:0,lineType:"service",parentServiceId:null,serviceId:'service',staffId:'staff',startAt:'2026-11-12T15:00:00Z',endAt:'2026-11-12T15:30:00Z'}]};
const base={state:'ready',title:'Book appointment',message:'',readiness:[],availabilityResolved:true,looks:[],staffByService:{service:['staff']},services:[{id:'service',name:'Manicure',addOnIds:[],isAddOnOnly:false,basePrice:40,durationMinutes:30,category:'Nails',description:null}],staff:[{id:'staff',displayName:'QA Professional',avatarUrl:null,bio:null,jobTitle:null,specialties:[]}],slots:[slot],salon:{salonId:'11111111-1111-4111-8111-111111111111',name:'Local QA salon',city:'Milwaukee',state:'WI',publicProfileEnabled:true,addressLine1:null,email:null,phone:null,coverUrl:null,logoUrl:null,website:null,tagline:null},settings:{anyProfessionalEnabled:false,confirmationMode:'instant_booking',defaultCleanupBufferMinutes:0,guestBookingEnabled:true,maximumAdvanceWindowDays:90,minimumLeadTimeMinutes:0,sameDayBookingEnabled:true,slotIntervalMinutes:30,splitStaffAppointmentEnabled:false,timezoneIana:'America/Chicago'},initialSelection:{serviceId:'service',serviceIds:['service'],staffId:'staff',staffMode:'specific',addOnSelections:[],addOnServiceIds:[],date:'2026-11-12',initialStep:3,startAt:slot.startAt,source:'explore',inspiration:null,lookId:null}};
const entry=`import React from 'react';import{createRoot}from'react-dom/client';import{PublicBookingClient}from'./app/book/[salonId]/public-booking-client';
const params=new URLSearchParams(location.search),scenario=params.get('scenario')??'phone';window.submissions=[];
const user={id:'qa-viewer',displayName:'QA Customer',firstName:'QA',lastName:'Customer',email:'qa@example.test',phone:'+14145550101',avatarUrl:null};
if(scenario==='phone')user.phone=null;if(scenario==='email')user.email=null;if(scenario==='name'){user.displayName=null;user.firstName=null;user.lastName=null;}
window.fixture=${JSON.stringify(base)};const data={...window.fixture,currentUser:scenario==='guest'?null:user};createRoot(document.getElementById('root')).render(<PublicBookingClient data={data} embedded/>);`;
const stubs={
 'next/navigation':'export const useRouter=()=>({push(){},replace(){},refresh(){}});export const usePathname=()=>"/book/qa";',
 '@/components/experience-scope':'export const useExperienceScope=()=>null;',
 '@/lib/use-scoped-ui-draft':'export const useScopedUiDraft=()=>({markEdited(){}});',
 '@/components/overlay-dismissal':'export const useNativeDialogNavigation=()=>{};export const useTransientOverlay=()=>{};',
 '@/lib/public-booking-submit-client':'export const createPublicBookingAction=async input=>{window.submissions.push(input);return{ok:false,message:"Fixture never creates a booking"}};',
 '@/lib/public-booking-availability-client':'export const loadPublicBookingSlotsAction=async()=>window.fixture.slots;export const loadPublicBookingAvailabilityHintsAction=async()=>[];',
 '@/components/booking-card-payment':'export const BookingCardPayment=()=>null;',
 '@/components/rewardlumi/booking-reward-pending':'export const BookingRewardPending=()=>null;'
};
const result=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:entry},bundle:true,write:false,outdir:'fixture',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'local-only-boundaries',setup(b){b.onResolve({filter:/.*/},a=>a.path in stubs?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:stubs[a.path],loader:'js'}));}}]});
const globals=await postcss([tailwind()]).process(fs.readFileSync('app/globals.css','utf8'),{from:'app/globals.css'});
const js=result.outputFiles.find(f=>f.path.endsWith('.js')).text,css=globals.css+'\n'+result.outputFiles.filter(f=>f.path.endsWith('.css')).map(f=>f.text).join('\n');
const server=createServer((req,res)=>{if(req.url==='/app.js'){res.setHeader('content-type','application/javascript');res.end(js);}else{res.setHeader('content-type','text/html');res.end(`<html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:Arial}${css}</style><div id="root"></div><script src="/app.js"></script></html>`);}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
 const page=await browser.newPage({viewport:{width:428,height:926}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const origin='http://127.0.0.1:'+server.address().port,checks=[];
 await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
 for(const scenario of ['phone','name','email','complete','guest']){
  await page.goto(origin+'/?scenario='+scenario);await page.getByTestId('public-booking-root').waitFor();
  if(scenario!=='guest')await page.getByText(scenario==='complete'?'Review your contact details.':`Add your ${scenario==='phone'?'phone number':scenario} to finish booking.`,{exact:true}).waitFor();
  assert.equal(await page.getByText('Contact details saved',{exact:true}).count(),0);
  if(scenario==='phone'){
   await page.screenshot({path:output+'/booking-missing-phone.png'});
   await page.getByTestId('public-booking-next').click();assert.equal(await page.evaluate(()=>window.submissions.length),0,'missing phone must not submit');
   await page.locator('#public-booking-phone').fill('+14145550101');await page.getByText('Review your contact details.',{exact:true}).waitFor();
   for(const width of [320,390,428]){await page.setViewportSize({width,height:926});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'no horizontal overflow at '+width);}
   await page.setViewportSize({width:428,height:926});await page.screenshot({path:output+'/booking-phone-entered.png'});
  }
  assert.equal(await page.evaluate(()=>window.submissions.length),0);checks.push(scenario);
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(output+'/booking-browser.json',JSON.stringify({checks,errors,boundary:'Real booking client with local fixture data and mocked remote actions; no hosted, physical-iPhone or completed-transaction claim'},null,2));console.log('Passed browser scenarios: '+checks.join(', '));
}finally{await browser.close();await new Promise(r=>server.close(r));}
