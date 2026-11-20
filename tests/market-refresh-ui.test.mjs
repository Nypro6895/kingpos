import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import {mkdirSync} from 'node:fs';

const bundle = await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
 import React,{useState}from'react';import{createRoot}from'react-dom/client';
 import{MarketExperienceClient}from'./app/market/market-experience-client';
 import{MarketTrialPanel}from'./app/market/trial-panel';
 import{CardCheckoutPanel}from'./app/market/card-checkout-panel';
 import{MarketClient}from'./app/market/market-client';
 const context={scope:'owner:salon_a',salonId:'salon_a'};
 const catalog=[{plugin_id:'booksms',name:'BookSMS',price_cents:window.unreadyCatalog?0:100,interval:'month',published:true,fulfillment_ready:!window.unreadyCatalog,monthly_sms_limit:100,version:1},...(window.vietnameseTest?[{plugin_id:'vietnamese-language',name:'Vietnamese Language',price_cents:399,interval:'month',published:true,fulfillment_ready:true,version:1}]:[]),...(window.receiptTest?[{plugin_id:'checkin-receipt',name:'Check-in Receipt',price_cents:470,interval:'month',published:true,fulfillment_ready:true,version:1}]:[]),...(window.policyTest?[{plugin_id:'booking-policy',name:'Booking Policy',price_cents:99,interval:'month',published:true,fulfillment_ready:true,version:1}]:[]),...(window.writerTest?[{plugin_id:'print-check',name:'Check Writer',price_cents:490,interval:'month',published:true,fulfillment_ready:false,version:1}]:[])];
 const billing=salon=>({salon_id:salon,settings:{version:1,enabled:true,ready:true,currency:'USD',tax_bps:0,fee_bps:0,fixed_fee_cents:0},catalog:window.unpublishCatalog?catalog.map(item=>({...item,published:false,fulfillment_ready:false,price_cents:0})):catalog,orders:[]});
 window.marketData=()=>({marketSalonId:'salon_a',experienceScope:context.scope,cardReady:true,bankBillingState:billing('salon_a'),vietnameseState:window.vietnameseTest?{installed:true,active:window.viForceActive||window.trialStarted||window.serverPaid,paid:window.viPaidUndefined?undefined:window.serverPaid,has_subscription:window.subscriptionPresent||window.serverPaid,trial_ends_at:window.trialStarted?'2030-01-06T00:00:00Z':null,paid_until:window.serverPaid?'2030-02-01T00:00:00Z':null,staff_enabled:false,portable_enabled:false}:undefined,checkWriter:window.writerTest?{active:window.trialStarted,installed:window.trialStarted,paid:false,subscribed:false,operationalReady:false,trialReady:window.writerReady}:undefined,bookingPolicy:window.policyTest?{active:window.trialStarted||window.serverPaid,paid:window.serverPaid,subscribed:window.policySubscribed||window.serverPaid,content:'Saved salon rules',published:false}:undefined,checkinReceipt:window.receiptTest?{active:window.trialStarted||window.serverPaid,paid:window.serverPaid,subscribed:window.policySubscribed||window.serverPaid}:undefined,booksms:{installed:window.trialStarted||window.serverPaid,active:window.trialStarted||window.serverPaid,paid:window.stableVisibleAccess?false:window.serverPaid,subscribed:window.subscriptionPresent||window.serverPaid,monthlyLimit:window.stableVisibleAccess?10:window.serverPaid?100:10}});
 const initial={data:window.marketData(),revision:'initial',updatedAt:new Date().toISOString()};
 function App(){const[mode,setMode]=useState('cached'),[salon,setSalon]=useState('salon_a'),[revision,setRevision]=useState('initial'),[snapshot,setSnapshot]=useState(initial);window.setMode=setMode;window.setSalon=setSalon;window.setRevision=setRevision;window.setSnapshot=setSnapshot;
  return mode==='native'?<MarketClient {...snapshot.data} accessRevision={snapshot.revision} onMarketRefresh={()=>{window.resourceReads++;setSnapshot(p=>({...p,data:window.marketData(),revision:'native-'+window.resourceReads}))}}/>:mode==='cached'||mode==='transient'?<MarketExperienceClient context={context} initial={snapshot} transient={mode==='transient'}/>:mode==='trial'?<MarketTrialPanel pluginId='booksms' scope={'owner:'+salon} salonId={salon} accessRevision={revision}/>:<CardCheckoutPanel pluginId='booksms' pluginName='BookSMS' ready billingState={billing(salon)} hasActiveSubscription={false} experienceScope={'owner:'+salon} onStateChange={()=>{}}/>;
 }createRoot(document.getElementById('root')).render(<App/>);
