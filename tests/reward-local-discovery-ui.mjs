import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';

/** Component acceptance harness; Next Link and workspace scope adapters only.
 * Pass real RPC data to exercise the production component against PostgreSQL.
 */
export async function checkRewardDiscoveryUI({discover,owner,program,setup,output='artifacts/reward-practical-v3/browser'}={}){
 fs.mkdirSync(output,{recursive:true});
 const bundle=await build({entryPoints:['tests/helpers/reward-local-discovery-ui.tsx'],bundle:true,write:false,outdir:'bundle',platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{
  name:'next-test-adapters',setup(b){
   b.onResolve({filter:/^next\/link$/},()=>({path:'link',namespace:'adapter'}));
   b.onResolve({filter:/^next\/image$/},()=>({path:'image',namespace:'adapter'}));
   b.onResolve({filter:/^@\/components\/experience-scope$/},()=>({path:'scope',namespace:'adapter'}));
   b.onLoad({filter:/.*/,namespace:'adapter'},args=>({contents:args.path==='link'?'import React from "react"; export default function Link({prefetch,children,...props}){return React.createElement("a",props,children)}':args.path==='image'?'import React from "react"; export default function Image(props){return React.createElement("img",props)}':'export function useExperienceScope(){return null}',loader:'js',resolveDir:process.cwd()}));
  }
 }]});
 const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text,css=bundle.outputFiles.find(f=>f.path.endsWith('.css')).text;
 let paused=false,failed=false,slow=false,slowDetails=false,promoVariant="normal";
 const sample={id:'00000000-0000-4000-8000-000000000001',name:'Nearest rewards',city:'Chicago',state:'IL',distanceMiles:null,spendCents:2000,spendPoints:20,welcomePoints:10,firstBookingPoints:20,visitPoints:0,conversionPoints:30,version:1,canBook:true,serviceCategories:['Nails'],offers:[{id:'five-off',title:'$5 off',points:100,valueCents:500,minimumCents:4000,serviceName:null}]};
 const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://localhost');
  try{
   if(u.pathname==='/bundle.js'){res.setHeader('content-type','text/javascript');return res.end(js)}
   if(u.pathname==='/bundle.css'){res.setHeader('content-type','text/css');return res.end(css)}
   if(u.pathname==='/images/rewards/nail-care-rewards-v1.webp'){res.setHeader('content-type','image/webp');return res.end(fs.readFileSync('public'+u.pathname));}
   if(u.pathname==='/fixture/promo'){promoVariant=u.searchParams.get('variant')||'normal';return res.end('{}');}
   if(u.pathname==='/broken-cover.webp'){res.statusCode=404;return res.end();}
   if(u.pathname==='/api/rewards/program'){
    let result=paused?{salon:null}:program?await program(u.searchParams.get('salonId')):{salon:{...sample},joined:false,available:null,authenticated:!req.headers.referer?.includes('mode=guest'),earningEligibility:{spend:true,visit:false,welcome:true,firstBooking:true,beforeAfter:true}};
    if(!program&&result.salon){
     if(promoVariant==='consumed'){result={...result,joined:true,authenticated:true,available:100,salon:{...sample,spendPoints:0,conversionPoints:0},earningEligibility:{spend:false,visit:false,welcome:false,firstBooking:false,beforeAfter:false}};}
     if(promoVariant==='no-book')result.salon={...sample,canBook:false,serviceCategories:['Hair']};
     if(promoVariant==='broken-cover')result.salon={...sample,coverImageSource:'salon',coverImageUrl:'/broken-cover.webp'};
     if(promoVariant==='stale-auth')result.authenticated=true;
    }
    res.setHeader('content-type','application/json');if(slowDetails)return setTimeout(()=>res.end(JSON.stringify(result)),700);return res.end(JSON.stringify(result));
   }
   if(u.pathname==='/fixture/owner'){let raw='';for await(const chunk of req)raw+=chunk;const{op,args}=JSON.parse(raw);res.setHeader('content-type','application/json');try{return res.end(JSON.stringify(await setup(op,args)));}catch(error){res.statusCode=400;return res.end(JSON.stringify({error:error.message}));}}
   if(u.pathname==='/fixture/concurrent-save'){const loaded=await setup('load',{});const updated=await setup('save',{program:{...loaded.program,welcomePoints:21},expectedVersion:loaded.version});return res.end(JSON.stringify(updated));}
   if(u.pathname==='/api/rewards/discover'){
    if(failed){res.statusCode=503;return res.end('{}')}
    const result=paused?{salons:[],hasMore:false}:discover?await discover(u.searchParams):{salons:u.searchParams.get('location')?.startsWith('Chicago')?[sample]:[],hasMore:false};
    res.setHeader('content-type','application/json');if(slow&&u.searchParams.get('location')?.startsWith('Chicago'))return setTimeout(()=>res.end(JSON.stringify(result)),700);return res.end(JSON.stringify(result));
   }
   if(u.pathname==='/api/rewards/owner-discovery'){res.setHeader('content-type','application/json');return res.end(JSON.stringify(owner?await owner():{salonId:sample.id,enabled:false,nearby:false,located:true,discoverable:false,reasons:[],periodStart:'2026-10-04',periodEnd:'2026-11-02',discountCents:0,members:0,paidConversions:0,rewardUses:0}))}
   res.setHeader('content-type','text/html');res.end('<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/bundle.css"><body style="margin:0"><div id="root"></div><script src="/bundle.js"></script></body></html>');
  }catch(e){res.statusCode=500;res.end(JSON.stringify({error:String(e)}))}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.getByRole('button',{name:'View rewards at Nearest rewards'}).waitFor();
  await page.screenshot({path:path.join(output,'customer-mobile.png'),fullPage:true});
  await page.getByRole('button',{name:'View rewards at Nearest rewards'}).click();await page.getByRole('dialog').waitFor();
  assert.doesNotMatch(await page.getByRole('dialog').innerText(),/100 points|\$40.00/);assert.equal(await page.getByRole('dialog').getByRole('link',{name:'My rewards',exact:true}).count(),0);
  await page.getByRole('heading',{name:/Book a visit. Earn rewards.|Make your next visit rewarding./}).waitFor();if(await page.getByRole('dialog').locator('img').count())await page.getByRole('dialog').locator('img').evaluate(img=>img.decode());
  await page.screenshot({path:path.join(output,'promo-mobile.png'),fullPage:true});
  await page.getByRole('dialog').getByText('How to earn & reward terms',{exact:true}).click();assert.match(await page.getByRole('dialog').innerText(),/another guest.*fully paid/s);assert.match(await page.getByRole('dialog').innerText(),/remainder does not carry forward/);
  await page.screenshot({path:path.join(output,'customer-details-mobile.png'),fullPage:true});
  await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='View rewards at Nearest rewards');
  await page.getByRole('button',{name:'Find shops with rewards'}).click();await page.getByRole('button',{name:'Before & After',exact:true}).click();
  await page.getByRole('button',{name:'View rewards at Nearest rewards'}).waitFor();await page.getByRole('button',{name:'View rewards at Nearest rewards'}).click();await page.getByRole('heading',{name:'Share your look. Earn rewards.'}).waitFor();await page.keyboard.press('Escape');
  await page.getByLabel('Test area').selectOption('Madison, WI');await page.getByRole('button',{name:'Find local rewards',exact:true}).click();await page.getByText(/No participating shops/).waitFor();
  assert.equal(await page.getByRole('button',{name:'View rewards at Nearest rewards'}).count(),0);
  await page.getByLabel('Test area').selectOption('');await page.getByRole('button',{name:'Choose area',exact:true}).waitFor();
  await page.getByRole('button',{name:'Choose area',exact:true}).click();await page.getByRole('button',{name:'View rewards at Nearest rewards'}).waitFor();
  slow=true;await page.getByRole('button',{name:'Find shops with rewards'}).click();await page.getByRole('button',{name:'Welcome points',exact:true}).click();await page.getByLabel('Test area').selectOption('Madison, WI');await page.getByRole('button',{name:'Find local rewards',exact:true}).click();await page.getByText(/No participating shops/).waitFor();await page.waitForTimeout(800);assert.equal(await page.getByRole('button',{name:'View rewards at Nearest rewards'}).count(),0);slow=false;
  await page.getByLabel('Test area').selectOption('Chicago, IL');await page.getByRole('button',{name:'View rewards at Nearest rewards'}).waitFor();
  paused=true;await page.getByRole('button',{name:'View rewards at Nearest rewards'}).click();await page.getByText(/no longer in the current list/).waitFor();assert.equal(await page.getByRole('dialog').isVisible(),false);paused=false;
  await page.getByRole('button',{name:'Hide reward suggestions for this session'}).click();await page.getByRole('button',{name:'Find local rewards',exact:true}).waitFor();
  assert.equal(await page.getByTestId('unchanged-search').isVisible(),true);
  await page.getByRole('button',{name:'Find local rewards',exact:true}).click();await page.getByRole('button',{name:'View rewards at Nearest rewards'}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  failed=true;await page.reload();await page.getByRole('button',{name:'Find local rewards',exact:true}).click();await page.getByRole('button',{name:'Try again',exact:true}).waitFor();failed=false;await page.getByRole('button',{name:'Try again',exact:true}).click();await page.getByRole('button',{name:'View rewards at Nearest rewards'}).waitFor();
  await page.setViewportSize({width:1280,height:900});await page.screenshot({path:path.join(output,'customer-desktop.png'),fullPage:true});
  await page.goto(origin+'?mode=owner');await page.getByRole('link',{name:/Preview & set up rewards|Manage rewards/}).waitFor();await page.screenshot({path:path.join(output,'owner-prompt.png'),fullPage:true});
  await page.getByRole('button',{name:'Later',exact:true}).click();assert.equal(await page.getByRole('link',{name:/Preview & set up rewards|Manage rewards/}).count(),0);
  await page.goto(origin+'?mode='+(setup?'setup-real':'setup'));await page.getByRole('button',{name:'Activate local rewards',exact:true}).waitFor();
  assert.equal(await page.getByLabel('Complete spend threshold per receipt ($)',{exact:true}).isVisible(),false);assert.equal(await page.evaluate(()=>window.rewardSetupStats.saves),0);
  await page.getByText('Ready for local discovery after you confirm.',{exact:true}).waitFor();await page.getByRole('heading',{name:'Customer preview'}).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,'owner-preview.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(output,'owner-preview-mobile.png'),fullPage:true});await page.setViewportSize({width:1280,height:900});
  await page.getByRole('button',{name:'Activate local rewards',exact:true}).click();await page.getByText('Saved · visible in local reward discovery.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.rewardSetupStats.saves),1);
  if(setup){await page.request.post(origin+'/fixture/concurrent-save');await page.getByRole('button',{name:'Save changes',exact:true}).click();await page.getByRole('alert').filter({hasText:'changed in another session'}).waitFor();await page.getByRole('button',{name:'Reload latest settings (replace this draft)',exact:true}).click();await page.getByText('Customize earning rules',{exact:true}).click();await page.waitForFunction(()=>document.querySelector('input[aria-label="One-time welcome points"]')?.value==='21');}
  await page.goto(origin);await page.getByRole('button',{name:'View rewards at Nearest rewards'}).click();const action=page.getByRole('dialog').locator('a,button').filter({hasText:/^(Book a visit|Explore this salon)$/});await action.waitFor();const actionTarget=await action.getAttribute('href')||await action.getAttribute('data-booking-href');assert.match(actionTarget,/^\/(book|explore\/salons)\//);const chosenSalonId=new URL(actionTarget,origin).pathname.split('/').at(-1);await page.getByRole('dialog').getByText('Chicago, IL',{exact:true}).waitFor();await page.keyboard.press('Escape');
  await page.goto(origin+'/explore/salons/'+chosenSalonId);await page.getByRole('region',{name:'Salon rewards',exact:true}).waitFor();assert.doesNotMatch(await page.getByRole('region',{name:'Salon rewards',exact:true}).innerText(),/100 points|\$40.00/);await page.screenshot({path:path.join(output,'salon-continuity.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.goto(origin+'?mode=guest');await page.getByRole('button',{name:'View rewards at Nearest rewards'}).click();await page.getByRole('link',{name:'Create an account',exact:true}).waitFor();const signup=await page.getByRole('link',{name:'Create an account',exact:true}).getAttribute('href');assert.match(new URLSearchParams(signup.split('?')[1]).get('next'),/^\/(book|explore\/salons)\//);assert.equal(await page.getByRole('link',{name:'My rewards',exact:true}).count(),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);if(await page.getByRole('dialog').locator('img').count())await page.getByRole('dialog').locator('img').evaluate(img=>img.decode());await page.screenshot({path:path.join(output,'promo-guest-mobile.png'),fullPage:true});
  if(!program){
   await page.goto(origin);await page.evaluate(()=>window.addEventListener('reylumi:quick-book',e=>window.bookingIntent={href:e.detail.href,rewardOpen:Boolean(document.querySelector('dialog[open]'))},{once:true}));await page.getByRole('button',{name:'View rewards at Nearest rewards'}).click();await page.getByRole('button',{name:'Book a visit',exact:true}).click();await page.waitForFunction(()=>window.bookingIntent);assert.equal((await page.evaluate(()=>window.bookingIntent)).rewardOpen,false);
   await page.request.get(origin+'/fixture/promo?variant=consumed');await page.goto(origin);await page.getByRole('button',{name:'View rewards at Nearest rewards'}).click();await page.getByRole('heading',{name:'Your rewards at this salon',exact:true}).waitFor();await page.getByRole('link',{name:'My rewards',exact:true}).waitFor();assert.doesNotMatch(await page.getByRole('dialog').innerText(),/can earn|receive your/);await page.screenshot({path:path.join(output,'returning-member.png'),fullPage:true});
   await page.request.get(origin+'/fixture/promo?variant=no-book');await page.goto(origin+'?mode=guest');await page.getByRole('button',{name:'View rewards at Nearest rewards'}).click();await page.getByRole('dialog').getByRole('link',{name:'Explore this salon',exact:true}).waitFor();assert.equal(await page.getByRole('dialog').getByRole('button',{name:'Book a visit',exact:true}).count(),0);assert.equal(await page.getByRole('dialog').locator('img').count(),0);await page.getByRole('img',{name:'Salon rewards illustration'}).waitFor();await page.screenshot({path:path.join(output,'hair-no-booking.png'),fullPage:true});
   await page.setViewportSize({width:320,height:568});await page.getByRole('dialog').getByRole('link',{name:'Explore this salon',exact:true}).scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(output,'small-phone.png'),fullPage:true});await page.setViewportSize({width:390,height:844});
   await page.request.get(origin+'/fixture/promo?variant=broken-cover');await page.goto(origin);await page.getByRole('button',{name:'View rewards at Nearest rewards'}).click();await page.waitForFunction(()=>document.querySelector('dialog img')?.getAttribute('src')==='/images/rewards/nail-care-rewards-v1.webp');await page.getByRole('dialog').locator('img').evaluate(img=>img.decode());
   await page.request.get(origin+'/fixture/promo?variant=stale-auth');await page.goto(origin+'?mode=guest');await page.getByRole('button',{name:'View rewards at Nearest rewards'}).click();await page.getByRole('dialog').waitFor();assert.equal(await page.getByRole('link',{name:'Create an account',exact:true}).count(),0);
   await page.request.get(origin+'/fixture/promo?variant=normal');await page.goto(origin);await page.getByRole('button',{name:'Find shops with rewards'}).click();slowDetails=true;await page.getByRole('button',{name:'View rewards at Nearest rewards'}).click();await page.getByRole('button',{name:'Service spend',exact:true}).click();await page.waitForTimeout(850);assert.equal(await page.getByRole('dialog').isVisible(),false);await page.getByRole('button',{name:'View rewards at Nearest rewards'}).click();await page.getByRole('button',{name:'Hide reward suggestions for this session'}).click();await page.waitForTimeout(850);assert.equal(await page.getByRole('dialog').isVisible(),false);await page.getByRole('button',{name:'Find local rewards',exact:true}).click();await page.getByRole('button',{name:'View rewards at Nearest rewards'}).click();await page.getByRole('button',{name:'Choose nearby city or ZIP',exact:true}).click();await page.waitForTimeout(850);assert.equal(await page.getByRole('dialog').isVisible(),false);slowDetails=false;
  }
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({passed:true,backend:discover?'real isolated PostgreSQL via component harness':'synthetic component transport',checks:['auto discovery','popup terms','Escape/focus','reward filter','committed area switch','missing location','paused recheck','dismiss/reopen','failure/retry','mobile overflow','owner prompt/dismiss','owner preview','image-led promo without visible currency','guest signup retains salon context','consumed one-time benefits','no-booking Hair fallback','small phone','broken public cover fallback','authoritative account state','stale details cancelled on filter/hide/area chooser','booking intent closes reward modal first'],runtimeErrors:errors},null,2));
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1')))await checkRewardDiscoveryUI();
