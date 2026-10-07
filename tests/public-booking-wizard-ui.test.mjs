import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
import {readFileSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

test('focused booking wizard keeps selections, caches reads and recovers from a slot conflict', {
  skip: !process.env.ESBUILD_MODULE_PATH || !process.env.TEST_BROWSER_PATH, timeout:120000
},async()=>{
  const {build}=await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
  const fixture=`import React from 'react';import{createRoot}from'react-dom/client';import{PublicBookingClient}from'./app/book/[salonId]/public-booking-client';import{QuickBooking}from'./components/quick-booking';
  window.calls={slots:[],hints:[],create:[],navigations:[],contexts:0};
  const service=(id,name,price,duration,extra=false)=>({id,name,basePrice:price,durationMinutes:duration,isAddOnOnly:extra,addOnIds:id==='full'?['art']:[],category:'Nails',description:null});
  const data={state:'ready',salon:{salonId:'salon',name:'King Nails',logoUrl:null,coverUrl:null,city:'Milwaukee',state:'WI',publicProfileEnabled:true},settings:{anyProfessionalEnabled:true,splitStaffAppointmentEnabled:true,guestBookingEnabled:true,confirmationMode:'instant_booking',timezoneIana:'America/Chicago',maximumAdvanceWindowDays:60,minimumLeadTimeMinutes:120,slotIntervalMinutes:30,sameDayBookingEnabled:true},currentUser:null,services:[service('full','Full-Set',40,45),service('gel','Gel Polish',25,20),service('art','Nail art',5,5,true)],staff:[{id:'tracy',displayName:'Tracy',avatarUrl:null},{id:'lucy',displayName:'Lucy',avatarUrl:null}],staffByService:{full:['tracy'],gel:['lucy'],art:['tracy']},slots:[],initialSelection:{serviceId:null,serviceIds:[],staffId:null,staffMode:'any',date:'2099-10-02',addOnSelections:[],addOnServiceIds:[],initialStep:0,source:'explore',inspiration:null}};
  const scenario=new URLSearchParams(location.search).get('scenario');
  if(scenario==='restricted'){data.settings.anyProfessionalEnabled=false;data.settings.splitStaffAppointmentEnabled=false;data.settings.guestBookingEnabled=false;data.staffByService.gel=['tracy'];}
  if(scenario==='signed-in')data.currentUser={id:'user',displayName:'Jane Doe',firstName:'Jane',lastName:'Doe',email:'jane@example.com',phone:'4145551234'};
  if(scenario==='draft-guest'||scenario==='draft-incomplete-account'){
    if(scenario==='draft-incomplete-account')data.currentUser={id:'user',displayName:null,firstName:null,lastName:null,email:'',phone:''};
    sessionStorage.setItem('kingpos.publicBookingDraft.salon',JSON.stringify({version:2,customer:{firstName:'Jane',lastName:'Doe',email:'jane@example.com',phone:'4145551234',notes:'Keep my design'},date:'2099-10-02',identityMode:'guest',inspirationId:null,inspirationRemoved:false,lineStaffByKey:{},selectedAddOnSelections:[],selectedServiceIds:['full'],selectedSlotStart:'2099-10-02T14:30:00.000Z',staffId:'tracy',staffMode:'specific',step:3}));
  }
  window.data=data;
  window.makeSlots=(selection)=>{const services=selection.serviceIds.flatMap(id=>[data.services.find(s=>s.id===id),...(selection.addOnSelections??[]).filter(a=>a.parentServiceId===id).map(a=>data.services.find(s=>s.id===a.serviceId))]);return [0,1,2,3,4,5].map((n)=>{let start=new Date(selection.date+'T14:30:00Z');start.setUTCMinutes(start.getUTCMinutes()+n*30);let cursor=+start;const lines=services.map((s,index)=>{const begin=cursor;cursor+=s.durationMinutes*60000;return{serviceId:s.id,serviceName:s.name,staffId:selection.lineStaffIds?.[index]||data.staffByService[s.id][0],staffName:s.id==='gel'?'Lucy':'Tracy',unitPrice:s.basePrice,durationMinutes:s.durationMinutes,startAt:new Date(begin).toISOString(),endAt:new Date(cursor).toISOString(),lineType:s.isAddOnOnly?'add_on':'service'};});return{date:selection.date,startAt:start.toISOString(),endAt:new Date(cursor).toISOString(),label:new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit',timeZone:'America/Chicago'}).format(start),lines};});};
  if(scenario?.startsWith('quick')||scenario==='staff-only'){data.currentUser={id:'user',displayName:'Nene',firstName:'Nene',lastName:'Doe',email:'nene@example.com',phone:'4145551234'};data.initialSelection.staffId='tracy';data.initialSelection.staffMode='specific';if(scenario!=='staff-only'){data.initialSelection.inspiration={id:'post',title:'Full-Set inspiration',status:'ready',sourceType:'beauty_post',originalStaffId:'tracy',staffId:'tracy',serviceId:'full',message:null};data.initialSelection.serviceId='full';data.initialSelection.serviceIds=['full'];data.initialSelection.initialStep=scenario==='quick-slot'?3:2;data.slots=window.makeSlots({serviceIds:['full'],date:data.initialSelection.date});if(scenario==='quick-slot')data.initialSelection.startAt=data.slots[2].startAt;}if(scenario==='quick-next-day')data.slots=[];window.fetch=async()=>{window.calls.contexts++;return new Response(JSON.stringify(data),{status:200});};}
  if(scenario==='quick-empty'){data.slots=[];data.availabilityResolved=true;}
  if(scenario==='quick-guest'||scenario==='quick-restricted-guest'){
    data.currentUser=null;data.initialSelection.initialStep=3;data.initialSelection.startAt=data.slots[2].startAt;
    if(scenario==='quick-restricted-guest')data.settings.guestBookingEnabled=false;
  }
  createRoot(document.getElementById('root')).render(location.pathname==='/login'?<p>Sign in</p>:scenario?.startsWith('quick')||scenario==='staff-only'?<><a href='/book/1650370b-f86d-461e-8d97-6210052eeed7?inspiration=1650370b-f86d-461e-8d97-6210052eeed7'>Book this look</a><QuickBooking/></>:<PublicBookingClient data={data}/>);`;
  const built=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:fixture},bundle:true,write:false,outdir:'fixture',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'actions',setup(b){ b.onResolve({filter:/explore-account-actions$/},()=>({path:"account",namespace:"account-stub"})); b.onLoad({filter:/.*/,namespace:"account-stub"},()=>({contents:"export const useExploreAuthenticated=()=>false;"}));
    b.onResolve({filter:/app\/book\/actions$|public-booking-availability-client$|public-booking-submit-client$|next\/navigation$/},args=>({path:args.path,namespace:'stub'}));
    b.onLoad({filter:/.*/,namespace:'stub'},args=>({loader:'js',contents:args.path==='next/navigation'?'export const usePathname=()=>location.pathname;export const useRouter=()=>({replace:href=>window.calls.navigations.push(href)});':`const delay=()=>new Promise(r=>setTimeout(r,70));export async function loadPublicBookingSlotsAction(input){window.calls.slots.push(input);await delay();return window.makeSlots(new URLSearchParams(location.search).get('scenario')==='quick-next-day'&&input.selection.findEarliest?{...input.selection,date:'2099-10-04'}:input.selection);}export async function loadPublicBookingAvailabilityHintsAction(input){window.calls.hints.push(input);await delay();return input.scopes.map(s=>({key:s.key,status:'available',startAt:'2099-10-02T14:30:00Z'}));}export async function createPublicBookingAction(input){window.calls.create.push(input);await delay();if(window.failAuth)return{ok:false,code:'account_session_changed',message:'Please sign in again to confirm this booking. Your selection is saved.'};return window.calls.create.length===1&&!new URLSearchParams(location.search).get('scenario')?.startsWith('quick')?{ok:false,code:'unavailable_slot',message:'That time is no longer available.'}:{ok:true,bookingId:'booking',accountLinked:new URLSearchParams(location.search).get('scenario')?.startsWith('quick')===true&&!new URLSearchParams(location.search).get('scenario')?.includes('guest'),manageToken:'secure-token',confirmationStatus:'confirmed',message:'Your booking is confirmed.'};}`}));
  }}]});
  const js=built.outputFiles.find(f=>f.path.endsWith('.js')).text;
  const bundledCss=built.outputFiles.find(f=>f.path.endsWith('.css'))?.text??'';
  const globalCss=readFileSync('app/globals.css','utf8');
  const css=(await postcss([tailwind()]).process(globalCss,{from:'app/globals.css'})).css+'\n'+bundledCss;
  const server=createServer((req,res)=>{if(req.url==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(js);}else if(req.url==='/fixture.css'){res.setHeader('Content-Type','text/css');res.end(css);}else res.end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH,headless:true});
  await mkdir('artifacts/booking-wizard-qa',{recursive:true});
  try{for(const width of [375,1280,320]){
    const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:'+server.address().port);
    const full=page.getByRole('checkbox',{name:'Full-Set',exact:true});await full.waitFor();
    if(await full.isChecked()) await page.getByRole('button',{name:/Options/}).click();else await full.check();
    const options=page.getByRole('dialog',{name:'Full-Set options'});await options.waitFor();await options.getByRole('checkbox',{name:'Nail art',exact:true}).check();await options.getByRole('button',{name:'Done',exact:true}).click();
    await page.getByRole('checkbox',{name:'Gel Polish',exact:true}).check();
    assert.equal(await page.getByRole('checkbox',{name:'Full-Set',exact:true}).isChecked(),true);
    await page.screenshot({path:`artifacts/booking-wizard-qa/${width}-services.png`});
    await page.getByTestId('public-booking-next').click();await page.getByRole('heading',{name:'Choose staff',exact:true}).waitFor();
    await page.getByRole('radio',{name:'Full-Set: Tracy',exact:true}).check();await page.getByRole('radio',{name:'Gel Polish: Lucy',exact:true}).check();await page.getByRole('radio',{name:'Nail art: Tracy',exact:true}).check();
    await page.screenshot({path:`artifacts/booking-wizard-qa/${width}-staff.png`});
    await page.getByTestId('public-booking-next').click();await page.getByTestId('public-booking-slot').first().waitFor();
    await page.getByTestId('public-booking-slot').nth(1).click();
    const firstDate=await page.getByRole('button',{name:/Oct 2/}).getAttribute('aria-label');
    await page.getByRole('button',{name:/Oct 3/}).click();await page.getByTestId('public-booking-slot').first().waitFor();
    const before=await page.evaluate(()=>window.calls.slots.length);
    await page.getByLabel('Choose another date').fill('2099-10-02');await page.getByTestId('public-booking-slot').first().waitFor();
    assert.equal(await page.evaluate(()=>window.calls.slots.length),before,'returning to a recently loaded date reuses slots');
    assert.ok(firstDate);await page.screenshot({path:`artifacts/booking-wizard-qa/${width}-time.png`});
    await page.getByTestId('public-booking-next').click();await page.getByRole('heading',{name:'Review & confirm',exact:true}).waitFor();
    await page.getByLabel('First name').fill('Jane');await page.getByLabel('Last name').fill('Doe');await page.getByLabel('Phone',{exact:false}).fill('4145551234');await page.getByLabel('Email',{exact:false}).fill('jane@example.com');
    assert.match(await page.locator('main').textContent(),/\$70/);
    await page.screenshot({path:`artifacts/booking-wizard-qa/${width}-confirm.png`});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.getByTestId('public-booking-next').click();await page.getByRole('heading',{name:'Choose start time',exact:true}).waitFor();
    await page.getByTestId('public-booking-slot').first().waitFor();
    assert.ok(await page.evaluate(()=>window.calls.slots.length)>before,'conflict invalidates the cached availability');
    await page.getByTestId('public-booking-next').click();assert.equal(await page.getByLabel('First name').inputValue(),'Jane');
    await page.getByTestId('public-booking-next').click();await page.getByRole('heading',{name:'Booking confirmed',exact:true}).waitFor();
    assert.equal(await page.getByRole('link',{name:'Manage booking',exact:true}).getAttribute('href'),new URL('/booking/manage/secure-token',page.url()).href);
    const payload=await page.evaluate(()=>window.calls.create.at(-1));assert.deepEqual(payload.serviceIds,['full','gel']);assert.equal(payload.staffMode,'split');assert.deepEqual(payload.lineStaffIds,['tracy','tracy','lucy']);assert.equal(payload.addOnSelections.length,1);assert.deepEqual(errors,[]);
    await page.close();
  }
  for(const width of [375,1280,320])for(const scenario of ['quick-time','quick-slot','staff-only','quick-next-day']){
    const page=await browser.newPage({viewport:{width,height:900},timezoneId:scenario==='quick-next-day'?'Asia/Ho_Chi_Minh':'America/Chicago'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:'+server.address().port+'/?scenario='+scenario);
    await page.getByRole('link',{name:'Book this look',exact:true}).click();
    const popup=page.getByRole('dialog',{name:'Quick booking',exact:true});await popup.waitFor();await page.getByTestId('public-booking-root').waitFor();
    assert.equal(await page.getByTestId('public-booking-stepper').count(),0);
    assert.equal(await page.evaluate(()=>window.calls.contexts),1,'prefetch and click reuse the same private context request');
    if(scenario==='staff-only'){
      assert.equal(await popup.getByRole('checkbox',{name:'Gel Polish',exact:true}).count(),1,'additional services can use another staff member');
      await popup.getByRole('checkbox',{name:'Full-Set',exact:true}).check();await popup.getByRole('dialog',{name:'Full-Set options'}).getByRole('button',{name:'Done',exact:true}).click();
      await page.getByTestId('public-booking-next').click();await page.getByTestId('public-booking-slot').first().waitFor();
      assert.equal(await popup.getByRole('radio').count(),0,'known staff skips staff selection');
    }else if(scenario==='quick-time'||scenario==='quick-next-day'){
      await page.getByTestId('public-booking-slot').first().waitFor();if(scenario==='quick-next-day'){assert.equal(await page.locator('input[type=date]').inputValue(),'2099-10-04');assert.equal(await page.evaluate(()=>window.calls.slots.length),1,'first read must search earliest and avoid reloading its result');assert.equal(await page.evaluate(()=>window.calls.slots[0].selection.findEarliest),true);assert.match(await page.getByTestId('public-booking-slot').first().textContent(),/9:30 AM/,'Vietnam device must retain salon appointment hours');}await page.getByTestId('public-booking-slot').nth(2).click();
      await page.screenshot({path:`artifacts/booking-wizard-qa/${width}-quick-time.png`});
      await page.getByTestId('public-booking-next').click();
    }
    if(scenario!=='staff-only'){
      await page.getByRole('button',{name:'Confirm booking',exact:true}).waitFor();
      assert.match(await popup.textContent(),/Full-Set/);assert.match(await popup.textContent(),/Tracy/);
      await page.screenshot({path:`artifacts/booking-wizard-qa/${width}-${scenario}-confirm.png`});
      await page.getByTestId('public-booking-next').click();await popup.getByRole('status').filter({hasText:'Your appointment is confirmed.'}).waitFor();
      assert.equal(await popup.getByText('Your details',{exact:true}).count(),0);
      assert.equal(await popup.getByText('Required *',{exact:true}).count(),0);
      assert.equal(await popup.getByRole('button',{name:'Close booking',exact:true}).count(),1);
      assert.doesNotMatch(await popup.textContent(),/&check;/);
      assert.deepEqual(await page.evaluate(()=>window.calls.navigations),[],'quick confirmation stays on Explore');
      assert.equal(await page.getByRole('link',{name:'View booking',exact:true}).getAttribute('href'),'/my-bookings?details=booking');
      assert.equal(await page.evaluate(()=>window.calls.create[0].staffId),'tracy');
      assert.equal(await page.evaluate(()=>window.calls.create[0].inspirationId),'post');assert.equal(await page.evaluate(()=>window.calls.create[0].sourceReferenceType),'beauty_post');
      if(scenario==='quick-slot')assert.equal(await page.evaluate(()=>window.calls.create[0].startAt),await page.evaluate(()=>window.data.initialSelection.startAt));
    }
    const bounds=await popup.boundingBox();assert.ok(bounds.height<=900*.91);if(width>=768){assert.ok(Math.abs(bounds.x+bounds.width/2-width/2)<2,'desktop popup is centered');assert.ok(Math.abs(bounds.y+bounds.height/2-450)<2);}else{assert.ok(Math.abs(bounds.width-width)<2,'mobile sheet fills viewport width');assert.ok(Math.abs(bounds.y+bounds.height-900)<2,'mobile sheet is anchored to bottom');}
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.deepEqual(errors,[]);await popup.getByRole('button',{name:'Close booking',exact:true}).first().click();await popup.waitFor({state:'hidden'});await page.close();
  }
  {
    const page=await browser.newPage({viewport:{width:375,height:900}});
    await page.goto('http://127.0.0.1:'+server.address().port+'/?scenario=quick-add-services');
    await page.getByRole('link',{name:'Book this look',exact:true}).click();
    const popup=page.getByRole('dialog',{name:'Quick booking',exact:true});
    assert.match(await popup.getByRole('button',{name:'+ Add more',exact:true}).locator('..').textContent(),/Full-Set/,'Add more belongs beside selected services');
    await popup.getByRole('button',{name:'+ Add more',exact:true}).click();
    assert.equal(await popup.getByRole('checkbox',{name:'Full-Set',exact:true}).isChecked(),true,'adding services retains the booked look');
    await popup.getByRole('checkbox',{name:'Gel Polish',exact:true}).check();
    await page.getByTestId('public-booking-next').click();
    await popup.getByRole('button',{name:'+ Add more',exact:true}).waitFor();
    assert.equal(await popup.getByRole('radio',{name:'Full-Set: Tracy',exact:true}).isChecked(),true,'original staff remains selected when another service is added');
    await popup.getByRole('radio',{name:'Gel Polish: Lucy',exact:true}).check();
    await page.getByTestId('public-booking-next').click();
    await page.getByTestId('public-booking-slot').first().waitFor();
    await page.getByTestId('public-booking-next').click();
    await popup.getByRole('button',{name:'+ Add more',exact:true}).waitFor();
    assert.match(await popup.textContent(),/1 hr 5 min/);
    await page.getByTestId('public-booking-next').click();
    await page.waitForFunction(()=>window.calls.create.length===1);
    assert.deepEqual(await page.evaluate(()=>window.calls.create[0].serviceIds),['full','gel']);
    assert.deepEqual(await page.evaluate(()=>window.calls.create[0].lineStaffIds),['tracy','lucy']);
    await page.close();
  }
  {
    const page=await browser.newPage({viewport:{width:375,height:900}});
    await page.goto('http://127.0.0.1:'+server.address().port+'/?scenario=quick-slot');
    await page.getByRole('link',{name:'Book this look',exact:true}).click();
    await page.getByRole('button',{name:'Confirm booking',exact:true}).waitFor();
    await page.evaluate(()=>{window.failAuth=true;});
    await page.getByTestId('public-booking-next').click();
    const signIn=page.getByRole('link',{name:'sign in',exact:true});
    await signIn.waitFor();
    assert.equal(await signIn.locator('..').getAttribute('role'),'alert','sign-in link appears beside the session error');
    const href=await signIn.getAttribute('href');
    const returnPath=new URL(href,page.url()).searchParams.get('next');
    assert.match(returnPath,/^\/book\/salon\?/);
    assert.equal(new URL(returnPath,page.url()).searchParams.get('inspiration'),'post');
    const draft=await page.evaluate(()=>Object.values(sessionStorage).map(v=>{try{return JSON.parse(v);}catch{return null;}}).find(v=>v?.selectedServiceIds));
    assert.deepEqual(draft.selectedServiceIds,['full']);assert.equal(draft.staffId,'tracy');assert.equal(draft.step,3);
    await signIn.click();
    assert.match(page.url(),/\/login\?next=/);
    // Simulate the login redirect in this fixture; no real login or booking is sent.
    await page.goto(new URL(returnPath,page.url()).href);
    await page.getByRole('heading',{name:'Review & confirm',exact:true}).waitFor();
    await page.getByText('Tracy · 45 min',{exact:true}).waitFor();
    assert.match(await page.getByTestId('public-booking-root').textContent(),/Full-Set/);
    assert.match(await page.getByTestId('public-booking-root').textContent(),/Tracy/);
    await page.close();
  }
  {
    const page=await browser.newPage({viewport:{width:375,height:900}});
    await page.goto('http://127.0.0.1:'+server.address().port+'/?scenario=staff-only');
    await page.getByRole('link',{name:'Book this look',exact:true}).click();
    const popup=page.getByRole('dialog',{name:'Quick booking',exact:true});
    await popup.getByRole('checkbox',{name:'Full-Set',exact:true}).check();
    await popup.getByRole('dialog',{name:'Full-Set options'}).getByRole('button',{name:'Done',exact:true}).click();
    await popup.getByRole('checkbox',{name:'Gel Polish',exact:true}).check();
    await page.getByTestId('public-booking-next').click();
    const original=popup.getByRole('radio',{name:'Full-Set: Tracy',exact:true});
    await original.waitFor();
    assert.equal(await original.isChecked(),true,'staff entry keeps Tracy for Full-Set');
    assert.equal(await popup.getByRole('radio',{name:'Gel Polish: Lucy',exact:true}).isChecked(),false,'unassigned service requires an explicit choice');
    await popup.getByRole('radio',{name:'Gel Polish: Lucy',exact:true}).check();
    await page.getByTestId('public-booking-next').click();
    await page.getByTestId('public-booking-slot').first().waitFor();
    await page.getByTestId('public-booking-next').click();
    await popup.getByRole('button',{name:'Confirm booking',exact:true}).waitFor();
    await page.getByTestId('public-booking-next').click();
    await page.waitForFunction(()=>window.calls.create.length===1);
    assert.deepEqual(await page.evaluate(()=>window.calls.create[0].lineStaffIds),['tracy','lucy']);
    await page.close();
  }
  {
    const page=await browser.newPage({viewport:{width:375,height:900}});
    await page.goto('http://127.0.0.1:'+server.address().port+'/?scenario=quick-empty');
    await page.getByRole('link',{name:'Book this look',exact:true}).click();
    await page.getByTestId('public-booking-root').waitFor();
    await page.getByText('No available times for this selection.',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.calls.slots.length),0,'a resolved empty initial result must not be fetched again');
    assert.equal(await page.evaluate(()=>window.calls.contexts),1);
    await page.close();
  }
  for(const scenario of ['quick-guest','quick-restricted-guest']){
    const page=await browser.newPage({viewport:{width:375,height:900}});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto('http://127.0.0.1:'+server.address().port+'/?scenario='+scenario);
    await page.getByRole('link',{name:'Book this look',exact:true}).click();
    const popup=page.getByRole('dialog',{name:'Quick booking',exact:true});
    await popup.getByRole('button',{name:'Confirm booking',exact:true}).waitFor();
    assert.equal(await popup.getByRole('link',{name:/^Sign in to autofill/}).count(),1);
    if(scenario==='quick-restricted-guest'){
      assert.equal(await page.getByTestId('public-booking-next').isDisabled(),true);
      assert.equal(await page.evaluate(()=>window.calls.create.length),0);
    }else{
      await popup.getByLabel('First name',{exact:false}).fill('Jane');
      await popup.getByLabel('Last name',{exact:false}).fill('Doe');
      await popup.getByLabel('Phone',{exact:false}).fill('4145551234');
      await popup.getByLabel('Email',{exact:false}).fill('jane@example.com');
      await page.getByTestId('public-booking-next').click();
      await popup.getByText('Your appointment is confirmed.',{exact:true}).waitFor();
      assert.equal(await popup.locator('input:visible,textarea:visible').count(),0,'confirmed guest bookings must not expose unsaved editable contact fields');
      assert.equal(await popup.getByRole('link',{name:/^Sign in to autofill/}).count(),0);
      assert.equal(await page.evaluate(()=>window.calls.create[0].expectedAccountId),null);
      assert.equal(await popup.getByRole('link',{name:'View booking',exact:true}).getAttribute('href'),new URL('/booking/manage/secure-token',page.url()).href);
      assert.deepEqual(await page.evaluate(()=>window.calls.navigations),[]);
    }
    assert.deepEqual(errors,[]);
    await page.close();
  }
  for(const scenario of ['draft-guest','draft-incomplete-account']){
    const page=await browser.newPage({viewport:{width:375,height:900}});
    await page.goto('http://127.0.0.1:'+server.address().port+'/?scenario='+scenario);
    await page.getByRole('heading',{name:'Review & confirm',exact:true}).waitFor();
    assert.equal(await page.getByLabel('First name',{exact:false}).inputValue(),'Jane','login restore keeps a name absent from the account');
    assert.equal(await page.getByLabel('Last name',{exact:false}).inputValue(),'Doe');
    assert.equal(await page.getByLabel('Email',{exact:false}).inputValue(),'jane@example.com');
    assert.equal(await page.getByLabel('Phone',{exact:false}).inputValue(),'4145551234');
    await page.close();
  }
  {
    const page=await browser.newPage({viewport:{width:375,height:900}});
    await page.goto('http://127.0.0.1:'+server.address().port+'/?scenario=quick-slot');
    await page.getByRole('link',{name:'Book this look',exact:true}).click();
    await page.getByRole('button',{name:'Confirm booking',exact:true}).waitFor();
    await page.evaluate(()=>{window.failAuth=true;Storage.prototype.setItem=()=>{throw new DOMException('Storage blocked','SecurityError');};});
    await page.getByTestId('public-booking-next').click();
    await page.getByRole('link',{name:'sign in',exact:true}).waitFor({timeout:3000});
    assert.equal(await page.getByTestId('public-booking-next').isDisabled(),true,'an expired session remains blocked even when draft storage is unavailable');
    await page.close();
  }
  for(const scenario of ['restricted','signed-in']){
    const page=await browser.newPage({viewport:{width:375,height:900}});
    await page.goto('http://127.0.0.1:'+server.address().port+'/?scenario='+scenario);
    await page.getByTestId('public-booking-next').click();
    if(scenario==='restricted'){
      assert.equal(await page.getByRole('radio',{name:/Any available/}).count(),0);
      assert.equal(await page.getByTestId('public-booking-next').isDisabled(),true);
      await page.getByRole('radio',{name:'Full-Set: Tracy',exact:true}).check();
    }
    await page.getByTestId('public-booking-next').click();await page.getByTestId('public-booking-slot').first().waitFor();
    await page.getByTestId('public-booking-slot').first().click();
    await page.getByTestId('public-booking-next').click();await page.getByRole('heading',{name:'Review & confirm',exact:true}).waitFor();
    assert.equal(await page.getByLabel('First name',{exact:false}).count(),0);
    if(scenario==='restricted')assert.equal(await page.getByTestId('public-booking-next').isDisabled(),true);
    else {assert.equal(await page.getByTestId('public-booking-next').isDisabled(),false);assert.match(await page.locator('main').textContent(),/Jane Doe/);}
    await page.close();
  }
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