`},bundle:true,write:false,platform:'browser',jsx:'automatic',define:{'process.env':'{}'},plugins:[{name:'boundaries',setup(api){
 const stubs={
  'next/navigation':`const router={refresh(){window.routerRefreshes++},push(){},replace(){}};export function useRouter(){return router}export function usePathname(){return '/market'}export function useSearchParams(){return new URLSearchParams()}`,
  'next/image':`import React from'react';export default function Image(){return null}`,
  '@/components/workspace-language':`export function WorkspaceText({text}){return text}export function useWorkspaceTranslation(){return x=>x}`,
  '@/components/experience-scope':`export function useExperienceScope(){return {context:{scope:'owner:salon_a'}}}`,
  '@/components/loading-feedback':`export function PageLoadingSkeleton(){return null}`,
  '@/components/overlay-dismissal':`export function useNativeDialogNavigation(){}export function useTransientOverlay(){}`,
  '@/lib/use-live-experience-refresh':`export function useLiveExperienceRefresh(){}`,
  '@/lib/fetch-live-experience-resource':`export function fetchLiveExperienceResource(){return async()=>{window.resourceReads++;await new Promise(r=>setTimeout(r,40));return window.forceNotModified?{notModified:true}:{data:{data:window.marketData(),revision:'live-'+window.resourceReads,updatedAt:new Date().toISOString()}}}}`,
  './trial-actions':`export async function marketTrialAction(plugin,start=false,salon){window.trialCalls.push({plugin,start,salon});if(start&&window.deferTrialStart)return await new Promise(resolve=>window.pendingTrialStarts.push(resolve));if(!start&&window.deferTrialReads)return await new Promise(resolve=>window.pendingTrialReads.push(resolve));if(start)window.trialStarted=true;return {state:{started:window.trialStarted,active:window.trialStarted||window.serverPaid,paid:window.serverPaid,endsAt:window.trialStarted?'2030-01-06T00:00:00Z':null}}}`,
  './card-payment-actions':`export async function startCardCheckout(){window.cardStarts++;if(window.deferCardStart)return await new Promise(resolve=>window.pendingCardStarts.push(resolve));if(window.hostedCheckout)return {checkoutUrl:'https://checkout.stripe.com/c/pay/reserved'};window.serverPaid=true;return {complete:true,message:'Payment confirmed.'}}export async function refreshCardPurchase(){window.paymentChecks++;return {message:'Payment confirmed.'}}export async function manageCardSubscription(){return {url:'https://billing.stripe.com/p/session/demo'}}`,
  './check-writer-actions':`export async function manageCheckWriterSubscription(){return {url:'https://billing.stripe.com/p/session/demo'}}`,
  './vietnamese-actions':`export async function setVietnamesePlugin(){return {}}export async function vietnamesePaymentAction(){return {}}`,
  './booking-policy-actions':`export async function saveBookingPolicy(){return {}}export async function bookingPolicyPaymentAction(){return {}}`,
 };
 api.onResolve({filter:/\.css$/},a=>({path:a.path,namespace:'style'}));
 api.onLoad({filter:/.*/,namespace:'style'},()=>({contents:'export default {}'}));
 api.onResolve({filter:/.*/},a=>{
  if(process.env.MARKET_VI_COPY_BASELINE==='v7' && a.path==='./vietnamese-plugin-panel')return{path:'app/market/vietnamese-plugin-panel.tsx',namespace:'v7-baseline'};
  if(a.path==='./vietnamese-plugin-panel')return;
  if(process.env.MARKET_COPY_BASELINE==='v6' && (a.path==='./app/market/market-client'||a.path==='./booking-policy-panel'))return{path:a.path.endsWith('market-client')?'app/market/market-client.tsx':'app/market/booking-policy-panel.tsx',namespace:'baseline'};
  if(stubs[a.path])return{path:a.path,namespace:'stub'};
  if(/(?:^|\/)(?:[a-z-]*actions|booksms-panel|tax-company-panel|booking-deposit-panel|campaign-preview|vietnamese-preview|tax-company-preview|app-logo|vietnamese-plugin-panel|contact-form)$/.test(a.path))return{path:a.path,namespace:'other'};
 });
 api.onLoad({filter:/.*/,namespace:'v7-baseline'},async a=>({resolveDir:process.cwd()+'/app/market',contents:(await import('node:fs')).readFileSync('artifacts/market-iphone-integration-20261103/source-v7/'+a.path,'utf8'),loader:'tsx'}));
 api.onLoad({filter:/.*/,namespace:'baseline'},async a=>({resolveDir:process.cwd()+'/app/market',contents:(await import('node:fs')).readFileSync('artifacts/market-iphone-integration-20261103/source-v6/'+a.path,'utf8'),loader:'tsx'}));
 api.onLoad({filter:/.*/,namespace:'stub'},a=>({resolveDir:process.cwd(),contents:stubs[a.path],loader:'tsx'}));
 api.onLoad({filter:/.*/,namespace:'other'},a=>({loader:'tsx',contents:/actions$/.test(a.path)?`export async function setServiceRelayPlugin(){}export async function checkinReceiptPaymentAction(){}export async function setCampaignPluginAction(){}export async function setPayrollDataPlugin(){}`:`export function BookSmsPanel(){return null}export function TaxCompanyMarketPanel(){return null}export function BookingDepositPanel(){return null}export function BookingPolicyPanel(){return null}export function CampaignPreview(){return null}export function VietnamesePreview(){return null}export function TaxCompanyPreview(){return null}export function AppLogo(){return null}export function VietnamesePluginPanel(){return null}export function ContactSupportForm(){return null}`}));
}}]});

async function fixture(run,initialState={}){
 const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://reylumi.test/**',r=>r.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>'}));
  await page.goto('https://reylumi.test/market');
  await page.evaluate(initialState=>{Object.assign(window,{resourceReads:0,routerRefreshes:0,trialCalls:[],cardStarts:0,paymentChecks:0,trialStarted:false,serverPaid:false,pendingTrialStarts:[],pendingTrialReads:[],pendingCardStarts:[]},initialState);},initialState);
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  try { await run(page); } catch(error) { mkdirSync('artifacts/market-iphone-integration-20261103',{recursive:true});await page.screenshot({path:'artifacts/market-iphone-integration-20261103/refresh-failure.png'});console.error('Market refresh fixture:',await page.locator('body').innerText(),errors);throw error; }
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
}

test('cached Market activation/payment uses one resource read per change and trial follows verified paid revision',{timeout:60000},()=>fixture(async page=>{
 await page.getByRole('button',{name:'View BookSMS',exact:true}).click();
 const start=page.getByRole('button',{name:'Start 5-day free trial'});
 await start.waitFor();await page.waitForFunction(()=>!document.querySelector('section[aria-label="Free trial"] button')?.disabled);
 await start.evaluate(b=>{b.click();b.click();});
 await page.getByText(/Trial active until/).waitFor();
 await page.waitForFunction(()=>window.resourceReads===1&&window.trialCalls.filter(c=>!c.start).length===2);
 assert.equal(await page.evaluate(()=>window.routerRefreshes),0);
 assert.equal(await page.evaluate(()=>window.trialCalls.filter(c=>c.start).length),1);
 await page.getByRole('button',{name:'Buy with card',exact:true}).click();
 await page.getByText('Paid access is active.',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.resourceReads),2);
 assert.equal(await page.evaluate(()=>window.routerRefreshes),0);
 assert.equal(await page.evaluate(()=>window.cardStarts),1);
 assert.equal(await page.evaluate(()=>document.querySelector('dialog').open),true);
}));

test('an unready paid catalog keeps its trial available without presenting a zero-dollar recurring plan',{timeout:60000},()=>fixture(async page=>{
 await page.getByRole('button',{name:'View BookSMS',exact:true}).click();
 const start=page.getByRole('button',{name:'Start 5-day free trial'});
 await start.waitFor();await page.waitForFunction(()=>!document.querySelector('section[aria-label="Free trial"] button')?.disabled);
 const text=await page.locator('dialog').innerText();
 assert.match(text,/Free trial available · Paid purchases are being prepared and are not available yet/);
 assert.doesNotMatch(text,/\$0\.00|renews monthly|Bank payment and activation become available/);
 assert.equal(await page.getByRole('button',{name:'Buy with card',exact:true}).count(),0);
 await start.click();await page.getByText(/Trial active until/).waitFor();
 assert.equal(await page.evaluate(()=>window.cardStarts),0);
},{unreadyCatalog:true}));

test('a reserved checkout keeps its mount, link and status recovery when its catalog closes',{timeout:60000},()=>fixture(async page=>{
 await page.getByRole('button',{name:'View BookSMS',exact:true}).click();
 await page.getByRole('button',{name:'Buy with card',exact:true}).click();
 const link=page.getByRole('link',{name:'Continue to secure checkout',exact:true});
 await link.waitFor();
 await page.evaluate(()=>{window.reservedCheckoutMount=document.querySelector('section[aria-label="Card payment"] > div');window.unpublishCatalog=true;window.setSnapshot(previous=>({...previous,data:window.marketData(),revision:'catalog-closed',updatedAt:new Date().toISOString()}));});
 await page.getByText('Paid purchases are being prepared and are not available yet. Free trial access remains available.',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.reservedCheckoutMount===document.querySelector('section[aria-label="Card payment"] > div')),true);
 assert.equal(await link.getAttribute('href'),'https://checkout.stripe.com/c/pay/reserved');
 assert.match(await page.locator('section[aria-label="Card payment"]').innerText(),/Continue to secure checkout to review the total and complete payment/);
 assert.equal(await page.getByRole('button',{name:'Buy with card',exact:true}).count(),0);
 await page.getByRole('button',{name:'Check payment status',exact:true}).click();
 await page.getByText('Payment confirmed.',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.paymentChecks),1);
 assert.equal(await page.evaluate(()=>window.cardStarts),1);
 assert.equal(await link.count(),1);
 assert.doesNotMatch(await page.locator('section[aria-label="Card payment"]').innerText(),/\$0\.00|renews monthly/);
},{hostedCheckout:true}));

test('trial scopes discard late mutations and older revision reads, standalone refresh retains fallback',{timeout:60000},()=>fixture(async page=>{
 await page.evaluate(()=>window.setMode('trial'));
 const start=page.getByRole('button',{name:'Start 5-day free trial'});
 await start.waitFor();await page.waitForFunction(()=>!document.querySelector('section[aria-label="Free trial"] button')?.disabled);
 await page.evaluate(()=>window.deferTrialStart=true);
 await start.click();await page.waitForFunction(()=>window.pendingTrialStarts.length===1);
 await page.evaluate(()=>window.setSalon('salon_b'));
 await page.waitForFunction(()=>window.trialCalls.at(-1)?.salon==='salon_b');
 await page.evaluate(()=>{window.pendingTrialStarts.shift()({state:{started:true,active:true,paid:true,endsAt:null}});window.deferTrialStart=false;});
 await page.waitForTimeout(50);
 assert.equal(await page.getByText('Paid access is active.',{exact:true}).count(),0);
 assert.equal(await page.evaluate(()=>window.routerRefreshes),0);
 await start.click();await page.getByText(/Trial active until/).waitFor();
 assert.equal(await page.evaluate(()=>window.routerRefreshes),1);
 await page.evaluate(()=>{window.deferTrialReads=true;window.setRevision('read-one');});
 await page.waitForFunction(()=>window.pendingTrialReads.length===1);
 await page.evaluate(()=>window.setRevision('read-two'));
 await page.waitForFunction(()=>window.pendingTrialReads.length===2);
 await page.evaluate(()=>window.pendingTrialReads[1]({state:{started:true,active:true,paid:true,endsAt:null}}));
 await page.getByText('Paid access is active.',{exact:true}).waitFor();
 await page.evaluate(()=>window.pendingTrialReads[0]({state:{started:false,active:false,paid:false,endsAt:null}}));
 await page.waitForTimeout(50);
 assert.equal(await page.getByText('Paid access is active.',{exact:true}).count(),1);
 assert.equal(await page.evaluate(()=>window.trialCalls.filter(c=>c.start).length),2);
}));

test('an unchanged Market snapshot still verifies trial paid status after a completed refresh',{timeout:60000},()=>fixture(async page=>{
 await page.getByRole('button',{name:'View BookSMS',exact:true}).click();
 await page.getByText(/Trial active until/).waitFor();
 assert.equal(await page.evaluate(()=>{const before=JSON.stringify(window.marketData());window.serverPaid=true;window.forceNotModified=true;window.dispatchEvent(new Event('reylumi:market-changed'));return before===JSON.stringify(window.marketData());}),true);
 await page.getByText('Paid access is active.',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.resourceReads),1);
 assert.equal(await page.evaluate(()=>window.trialCalls.length),2);
 assert.equal(await page.evaluate(()=>window.routerRefreshes),0);
},{trialStarted:true,subscriptionPresent:true,stableVisibleAccess:true}));

test('transient Market verifies paid trial status after a fresh server render with unchanged visible state',{timeout:60000},()=>fixture(async page=>{
 await page.evaluate(()=>window.setMode('transient'));
 await page.getByRole('button',{name:'View BookSMS',exact:true}).click();
 await page.getByText(/Trial active until/).waitFor();
 const previousCalls=await page.evaluate(()=>window.trialCalls.length);
 await page.evaluate(()=>{window.serverPaid=true;window.setSnapshot(previous=>({...previous,updatedAt:new Date(Date.parse(previous.updatedAt)+1000).toISOString()}));});
 await page.getByText('Paid access is active.',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.trialCalls.length),previousCalls+1);
 assert.equal(await page.evaluate(()=>window.resourceReads),0);
},{trialStarted:true,subscriptionPresent:true,stableVisibleAccess:true}));

test('card checkout completion from an old salon cannot refresh the newly selected Owner scope',{timeout:60000},()=>fixture(async page=>{
 await page.evaluate(()=>{window.deferCardStart=true;window.setMode('card');});
 await page.getByRole('button',{name:'Buy with card',exact:true}).click();
 await page.waitForFunction(()=>window.pendingCardStarts.length===1);
 await page.evaluate(()=>window.setSalon('salon_b'));
 await page.waitForTimeout(50);
 await page.evaluate(()=>window.pendingCardStarts.shift()({complete:true,message:'Old salon payment confirmed.'}));
 await page.waitForTimeout(50);
 assert.equal(await page.getByText('Old salon payment confirmed.',{exact:true}).count(),0);
 assert.equal(await page.evaluate(()=>window.routerRefreshes),0);
 assert.equal(await page.evaluate(()=>window.resourceReads),0);
}));

test('native Booking Policy keeps one live checkout and its rules draft through repeated authoritative revisions',{timeout:60000},()=>fixture(async page=>{
 await page.evaluate(()=>window.setMode('native'));
 await page.getByRole('button',{name:'View Booking Policy',exact:true}).click();
 const start=page.getByRole('button',{name:'Start 5-day free trial',exact:true});await start.waitFor();await page.waitForFunction(()=>!document.querySelector('section[aria-label="Free trial"] button')?.disabled);
 await page.getByRole('textbox',{name:'Booking rules',exact:true}).fill('Unsaved owner draft');
 await start.click();await page.getByText(/Trial active until/).waitFor();
 for(let i=0;i<12;i++){
  await page.evaluate(i=>window.setSnapshot(p=>({...p,data:window.marketData(),revision:'verified-'+i})),i);
  await page.waitForTimeout(20);
  assert.equal(await page.locator('section[aria-label="Card payment"]').count(),1,'one checkout per selected plugin after revision '+i);
  assert.equal(await page.getByRole('button',{name:'Buy with card',exact:true}).count(),1);
  assert.equal(await page.getByRole('textbox',{name:'Booking rules',exact:true}).inputValue(),'Unsaved owner draft');
 }
 await page.getByRole('button',{name:'Buy with card',exact:true}).click();
 await page.getByRole('link',{name:'Continue to secure checkout',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.cardStarts),1);
},{policyTest:true,hostedCheckout:true}));

test('Check Writer trial is gated independently and activates its real workspace while paid sales remain closed',{timeout:60000},()=>fixture(async page=>{
 await page.evaluate(()=>window.setMode('native'));await page.getByRole('button',{name:'View Check Writer',exact:true}).click();
 const start=page.getByRole('button',{name:'Start 5-day free trial',exact:true});await start.waitFor();await page.getByText('Trial access is being configured. Please try again later.',{exact:true}).waitFor();assert.equal(await start.isDisabled(),true);
 assert.equal(await page.getByRole('button',{name:'Buy with card',exact:true}).count(),0);
 await page.evaluate(()=>{window.writerReady=true;window.setSnapshot(p=>({...p,data:window.marketData(),revision:'writer-ready'}));});await page.waitForFunction(()=>!document.querySelector('section[aria-label="Free trial"] button')?.disabled);
 await start.click();await page.getByText(/Trial active until/).waitFor();await page.getByRole('link',{name:'Open Check Writer',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Buy with card',exact:true}).count(),0);assert.equal(await page.getByText('Paid access is active.',{exact:true}).count(),0);
 assert.equal(await page.evaluate(()=>window.trialCalls.filter(c=>c.start).length),1);
},{writerTest:true,writerReady:false}));

test('active trial plus incomplete subscription preserves saved Checkout across revisions and cold reentry until paid',{timeout:60000},()=>fixture(async page=>{
 await page.evaluate(()=>window.setMode('native'));await page.getByRole('button',{name:'View Booking Policy',exact:true}).click();
 await page.getByText(/Trial active until/).waitFor();await page.getByRole('button',{name:'Buy with card',exact:true}).click();
 const link=page.getByRole('link',{name:'Continue to secure checkout',exact:true});await link.waitFor();
 for(let n=0;n<8;n++){await page.evaluate(n=>{window.policySubscribed=true;window.setSnapshot(p=>({...p,data:window.marketData(),revision:'incomplete-'+n}));},n);await page.waitForTimeout(20);assert.equal(await link.count(),1,'unpaid subscription must retain reserved Checkout after revision '+n);assert.equal(await page.locator('section[aria-label="Card payment"]').count(),1);}
 assert.equal(await page.evaluate(()=>window.cardStarts),1);
 await page.evaluate(()=>window.setMode('trial'));await page.getByRole('button',{name:'View Booking Policy',exact:true}).waitFor({state:'detached'});await page.evaluate(()=>window.setMode('native'));await page.getByRole('button',{name:'View Booking Policy',exact:true}).click();
 await page.getByRole('button',{name:'Buy with card',exact:true}).click();await link.waitFor();assert.equal(await link.getAttribute('href'),'https://checkout.stripe.com/c/pay/reserved');assert.equal(await page.evaluate(()=>window.cardStarts),2);
 await page.evaluate(()=>{window.serverPaid=true;window.setSnapshot(p=>({...p,data:window.marketData(),revision:'verified-paid'}));});await page.getByText('Paid access is active.',{exact:true}).waitFor();assert.equal(await page.locator('section[aria-label="Card payment"]').count(),0);
},{policyTest:true,hostedCheckout:true,trialStarted:true}));

test('Booking Policy trial copy stays neutral with or without an incomplete subscription and retains paid renewal guidance',{timeout:60000},()=>fixture(async page=>{
 await page.evaluate(()=>window.setMode('native'));await page.getByRole('button',{name:'View Booking Policy',exact:true}).click();
 const panel=page.locator('section[aria-label="Edit booking rules"]');await panel.waitFor();
 for(const subscribed of [false,true]){
  await page.evaluate(subscribed=>{window.policySubscribed=subscribed;window.setSnapshot(p=>({...p,data:window.marketData(),revision:'trial-'+subscribed}));},subscribed);
  await page.waitForTimeout(20);const text=await panel.innerText();assert.match(text,/Access active\. Saved rules appear/);assert.doesNotMatch(text,/Subscription active|Your paid access remains/);
  assert.equal(await panel.getByRole('button',{name:'Manage subscription',exact:true}).count(),Number(subscribed));
 }
 await page.evaluate(()=>window.setSnapshot(p=>({...p,data:{...p.data,bookingPolicy:{...p.data.bookingPolicy,paid:true,subscribed:false}},revision:'paid-nonrenewing'})));
 await panel.getByText('Your paid access remains available until the end of this period. Subscribe again after it ends.',{exact:true}).waitFor();
},{policyTest:true,trialStarted:true}));

test('Check-in Receipt never labels trial plus incomplete billing as paid and preserves management until paid is verified',{timeout:60000},()=>fixture(async page=>{
 await page.evaluate(()=>window.setMode('native'));await page.getByRole('button',{name:'View Check-in Receipt',exact:true}).click();
 const dialog=page.locator('dialog');
 for(const subscribed of [false,true]){
  await page.evaluate(subscribed=>{window.policySubscribed=subscribed;window.setSnapshot(p=>({...p,data:window.marketData(),revision:'receipt-trial-'+subscribed}));},subscribed);
  await page.waitForTimeout(20);const text=await dialog.innerText();assert.match(text,/Access is active\. Trial or bank-paid access does not renew automatically\./);assert.doesNotMatch(text,/Paid access is active/);
  assert.equal(await dialog.getByRole('button',{name:'Manage subscription',exact:true}).count(),Number(subscribed));
 }
 await page.evaluate(()=>{window.serverPaid=true;window.setSnapshot(p=>({...p,data:window.marketData(),revision:'receipt-paid'}));});
 await page.getByText('Paid access is active. Manage your existing subscription to control renewal.',{exact:true}).waitFor();
},{receiptTest:true,trialStarted:true}));

test('Vietnamese confirms verified paid access while retaining its valid trial and never treats an incomplete subscription as paid',{timeout:60000},()=>fixture(async page=>{
 await page.evaluate(()=>window.setMode('native'));await page.getByRole('button',{name:'View Vietnamese Language',exact:true}).click();
 const panel=page.locator('section[aria-label="Tùy chọn plugin tiếng Việt"]');await panel.waitFor();await panel.getByText(/^Dùng thử đến /).waitFor();
 for(let i=0;i<3;i++){
  await page.evaluate(i=>window.setSnapshot(p=>({...p,data:window.marketData(),revision:'vi-incomplete-'+i})),i);await page.waitForTimeout(20);
  assert.equal(await panel.getByText('Quyền truy cập trả phí đang hoạt động.',{exact:true}).count(),0);assert.equal(await panel.getByRole('button',{name:'Quản lý thuê bao',exact:true}).count(),1);
 }
 await page.evaluate(()=>{window.serverPaid=true;window.setSnapshot(p=>({...p,data:window.marketData(),revision:'vi-paid'}));});
 await page.waitForTimeout(50);assert.equal(await panel.getByText('Quyền truy cập trả phí đang hoạt động.',{exact:true}).count(),1);await panel.getByText(/^Dùng thử đến /).waitFor();
 assert.equal(await page.locator('section[aria-label="Card payment"]').count(),0);assert.equal(await panel.getByRole('button',{name:'Quản lý thuê bao',exact:true}).count(),1);assert.equal(await page.evaluate(()=>window.cardStarts),0);
},{vietnameseTest:true,trialStarted:true,subscriptionPresent:true}));

test('Vietnamese never claims paid from active access or missing paid facts alone',{timeout:60000},()=>fixture(async page=>{
 await page.evaluate(()=>window.setMode('native'));await page.getByRole('button',{name:'View Vietnamese Language',exact:true}).click();
 const panel=page.locator('section[aria-label="Tùy chọn plugin tiếng Việt"]');await panel.waitFor();
 for(const missing of [false,true]){
  await page.evaluate(missing=>{window.viPaidUndefined=missing;window.setSnapshot(p=>({...p,data:window.marketData(),revision:'vi-no-paid-'+missing}));},missing);await page.waitForTimeout(20);
  const text=await panel.innerText();assert.doesNotMatch(text,/Quyền truy cập trả phí|hết kỳ đã thanh toán/);assert.equal(await page.evaluate(()=>window.cardStarts),0);
 }
},{vietnameseTest:true,viForceActive:true}));
