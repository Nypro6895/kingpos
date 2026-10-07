import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
import {readFileSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

test('guest management uses compact receipt and loads editing times only on demand', {skip:!process.env.ESBUILD_MODULE_PATH||!process.env.TEST_BROWSER_PATH,timeout:120000},async()=>{
  const {build}=await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
  const contents=`import React from 'react';import{createRoot}from'react-dom/client';import{GuestManageClient}from'./app/booking/manage/[token]/guest-manage-client';
    window.calls={slots:[],reschedule:[],cancel:[],claim:[],navigation:[]};
    const line={serviceId:'full',serviceName:'Full-Set',staffId:'david',staffName:'David',unitPrice:40,durationMinutes:45,lineType:'service',startAt:'2099-10-03T14:00:00Z',endAt:'2099-10-03T14:45:00Z'};
    window.line=line;
    const data={ok:true,slots:[],booking:{booking:{id:'booking',salonId:'salon',status:'pending',confirmationStatus:'pending',startAt:line.startAt,endAt:line.endAt,timezone:'America/Chicago',canChange:true,publicNotes:'Please keep this inspiration.'},salon:{name:'King Nails',addressLine1:'8333 W Appleton Ave',city:'Milwaukee',state:'Wisconsin',phone:'4145551234'},customer:{name:'Ny Tr',email:'ny@example.com',phone:'4145551234'},lines:[line],inspiration:null}};
    const currentUser=new URLSearchParams(location.search).has('signed')?{id:'user',displayName:'Ny',email:'ny@example.com'}:null;
    createRoot(document.getElementById('root')).render(<GuestManageClient token='secure-token' claimIntent={Boolean(currentUser)} currentUser={currentUser} data={data}/>);`;
  const built=await build({stdin:{contents,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,outdir:'fixture',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'stub',setup(b){
    b.onResolve({filter:/app\/book\/actions$|next\/navigation$/},a=>({path:a.path,namespace:'stub'}));
    b.onLoad({filter:/.*/,namespace:'stub'},a=>({loader:'js',contents:a.path==='next/navigation'?'export const useRouter=()=>({replace:href=>window.calls.navigation.push(href)});':`export async function loadGuestManageSlotsAction(input){window.calls.slots.push(input);await new Promise(r=>setTimeout(r,60));return[{startAt:input.date+'T16:00:00Z',endAt:input.date+'T16:45:00Z',label:'11:00 AM',lines:[{...window.line,startAt:input.date+'T16:00:00Z',endAt:input.date+'T16:45:00Z'}]}];}export async function rescheduleGuestBookingAction(input){window.calls.reschedule.push(input);return{ok:true,status:'pending',message:'Time updated.'};}export async function cancelGuestBookingAction(input){window.calls.cancel.push(input);return{ok:true,message:'Appointment cancelled.'};}export async function claimGuestBookingAction(input){window.calls.claim.push(input);return{ok:true,bookingId:'booking',message:'Saved.'};}`}));
  }}]});
  const css=(await postcss([tailwind()]).process(readFileSync('app/globals.css','utf8'),{from:'app/globals.css'})).css+'\n'+built.outputFiles.find(f=>f.path.endsWith('.css')).text;
  const server=createServer((req,res)=>{if(req.url==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(built.outputFiles.find(f=>f.path.endsWith('.js')).text);}else if(req.url==='/fixture.css'){res.setHeader('Content-Type','text/css');res.end(css);}else res.end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH,headless:true});
  await mkdir('artifacts/guest-manage-qa',{recursive:true});
  try{
    for(const width of [320,375,1280]){
      const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto('http://127.0.0.1:'+server.address().port);await page.getByRole('heading',{name:'Booking details'}).waitFor();
      assert.equal(await page.evaluate(()=>window.calls.slots.length),0,'reading a receipt must not load reschedule slots');
      assert.equal(await page.getByLabel('Date',{exact:true}).count(),0);assert.equal(await page.getByLabel('Reason (optional)').count(),0);
      assert.match(await page.locator('main').textContent(),/\$40\.00/);
      assert.ok((await page.getByRole('link',{name:'Sign in',exact:true}).getAttribute('href')).includes(encodeURIComponent('/booking/manage/secure-token?claim=1')));
      await page.screenshot({path:'artifacts/guest-manage-qa/'+width+'-receipt.png'});
      await page.getByRole('button',{name:'Reschedule',exact:true}).click();await page.getByRole('button',{name:'11:00 AM',exact:true}).click();await page.getByRole('button',{name:'Save new time',exact:true}).click();await page.getByRole('status').filter({hasText:'Time updated.'}).waitFor();
      assert.match(await page.locator('main').textContent(),/11:00 AM/);assert.equal(await page.getByRole('button',{name:'Save new time',exact:true}).count(),0);
      await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByRole('button',{name:'Keep booking',exact:true}).click();assert.equal(await page.evaluate(()=>window.calls.cancel.length),0);
      await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByLabel('Reason (optional)').fill('Unable to attend');await page.getByRole('button',{name:'Confirm cancellation',exact:true}).click();await page.getByRole('status').filter({hasText:'Appointment cancelled.'}).waitFor();
      assert.equal(await page.getByRole('button',{name:'Reschedule',exact:true}).count(),0);assert.equal(await page.evaluate(()=>window.calls.cancel[0].token),'secure-token');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);await page.close();
    }
    const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port+'/?signed=1');await page.getByRole('button',{name:'Save booking to account',exact:true}).click();await page.waitForFunction(()=>window.calls.navigation.length===1);assert.match(await page.evaluate(()=>window.calls.navigation[0]),/^\/my-bookings\?details=booking/);await page.close();
  }finally{await browser.close();await new Promise(r=>server.close(r));}
});
