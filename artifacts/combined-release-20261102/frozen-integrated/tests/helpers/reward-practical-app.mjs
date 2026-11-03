import http from 'node:http';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {randomUUID} from 'node:crypto';

// Actual fixed-build Next pages and API, with a loopback gateway to this test's
// isolated Auth/PostgREST. No public sockets, provider calls or production env.
export async function rewardPracticalApp(f,{owner,customer,salon,account}){
 const output=process.env.REWARD_ACTUAL_OUTPUT||'artifacts/reward-experience/actual-app';fs.mkdirSync(output,{recursive:true});
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
 let browser;const pages=[],diagnostics={gps:{requests:[],responses:[],failures:[],dom:null,probes:[]}};
 try{
  for(let i=0;i<60&&!logs.includes('Ready in');i++){if(app.exitCode!==null)throw Error('Next server exited');await new Promise(resolve=>setTimeout(resolve,250));}
  if(!logs.includes('Ready in'))throw Error('Next server did not become ready');
  browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const origin='http://localhost:4087',errors=[],blockedNetwork=[];
  const ownerContext=await browser.newContext({viewport:{width:1280,height:900}}),customerContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  async function isolateNetwork(context){await context.route('**/*',route=>{const url=new URL(route.request().url());if([origin,'http://127.0.0.1:4079'].includes(url.origin))return route.continue();blockedNetwork.push(url.origin);return route.abort('blockedbyclient');});}
  await isolateNetwork(ownerContext);await isolateNetwork(customerContext);
  let postScreenshot=0;
  async function openReward(page){
   const home=page.locator('[data-testid="explore-home-content"]:visible');await home.waitFor();
   const fresh=home.getByTestId('explore-fresh-editorial');await fresh.waitFor();await fresh.scrollIntoViewIfNeeded();
   await page.mouse.wheel(0,350);
   const post=page.getByRole('region',{name:'Salon rewards at Nearest rewards',exact:true});
   await post.waitFor();
   assert.equal(await home.evaluate(el=>{const fresh=el.querySelector('[data-testid="explore-fresh-editorial"]'),post=el.querySelector('[data-reward-discovery]');return Boolean(fresh&&post&&(fresh.compareDocumentPosition(post)&Node.DOCUMENT_POSITION_FOLLOWING));}),true,'Reward post follows Fresh looks in the real home feed');
   await post.locator('img').evaluateAll(images=>Promise.all(images.map(image=>image.decode().catch(()=>{}))));
   await post.screenshot({path:output+`/post-${++postScreenshot}-actual-mobile.png`});
   const photo=post.getByRole('button',{name:'View rewards at Nearest rewards',exact:true});
   await (await photo.count()?photo:post.getByRole('button',{name:'How rewards work',exact:true})).click();
   await page.getByRole('dialog').waitFor();
  }
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
  await cp.goto(origin+'/explore?browse=1&location=Chicago%2C%20IL',{timeout:120000});await openReward(cp);
  await cp.getByRole('dialog').getByRole('link',{name:'Explore this salon',exact:true}).waitFor();
  const promoImage=cp.getByRole('dialog').locator('img');if(await promoImage.count())await promoImage.evaluate(img=>img.decode());
  await cp.getByRole('dialog').getByText(/Nearest rewards.*Chicago, IL/).waitFor();
  assert.doesNotMatch(await cp.getByRole('dialog').innerText(),/100 points|\$40.00/);
  assert.equal(await cp.getByRole('dialog').getByRole('button',{name:'Book a visit',exact:true}).count(),0);
  assert.equal(await cp.getByRole('button',{name:'Service spend',exact:true}).count(),0);
  assert.equal(await cp.getByRole('button',{name:'Welcome points',exact:true}).count(),0);
  await cp.screenshot({path:output+'/explore-actual-mobile.png',fullPage:true});
  await cp.getByRole('dialog').getByRole('link',{name:'Explore this salon',exact:true}).click();
  await cp.getByRole('region',{name:'Salon rewards',exact:true}).waitFor();
  await cp.getByRole('region',{name:'Salon rewards',exact:true}).getByRole('link',{name:'My rewards',exact:true}).waitFor();
  assert.doesNotMatch(await cp.getByRole('region',{name:'Salon rewards',exact:true}).innerText(),/100 points|\$40.00/);
  await cp.screenshot({path:output+'/salon-actual-mobile.png',fullPage:true});
  await cp.getByRole('region',{name:'Salon rewards',exact:true}).getByRole('link',{name:'My rewards',exact:true}).click();await cp.locator('[data-reward-wallet]').getByText('Nearest rewards',{exact:true}).waitFor();assert.equal(await cp.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await cp.screenshot({path:output+'/wallet-actual-mobile.png',fullPage:true});
  // A second owned fixture membership has fewer points but a newer join time.
  // This validates the real Beauty read and navigation, not just mocked props.
  const latestName='Newest joined salon fixture';
  const latestSalon=f.rpc(owner,'create_account_salon_with_owner_staff',{p_account_id:account,p_create_request_key:randomUUID(),p_name:latestName,p_owner_is_staff:false,p_phone:null,p_address_line1:null,p_address_line2:null,p_city:'Chicago',p_state:'IL',p_postal_code:'60601',p_country:'US'}).salon_id;
  const originalSettings=f.rpc(owner,'reward_owner',{p_salon:salon,p_op:'load'});
  f.rpc(owner,'reward_owner',{p_salon:latestSalon,p_op:'save',p_args:{program:{...originalSettings.program,nearby:false,welcomePoints:0,firstBookingPoints:0},expectedVersion:0}});
  f.sql(`select reward_join('${latestSalon}','${customer.profileId}');update reward_members set joined_at='2026-01-01T00:00:00Z' where user_id='${customer.profileId}';update reward_members set joined_at='2026-01-02T00:00:00Z' where user_id='${customer.profileId}' and salon_id='${latestSalon}';`);
  if(!f.rest(customer,'/beauty_profiles?user_id=eq.'+customer.profileId).length)f.rest(customer,'/beauty_profiles','POST',{user_id:customer.profileId});
  const privateReply=await cp.request.post(origin+'/api/rewards',{data:{scope:'personal',op:'wallet',args:{}}});
  assert.equal(privateReply.status(),200);
  const privateCards=(await privateReply.json()).cards;
  assert.equal(privateCards[0].salonId,latestSalon);assert.ok(privateCards.every(card=>card.joinedAt));
  const latestCard=privateCards.find(card=>card.salonId===latestSalon),originalCard=privateCards.find(card=>card.salonId===salon);
  assert.equal(latestCard.available,0);assert.ok(originalCard.available>latestCard.available);
  const beforeBeauty=f.sql('select (select count(*) from reward_members)::text || \'/\' || (select count(*) from reward_ledger)::text');
  await cp.goto(origin+'/beauty',{timeout:120000});
  const beautySummary=cp.locator('[data-beauty-rewards]');await beautySummary.getByText(latestName,{exact:true}).waitFor();
  assert.equal(await beautySummary.getByText('Nearest rewards',{exact:true}).count(),0);
  assert.equal(await beautySummary.locator('strong').innerText(),'0');
  const typography=await beautySummary.evaluate(el=>({points:parseFloat(getComputedStyle(el.querySelector('strong')).fontSize),salon:parseFloat(getComputedStyle(el.querySelector('a[aria-label] > div:nth-child(2) > span:nth-child(2)')).fontSize),height:el.getBoundingClientRect().height}));
  assert.ok(typography.points>typography.salon);assert.ok(typography.height<180);
  await cp.screenshot({path:output+'/beauty-latest-actual-mobile.png',fullPage:true});
  await beautySummary.getByRole('link',{name:/^More/}).click();
  const wallet=cp.locator('[data-reward-wallet]');await wallet.getByRole('heading',{name:latestName,exact:true}).waitFor();
  assert.equal(await wallet.locator('[data-reward-salon]').first().getAttribute('data-reward-salon'),latestSalon);
  assert.equal(await wallet.locator(`[data-reward-salon="${latestSalon}"] > div:first-child strong`).innerText(),'0');
  assert.equal(await wallet.locator(`[data-reward-salon="${salon}"] > div:first-child strong`).innerText(),originalCard.available.toLocaleString('en-US'));
  const salonBoxes=await wallet.locator('[data-reward-salon]').evaluateAll(nodes=>nodes.map(node=>({top:node.getBoundingClientRect().top,bottom:node.getBoundingClientRect().bottom})));
  assert.ok(salonBoxes.every((box,index)=>index===0||box.top>salonBoxes[index-1].bottom));
  await wallet.locator(`[data-reward-salon="${latestSalon}"] > details > summary`).click();
  assert.equal(await wallet.locator(`[data-reward-salon="${latestSalon}"]`).getByRole('link',{name:/Show My QR/}).getAttribute('href'),'/qr');
  assert.equal(f.sql('select (select count(*) from reward_members)::text || \'/\' || (select count(*) from reward_ledger)::text'),beforeBeauty,'Beauty and wallet reads do not enroll or earn');
  assert.equal(await cp.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await cp.screenshot({path:output+'/multi-wallet-actual-mobile.png',fullPage:true});
  const guestContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await isolateNetwork(guestContext);const gp=await guestContext.newPage();pages.push(['guest',gp]);gp.setDefaultTimeout(45000);gp.on('pageerror',e=>errors.push(e.message));
  await gp.goto(origin+'/explore?browse=1&location=Chicago%2C%20IL',{timeout:120000});await openReward(gp);
  await gp.getByRole('link',{name:'Create an account',exact:true}).waitFor();
  const guestImage=gp.getByRole('dialog').locator('img');if(await guestImage.count())await guestImage.evaluate(img=>img.decode());
  const nextHref=await gp.getByRole('link',{name:'Create an account',exact:true}).getAttribute('href');
  assert.equal(new URLSearchParams(nextHref.split('?')[1]).get('next'),'/explore/salons/'+salon+'#salon-rewards');
  await gp.screenshot({path:output+'/guest-promo-actual-mobile.png',fullPage:true});
  await gp.getByRole('link',{name:'Create an account',exact:true}).click();await gp.waitForURL('**/signup?**');await gp.getByRole('heading',{name:/create|sign up/i}).waitFor();
  // Only owned fixture configuration changes: no real booking, payment or dispatch.
  const staff=f.rest(owner,'/staff','POST',{salon_id:salon,display_name:'Booking professional',is_active:true,online_booking_enabled:true})[0].id;
  const service=f.json(`select to_jsonb(id) from services where salon_id='${salon}' limit 1`);
  f.rest(owner,'/services?id=eq.'+service,'PATCH',{online_booking_enabled:true,duration_minutes:45});
  f.rest(owner,'/staff_service_assignments','POST',{salon_id:salon,staff_id:staff,service_id:service,is_active:true,online_bookable:true});
  f.rest(owner,'/staff_availability_rules','POST',Array.from({length:7},(_,day)=>({salon_id:salon,staff_id:staff,rule_type:'working',day_of_week:day,starts_at_local:'08:00',ends_at_local:'18:00',is_active:true})));
  f.rest(owner,'/booking_settings?salon_id=eq.'+salon,'PATCH',{booking_enabled:true,online_booking_visible:true,timezone_iana:'America/Chicago',minimum_lead_time_minutes:0,same_day_booking_enabled:true,guest_booking_enabled:true,any_professional_enabled:true,confirmation_email_enabled:false,confirmation_sms_enabled:false,reminder_enabled:false});
  const bookable=await (await cp.request.get(origin+'/api/rewards/program?salonId='+salon)).json();assert.equal(bookable.salon.canBook,true);
  await cp.goto(origin+'/explore?browse=1&location=Chicago%2C%20IL');await openReward(cp);
  await cp.getByRole('dialog').getByRole('button',{name:'Book a visit',exact:true}).waitFor();
  assert.equal(await cp.getByRole('dialog').getByRole('button',{name:'Book a visit',exact:true}).getAttribute('data-booking-href'),'/book/'+salon+'?source=explore');
  await cp.screenshot({path:output+'/bookable-actual-mobile.png',fullPage:true});
  await cp.getByRole('dialog').getByRole('button',{name:'Book a visit',exact:true}).click();
  const quick=cp.getByRole('dialog',{name:'Quick booking',exact:true});
  await quick.locator('header strong').filter({hasText:'Choose services'}).waitFor();
  assert.equal(await quick.count(),1);assert.equal(await cp.locator('dialog[open]').count(),1);
  await quick.getByRole('button',{name:'Continue',exact:true}).click();
  await quick.locator('header strong').filter({hasText:/Choose staff|Choose a time|Confirm booking/}).waitFor();
  await cp.screenshot({path:output+'/booking-entry-actual-mobile.png',fullPage:true});
  await gp.goto(origin+'/explore?browse=1&location=Chicago%2C%20IL');await openReward(gp);
  const bookNext=await gp.getByRole('link',{name:'Create an account',exact:true}).getAttribute('href');
  assert.equal(new URLSearchParams(bookNext.split('?')[1]).get('next'),'/book/'+salon+'?source=explore');
  await gp.keyboard.press('Escape');
  // Referral is a real program configuration, never a customer-facing mechanism filter.
  const recurring=f.rpc(owner,'reward_owner',{p_salon:salon,p_op:'load'});
  f.rpc(owner,'reward_owner',{p_salon:salon,p_op:'save',p_args:{program:{...recurring.program,spendPoints:0,visitPoints:0,welcomePoints:0,firstBookingPoints:0,conversionPoints:30},expectedVersion:recurring.version}});
  try{
   await gp.goto(origin+'/explore?browse=1&location=Chicago%2C%20IL');await openReward(gp);
   await gp.getByRole('dialog').getByRole('heading',{name:'Share your look. Earn rewards.',exact:true}).waitFor();
   assert.equal(await gp.getByRole('dialog').getByRole('button',{name:'Book a visit',exact:true}).count(),0);
   await gp.getByRole('dialog').getByRole('link',{name:'Explore this salon',exact:true}).waitFor();
   assert.equal(await gp.getByRole('button',{name:'Before & After',exact:true}).count(),0);
   await gp.screenshot({path:output+'/referral-actual-mobile.png',fullPage:true});
  }finally{
   const current=f.rpc(owner,'reward_owner',{p_salon:salon,p_op:'load'});
   f.rpc(owner,'reward_owner',{p_salon:salon,p_op:'save',p_args:{program:recurring.program,expectedVersion:current.version}});
  }
  // Real browser geolocation and local search/reward APIs; the external reverse
  // geocoder boundary is an explicit fixture so no provider is contacted.
  const gpsContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,geolocation:{latitude:41.88,longitude:-87.63}});
  await isolateNetwork(gpsContext);
  await gpsContext.route('**/api/explore/area',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({area:{label:'Chicago, IL',city:'Chicago',state:'IL',postalCode:'60601',country:'US',source:'gps',provider:'us_census',precision:'city',attribution:{label:'Isolated reverse-area fixture',url:'http://fixture.invalid'}},error:null,errorKind:null})}));
  const gps=await gpsContext.newPage();pages.push(['gps',gps]);gps.setDefaultTimeout(45000);gps.on('pageerror',error=>errors.push(error.message));
  const traceUrl=url=>/\/api\/(?:rewards\/(?:discover|program)|explore\/(?:search|area))/.test(url);
  gps.on('request',request=>{if(traceUrl(request.url()))diagnostics.gps.requests.push({url:request.url(),method:request.method(),body:request.postData()});});
  gps.on('requestfailed',request=>{if(traceUrl(request.url()))diagnostics.gps.failures.push({url:request.url(),error:request.failure()?.errorText});});
  gps.on('response',async response=>{if(!traceUrl(response.url()))return;let data;try{data=await response.json();}catch{}diagnostics.gps.responses.push({url:response.url(),status:response.status(),error:data?.error,area:data?.area,locationSource:data?.locationSource,locationOrigin:data?.locationOrigin,salons:data?.salons?.map(s=>({id:s.id,name:s.name,distanceMiles:s.distanceMiles})),salon:data?.salon?{id:data.salon.id,name:data.salon.name,canBook:data.salon.canBook,offers:data.salon.offers?.length}:null,results:data?.results?.map(s=>({id:s.id,distanceMiles:s.distanceMiles})),earningEligibility:data?.earningEligibility});});
  await gps.goto(origin+'/explore?browse=1&location=Chicago%2C%20IL',{timeout:120000});await gps.locator('[data-testid="explore-home-content"]:visible').waitFor();
  await gpsContext.grantPermissions(['geolocation'],{origin});
  await gps.getByRole('button',{name:/^Search area:/}).click();
  await gps.getByTestId('explore-area-dialog').getByRole('button',{name:'Use current location',exact:true}).click();
  const gpsPost=gps.getByRole('region',{name:'Salon rewards at Nearest rewards',exact:true});
  await gps.locator('[data-testid="explore-fresh-editorial"]:visible').first().scrollIntoViewIfNeeded();await gps.mouse.wheel(0,350);await gpsPost.waitFor();
  await gpsPost.getByText(/0 mi.*Chicago, IL/).waitFor();
  assert.equal(await gps.getByRole('button',{name:'Service spend',exact:true}).count(),0);
  assert.equal(await gps.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await gps.screenshot({path:output+'/gps-local-post-actual-mobile.png',fullPage:true});
  await gpsPost.screenshot({path:output+'/gps-post-actual-mobile.png'});
  fs.writeFileSync(output+'/diagnostics.json',f.redact(JSON.stringify(diagnostics,null,2)));
  assert.deepEqual(errors,[]);assert.equal(fs.readFileSync(buildDir+'/BUILD_ID','utf8'),buildId);
  fs.writeFileSync(output+'/result.json',JSON.stringify({passed:true,buildId,checks:['actual Next owner load/preview/versioned save','actual named-area API','customer denied owner aggregate','actual home feed Reward post follows Fresh looks → details → salon context','actual member wallet navigation','actual Beauty newest zero-point membership rather than older higher balance','actual Beauty More → separate vertical per-salon wallet with QR details','Beauty and wallet reads leave membership/ledger counts unchanged','mobile overflow','guest promotional image and signup with salon return context','no booking without workforce/settings','direct booking only after actual readiness','real booking wizard Continue with exactly one open dialog','referral-only program avoids own-booking CTA without mechanism filters','real browser GPS selection and measured local Reward post with reverse-provider fixture','browser network restricted to owned loopback fixture'],runtimeErrors:errors,blockedExternalOrigins:[...new Set(blockedNetwork)],gpsProvider:'stubbed at /api/explore/area; actual geolocation and local search/reward APIs'},null,2));
 }catch(error){
  const gps=pages.find(([name])=>name==='gps')?.[1];
  if(gps){
   try{diagnostics.gps.dom=await gps.evaluate(()=>({url:location.href,scrollY,viewport:[innerWidth,innerHeight],visibility:document.visibilityState,preference:Object.fromEntries(Object.keys(sessionStorage).filter(key=>key.startsWith('reward-discovery:')).map(key=>[key,sessionStorage.getItem(key)])),elements:[...document.querySelectorAll('[data-testid="explore-fresh-editorial"],section[class*="pendingSlot"],[data-reward-discovery]')].map(el=>({className:el.className,testId:el.getAttribute('data-testid'),position:getComputedStyle(el).position,parentClass:el.parentElement?.className,rect:el.getBoundingClientRect().toJSON()}))}));}catch{}
   for(const url of['/api/rewards/discover?lat=41.88&lon=-87.63&category=All&kind=all&radius=5','/api/rewards/program?salonId='+salon])try{const reply=await gps.request.get('http://localhost:4087'+url);diagnostics.gps.probes.push({url,status:reply.status(),data:await reply.json()});}catch{}
  }
  fs.writeFileSync(output+'/diagnostics.json',f.redact(JSON.stringify(diagnostics,null,2)));
  for(const[name,page]of pages){try{fs.writeFileSync(output+'/failed-'+name+'.txt',f.redact(await page.locator('body').innerText()));await page.screenshot({path:output+'/failed-'+name+'.png',fullPage:true});}catch{}}throw error;
 }finally{
  if(browser)await browser.close();app.kill();await new Promise(resolve=>{if(app.exitCode!==null)return resolve();app.once('exit',resolve);});gateway.closeAllConnections();await new Promise(resolve=>gateway.close(resolve));fs.writeFileSync(output+'/next.log',f.redact(logs));
 }
}
