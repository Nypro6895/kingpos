import http from 'node:http';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';

// Actual fixed-build Next pages and API, with a loopback gateway to this test's
// isolated Auth/PostgREST. No public sockets, provider calls or production env.
export async function rewardPracticalApp(f,{owner,customer,salon,account}){
 const output='artifacts/reward-practical-v3/actual-app';fs.mkdirSync(output,{recursive:true});
 const buildDir=process.env.KINGPOS_BUILD_OUTPUT||'.next';
 if(!fs.existsSync(buildDir+'/prerender-manifest.json')||fs.existsSync(buildDir+'/lock'))throw Error('Finish the production build before running actual-app acceptance.');
 const buildId=fs.readFileSync(buildDir+'/BUILD_ID','utf8');
 const gateway=http.createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://fixture');let raw='';for await(const c of req)raw+=c;
   const auth=url.pathname.startsWith('/auth/v1/'),storage=url.pathname.startsWith('/storage/v1/');
   const prefix=auth?'/auth/v1':storage?'/storage/v1':'/rest/v1';
   if(!url.pathname.startsWith(prefix+'/')){res.statusCode=404;return res.end('{}');}
   const bearer=req.headers.authorization?.replace(/^Bearer /,'');
   const token=bearer?.split('.').length===3?bearer:undefined;
   const extra=['prefer','accept','range','content-type'].filter(k=>req.headers[k]).map(k=>'header = '+JSON.stringify(k+': '+req.headers[k]));
   const config=['url = '+JSON.stringify('http://127.0.0.1:'+(auth?9999:storage?5000:3000)+url.pathname.slice(prefix.length)+url.search),'request = '+JSON.stringify(req.method),'silent','show-error','include','max-time = 20',...extra,token?'header = '+JSON.stringify('Authorization: Bearer '+token):'',raw?'data = '+JSON.stringify(raw):''].filter(Boolean).join('\n');
   const response=await new Promise((resolve,reject)=>{
    const p=spawn(process.env.TEST_DOCKER_PATH||'C:/Program Files/Docker/Docker/resources/bin/docker.exe',['--context',process.env.TEST_DOCKER_CONTEXT||'desktop-linux','exec','-i',f.evidence.containers.db,'curl','--config','-'],{windowsHide:true});let output='';p.stdout.on('data',v=>output+=v);p.on('error',reject);p.on('close',code=>code===0?resolve(output):reject(Error('Fixture gateway request failed')));p.stdin.end(config);
   });
   const separator=response.includes('\r\n\r\n')?'\r\n\r\n':'\n\n',offset=response.indexOf(separator),head=response.slice(0,offset);
   res.statusCode=Number(head.match(/^HTTP\/\S+ (\d+)/)?.[1]||500);res.setHeader('content-type','application/json');res.end(response.slice(offset+separator.length));
  }catch{res.statusCode=500;res.end('{"error":"Isolated gateway unavailable"}');}
 });
 await new Promise((resolve,reject)=>{gateway.once('error',reject);gateway.listen(4079,'127.0.0.1',resolve);});
 const app=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p','4087','-H','127.0.0.1'],{cwd:process.cwd(),windowsHide:true,env:{...process.env,REYLUMI_DISABLE_BACKGROUND_DISPATCH:'1',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:4079',NEXT_PUBLIC_SUPABASE_ANON_KEY:'isolated-build-not-a-live-key'}});
 let logs='';app.stdout.on('data',v=>logs+=v);app.stderr.on('data',v=>logs+=v);
 let browser;const pages=[];
 try{
  for(let i=0;i<60&&!logs.includes('Ready in');i++){if(app.exitCode!==null)throw Error('Next server exited');await new Promise(resolve=>setTimeout(resolve,250));}
  if(!logs.includes('Ready in'))throw Error('Next server did not become ready');
  browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const origin='http://localhost:4087',errors=[];
  const ownerContext=await browser.newContext({viewport:{width:1280,height:900}}),customerContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  async function cookies(context,actor,manage){await context.addCookies([
   {name:'sb-access-token',value:actor.token,url:origin,httpOnly:true,sameSite:'Lax'},
   {name:'kingpos-selected-workspace',value:manage?'manage:'+salon:'personal',url:origin,sameSite:'Lax'},
   {name:'kingpos-current-manage-salon-id',value:salon,url:origin,sameSite:'Lax'},
   {name:'kingpos-current-account-id',value:account,url:origin,sameSite:'Lax'},
  ]);}
  await cookies(ownerContext,owner,true);await cookies(customerContext,customer,false);
  const op=await ownerContext.newPage(),cp=await customerContext.newPage();
  pages.push(['owner',op],['customer',cp]);
  for(const page of[op,cp]){page.setDefaultTimeout(45000);page.on('pageerror',e=>errors.push(e.message));}
  await op.goto(origin+'/reward-system',{timeout:120000});await op.getByRole('button',{name:'Save changes',exact:true}).waitFor();
  await op.getByRole('button',{name:'Save changes',exact:true}).click();await op.getByText('Saved · visible in local reward discovery.',{exact:true}).waitFor();await op.screenshot({path:output+'/owner-actual.png',fullPage:true});
  const search=await cp.request.get(origin+'/api/rewards/discover?location=Chicago%2C%20IL&kind=all');assert.equal(search.status(),200);assert.ok((await search.json()).salons.some(s=>s.id===salon));
  const privateOwner=await cp.request.get(origin+'/api/rewards/owner-discovery');assert.equal(privateOwner.status(),403);
  const details=await cp.request.get(origin+'/api/rewards/program?salonId='+salon);const noBooking=await details.json();assert.equal(noBooking.authenticated,true);assert.equal(noBooking.salon.canBook,false);assert.equal(noBooking.earningEligibility.welcome,false);
  await cp.goto(origin+'/explore?location=Chicago%2C%20IL',{timeout:120000});await cp.getByRole('button',{name:'View rewards at Nearest rewards',exact:true}).click();await cp.getByRole('dialog').getByRole('link',{name:'Explore this salon',exact:true}).waitFor();await cp.getByRole('dialog').locator('img').evaluate(img=>img.decode());await cp.getByRole('dialog').getByText('Chicago, IL',{exact:true}).waitFor();assert.doesNotMatch(await cp.getByRole('dialog').innerText(),/100 points|\$40.00/);assert.equal(await cp.getByRole('dialog').getByRole('button',{name:'Book a visit',exact:true}).count(),0);await cp.screenshot({path:output+'/explore-actual-mobile.png',fullPage:true});await cp.getByRole('dialog').getByRole('link',{name:'Explore this salon',exact:true}).click();await cp.getByRole('region',{name:'Salon rewards',exact:true}).waitFor();await cp.getByRole('region',{name:'Salon rewards',exact:true}).getByRole('link',{name:'My rewards',exact:true}).waitFor();assert.doesNotMatch(await cp.getByRole('region',{name:'Salon rewards',exact:true}).innerText(),/100 points|\$40.00/);await cp.screenshot({path:output+'/salon-actual-mobile.png',fullPage:true});
  await cp.getByRole('region',{name:'Salon rewards',exact:true}).getByRole('link',{name:'My rewards',exact:true}).click();await cp.locator('[data-reward-wallet]').getByText('Nearest rewards',{exact:true}).waitFor();assert.equal(await cp.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await cp.screenshot({path:output+'/wallet-actual-mobile.png',fullPage:true});
  const guestContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const gp=await guestContext.newPage();pages.push(['guest',gp]);gp.setDefaultTimeout(45000);gp.on('pageerror',e=>errors.push(e.message));
  await gp.goto(origin+'/explore?location=Chicago%2C%20IL',{timeout:120000});await gp.getByRole('button',{name:'View rewards at Nearest rewards',exact:true}).click();await gp.getByRole('link',{name:'Create an account',exact:true}).waitFor();await gp.getByRole('dialog').locator('img').evaluate(img=>img.decode());const nextHref=await gp.getByRole('link',{name:'Create an account',exact:true}).getAttribute('href');assert.equal(new URLSearchParams(nextHref.split('?')[1]).get('next'),'/explore/salons/'+salon+'#salon-rewards');await gp.screenshot({path:output+'/guest-promo-actual-mobile.png',fullPage:true});await gp.getByRole('link',{name:'Create an account',exact:true}).click();await gp.waitForURL('**/signup?**');await gp.getByRole('heading',{name:/create|sign up/i}).waitFor();
  // Only owned fixture configuration changes: no real booking, payment or dispatch.
  const staff=f.rest(owner,'/staff','POST',{salon_id:salon,display_name:'Booking professional',is_active:true,online_booking_enabled:true})[0].id;
  const service=f.json(`select to_jsonb(id) from services where salon_id='${salon}' limit 1`);
  f.rest(owner,'/services?id=eq.'+service,'PATCH',{online_booking_enabled:true,duration_minutes:45});
  f.rest(owner,'/staff_service_assignments','POST',{salon_id:salon,staff_id:staff,service_id:service,is_active:true,online_bookable:true});
  f.rest(owner,'/staff_availability_rules','POST',Array.from({length:7},(_,day)=>({salon_id:salon,staff_id:staff,rule_type:'working',day_of_week:day,starts_at_local:'08:00',ends_at_local:'18:00',is_active:true})));
  f.rest(owner,'/booking_settings?salon_id=eq.'+salon,'PATCH',{booking_enabled:true,online_booking_visible:true,timezone_iana:'America/Chicago',minimum_lead_time_minutes:0,same_day_booking_enabled:true,guest_booking_enabled:true,any_professional_enabled:true,confirmation_email_enabled:false,confirmation_sms_enabled:false,reminder_enabled:false});
  const bookable=await (await cp.request.get(origin+'/api/rewards/program?salonId='+salon)).json();assert.equal(bookable.salon.canBook,true);
  await cp.goto(origin+'/explore?location=Chicago%2C%20IL');await cp.getByRole('button',{name:'View rewards at Nearest rewards',exact:true}).click();await cp.getByRole('dialog').getByRole('button',{name:'Book a visit',exact:true}).waitFor();assert.equal(await cp.getByRole('dialog').getByRole('button',{name:'Book a visit',exact:true}).getAttribute('data-booking-href'),'/book/'+salon+'?source=explore');await cp.screenshot({path:output+'/bookable-actual-mobile.png',fullPage:true});await cp.getByRole('dialog').getByRole('button',{name:'Book a visit',exact:true}).click();const quick=cp.getByRole('dialog',{name:'Quick booking',exact:true});await quick.locator('header strong').filter({hasText:'Choose services'}).waitFor();assert.equal(await quick.count(),1);assert.equal(await cp.locator('dialog[open]').count(),1);await quick.getByRole('button',{name:'Continue',exact:true}).click();await quick.locator('header strong').filter({hasText:/Choose staff|Choose a time|Confirm booking/}).waitFor();await cp.screenshot({path:output+'/booking-entry-actual-mobile.png',fullPage:true});
  await gp.goto(origin+'/explore?location=Chicago%2C%20IL');await gp.getByRole('button',{name:'View rewards at Nearest rewards',exact:true}).click();const bookNext=await gp.getByRole('link',{name:'Create an account',exact:true}).getAttribute('href');assert.equal(new URLSearchParams(bookNext.split('?')[1]).get('next'),'/book/'+salon+'?source=explore');await gp.keyboard.press('Escape');await gp.getByRole('button',{name:'Find shops with rewards',exact:true}).click();await gp.getByRole('button',{name:'Before & After',exact:true}).click();await gp.getByRole('button',{name:'View rewards at Nearest rewards',exact:true}).click();await gp.getByRole('heading',{name:'Share your look. Earn rewards.',exact:true}).waitFor();assert.equal(await gp.getByRole('dialog').getByRole('button',{name:'Book a visit',exact:true}).count(),0);await gp.getByRole('dialog').getByRole('link',{name:'Explore this salon',exact:true}).waitFor();await gp.screenshot({path:output+'/referral-actual-mobile.png',fullPage:true});
  assert.deepEqual(errors,[]);assert.equal(fs.readFileSync(buildDir+'/BUILD_ID','utf8'),buildId);fs.writeFileSync(output+'/result.json',JSON.stringify({passed:true,buildId,checks:['actual Next owner load/preview/versioned save','actual named-area API','customer denied owner aggregate','actual authenticated Explore → popup → salon Reward context','actual member wallet navigation','mobile overflow','guest promotional image and signup with salon return context','no booking without workforce/settings','direct booking only after actual readiness','real booking wizard entry','referral filter stays referral and avoids own-booking CTA'],runtimeErrors:errors},null,2));
 }catch(error){for(const[name,page]of pages){try{fs.writeFileSync(output+'/failed-'+name+'.txt',f.redact(await page.locator('body').innerText()));await page.screenshot({path:output+'/failed-'+name+'.png',fullPage:true});}catch{}}throw error;
 }finally{
  if(browser)await browser.close();app.kill();await new Promise(resolve=>{if(app.exitCode!==null)return resolve();app.once('exit',resolve);});gateway.closeAllConnections();await new Promise(resolve=>gateway.close(resolve));fs.writeFileSync(output+'/next.log',f.redact(logs));
 }
}
