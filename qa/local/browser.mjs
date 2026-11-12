import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {runtime,origin,assertMarker,sql} from './common.mjs';
assertMarker();
const identity=await (await fetch(origin+'/api/qa/environment')).json();
if(identity.qa!==true||identity.project!=='reylumi-qa-20261111')throw Error('QA app identity mismatch');
const role=process.argv.find(a=>/^--role=/.test(a))?.split('=')[1]||'owner';
const smoke=process.argv.includes('--smoke');
const checkoutSmoke=process.argv.includes('--checkout-smoke');
const access=JSON.parse(fs.readFileSync(path.join(runtime,'access.json')));
const person=access.people.find(p=>p.role===role);if(!person)throw Error('Unknown QA role');
const token=fs.readFileSync(path.join(runtime,'provider-token'),'utf8');
const escape=v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const context=await chromium.launchPersistentContext(path.join(runtime,'browser-'+role),{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:smoke,viewport:{width:412,height:860},hasTouch:true,isMobile:true,serviceWorkers:'block'});
const blocked=[];
await context.route('**/*',async route=>{
 const url=new URL(route.request().url());
 if(['http://localhost:3117','http://127.0.0.1:3117','http://127.0.0.1:3118','http://127.0.0.1:55421'].includes(url.origin))return route.continue();
 if(url.origin==='https://checkout.stripe.com'&&url.pathname.startsWith('/qa/')){
  const [, ,id,operation]=url.pathname.split('/');
  const endpoint='http://127.0.0.1:3118/checkout/'+encodeURIComponent(id)+(operation==='pay'?'/pay':'');
  const response=await fetch(endpoint,{method:operation==='pay'?'POST':'GET',headers:{'x-qa-token':token}});
  const session=await response.json();if(!response.ok)return route.fulfill({status:404,body:'Unknown local QA checkout'});
  if(operation==='pay'||operation==='cancel'){
   const destination=new URL((operation==='pay'?session.success_url:session.cancel_url).replace('{CHECKOUT_SESSION_ID}',id));
   if(destination.origin!==origin)throw Error('QA checkout attempted nonlocal return');
   return route.fulfill({status:302,headers:{location:destination.href},body:''});
  }
  return route.fulfill({contentType:'text/html; charset=utf-8',body:`<meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>LOCAL QA — simulated checkout</title><main style="font:18px sans-serif;padding:24px"><h1>QA ONLY — no real money</h1><p>Local payment simulation. This is not Stripe sandbox acceptance.</p><p>Amount: ${(session.amount_total/100).toFixed(2)} ${escape(session.currency)}</p><p><a href="/qa/${id}/pay">Approve test payment</a></p><p><a href="/qa/${id}/cancel">Cancel test payment</a></p></main>`});
 }
 blocked.push(url.hostname);return route.abort('blockedbyclient');
});
await context.addInitScript(()=>{
 document.addEventListener('DOMContentLoaded',()=>{
  const mark=()=>{if(!document.title.startsWith('[LOCAL QA]'))document.title='[LOCAL QA] '+document.title;};
  mark();new MutationObserver(mark).observe(document.head,{childList:true,subtree:true,characterData:true});
 });
});
const page=context.pages()[0]||await context.newPage();
try{
 await page.goto(origin+'/login',{timeout:120000});
 if(new URL(page.url()).pathname==='/login'){
  await page.locator('input[name="email"]').fill(person.email,{timeout:120000});
  await page.locator('input[name="password"]').fill(person.password);
  await page.locator('form').filter({has:page.locator('input[name="email"]')}).locator('button[type="submit"]').click();
  await page.waitForURL(url=>url.pathname!=='/login',{timeout:120000});
 }
 await page.waitForFunction(()=>document.body.innerText.length>100,null,{timeout:120000});
 if(['owner','staff'].includes(role)){
  await page.getByRole('button',{name:'Open account switcher',exact:true}).click({timeout:120000});
  const options=page.getByRole('dialog').getByRole('button');
  if(smoke)console.log(JSON.stringify({workspaceOptions:await options.allTextContents()}));
  await options.filter({hasText:role==='owner'?/Owner$/i:/Staff -/i}).last().click();
  await page.getByRole('dialog').waitFor({state:'hidden',timeout:120000});
  await page.waitForLoadState('domcontentloaded');
 }
 if(smoke){
  if(checkoutSmoke){
   await page.goto(origin+'/gift-cards?salon='+access.salon,{timeout:120000});
   await page.getByRole('button',{name:'Continue to secure payment',exact:true}).click({timeout:120000});
   await page.waitForURL(url=>url.hostname==='checkout.stripe.com',{timeout:120000});
   await page.getByRole('heading',{name:'QA ONLY — no real money'}).waitFor();
   await page.getByRole('link',{name:'Approve test payment',exact:true}).click();
   await page.waitForURL(url=>url.origin===origin&&url.pathname==='/gift-cards',{timeout:120000});
   await page.waitForFunction(()=>document.body.innerText.includes('PIN:')||document.body.innerText.includes('Open your wallet.'),null,{timeout:120000});
   const receipt=new URL(page.url()).searchParams.get('order');
   if(!/^[a-f0-9]{64}$/.test(receipt||'')||!sql(`select status||'|'||coalesce(card_id::text,'') from gift_card_online_orders where token='${receipt}'`).startsWith('paid|'))throw Error('Local paid receipt not persisted');
   console.log('PASS actual Gift purchase UI → local checkout simulation → local gift fulfillment');
  }
  fs.mkdirSync(path.join(runtime,'screenshots'),{recursive:true});
  await page.screenshot({path:path.join(runtime,'screenshots',role+'.png'),fullPage:false});
  console.log(JSON.stringify({qaRole:role,path:new URL(page.url()).pathname,loginPassed:true,blockedExternalHosts:[...new Set(blocked)]}));
  await context.close();
 }else console.log('QA browser ready for '+role+'. All nonlocal traffic blocked; checkout is a local simulation.');
}catch(error){await context.close();throw error;}
