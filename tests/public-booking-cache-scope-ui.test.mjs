import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';

test('availability cache separates services, professionals and refreshed salon timezones', {skip:!process.env.ESBUILD_MODULE_PATH||!process.env.TEST_BROWSER_PATH,timeout:60000},async()=>{
 const {build}=await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
 // Reuse the synthetic salon fixture; all data readers and mutations remain mocked.
 const existing=readFileSync('tests/public-booking-wizard-ui.test.mjs','utf8');
 const declaration=existing.slice(existing.indexOf('  const fixture='),existing.indexOf('  const built=await build('));
 let fixture=new Function(declaration+';return fixture;')();
 fixture=fixture.replace("createRoot(document.getElementById('root')).render(",`data.settings.maximumAdvanceWindowDays=36500;data.staffByService.full=['tracy','lucy'];data.initialSelection={...data.initialSelection,serviceId:'full',serviceIds:['full'],staffId:'tracy',staffMode:'specific',dateExplicit:true,initialStep:2};window.fixtureRoot=createRoot(document.getElementById('root'));window.fixtureRoot.render(`);
 fixture+=`window.changeTimezone=timezone=>{window.data={...window.data,settings:{...window.data.settings,timezoneIana:timezone}};window.fixtureRoot.render(<PublicBookingClient data={window.data}/>);};`;
 const built=await build({stdin:{contents:fixture,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,outdir:'fixture',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'isolated-actions',setup(b){
  b.onResolve({filter:/explore-account-actions$/},()=>({path:'account',namespace:'account'}));b.onLoad({filter:/.*/,namespace:'account'},()=>({contents:'export const useExploreAuthenticated=()=>false;'}));
  b.onResolve({filter:/app\/book\/actions$|public-booking-availability-client$|public-booking-submit-client$|next\/navigation$/},a=>({path:a.path,namespace:'mock'}));
  b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='next/navigation'?'export const usePathname=()=>location.pathname;export const useRouter=()=>({replace:()=>{}});':`export async function loadPublicBookingSlotsAction(input){window.calls.slots.push({...input,timezone:window.data.settings.timezoneIana});await new Promise(r=>setTimeout(r,30));return window.makeSlots(input.selection);}export async function loadPublicBookingAvailabilityHintsAction(input){window.calls.hints.push({...input,timezone:window.data.settings.timezoneIana});return input.scopes.map(s=>({key:s.key,status:'available',startAt:'2099-10-02T14:30:00Z'}));}export async function createPublicBookingAction(){throw Error('This read-only fixture must not submit bookings');}`}));
 }}]});
 const js=built.outputFiles.find(f=>f.path.endsWith('.js')).text,css=built.outputFiles.find(f=>f.path.endsWith('.css'))?.text??'';
 const server=createServer((req,res)=>{if(req.url==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(js);}else if(req.url==='/fixture.css'){res.setHeader('Content-Type','text/css');res.end(css);}else res.end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH,headless:true});
  const context=await browser.newContext({viewport:{width:375,height:900},timezoneId:'Asia/Ho_Chi_Minh'});
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.getByTestId('public-booking-slot').first().waitFor();
  assert.equal(await page.evaluate(()=>window.calls.slots.at(-1).selection.staffId),'tracy');
  await page.getByRole('button',{name:'Back to previous step',exact:true}).click();
  await page.getByRole('radio',{name:'Full-Set: Lucy',exact:true}).check();
  await page.getByTestId('public-booking-next').click();await page.getByTestId('public-booking-slot').first().waitFor();
  assert.ok(await page.evaluate(()=>{const s=window.calls.slots.at(-1).selection;return s.staffId==='lucy'||s.lineStaffIds.includes('lucy');}),'changing professional fetches their availability');
  await page.getByRole('button',{name:'Back to previous step',exact:true}).click();
  await page.getByRole('button',{name:'Back to previous step',exact:true}).click();
  await page.getByRole('checkbox',{name:'Full-Set',exact:true}).uncheck();await page.getByRole('checkbox',{name:'Gel Polish',exact:true}).check();
  await page.getByTestId('public-booking-next').click();await page.getByTestId('public-booking-slot').first().waitFor();
  assert.deepEqual(await page.evaluate(()=>window.calls.slots.at(-1).selection.serviceIds),['gel']);
  await page.waitForFunction(()=>window.calls.hints.at(-1)?.selection.serviceIds[0]==='gel'&&window.calls.hints.at(-1)?.timezone==='America/Chicago',{},{timeout:3000});
  const callsBeforeZone=await page.evaluate(()=>window.calls.slots.length);
  await page.evaluate(()=>window.changeTimezone('America/New_York'));
  await page.waitForFunction(n=>window.calls.slots.length>n,callsBeforeZone,{timeout:3000});
  assert.equal(await page.evaluate(()=>window.calls.slots.at(-1).timezone),'America/New_York','refreshing salon timezone must not reuse Chicago availability');
  await page.waitForFunction(()=>window.calls.hints.at(-1)?.timezone==='America/New_York',{},{timeout:3000});
  await page.getByTestId('public-booking-slot').first().waitFor();assert.deepEqual(errors,[]);
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
});
