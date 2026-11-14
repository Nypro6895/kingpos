import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

test('approved customer checkout: real components, reward artwork, auto tip, benefits and responsive layout',{timeout:120000},async()=>{
 const bundle=await build({entryPoints:['tests/fixtures/customer-checkout-entry.tsx'],bundle:true,write:false,outdir:'out',format:'esm',jsx:'automatic',define:{'process.env':'{}'},plugins:[{name:'isolated-checkout',setup(b){
  b.onResolve({filter:/^next\/(navigation|link|image)$/},a=>({path:a.path,namespace:'fixture'}));
  b.onResolve({filter:/supabase\/browser$/},()=>({path:'browser',namespace:'fixture'}));
  b.onResolve({filter:/actions$/},a=>({path:resolve(a.path.startsWith('@/')?a.path.slice(2):join(dirname(a.importer),a.path))+'.ts',namespace:'actions'}));
  b.onLoad({filter:/.*/,namespace:'actions'},async({path})=>{const source=await readFile(path,'utf8'),names=[...source.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)].map(m=>m[1]);return {contents:names.map(name=>`export async function ${name}(...args){${name==='getPosLiveDraft'?`return {ok:true,data:await fetch('/fixture/draft').then(r=>r.json())}`:name==='getCustomerDisplayLiveDraftTipOptions'?'return {ok:true,data:[]}':name==='confirmCustomerDisplayLiveDraftTip'?`return fetch('/fixture/tip',{method:'POST',body:JSON.stringify(args[0])}).then(r=>r.json())`:`throw Error('Unexpected action: ${name}')`}}`).join('\n')};});
  b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({loader:'tsx',resolveDir:process.cwd(),contents:path==='browser'?'export const createSupabaseBrowserClient=()=>null;':path==='next/navigation'?`export const useSearchParams=()=>new URLSearchParams();export const usePathname=()=>'/pos/customer-display';const router={refresh(){},push(){}};export const useRouter=()=>router;`:path==='next/image'?`export default function Image({fill,priority,...p}){return <img {...p}/>}`:`export default function Link({children,...p}){return <a {...p}>{children}</a>}`}));
 }}]});
 const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text;
 const source=resolve('app').replaceAll('\\','/'),components=resolve('components').replaceAll('\\','/');
 const globals=(await readFile('app/globals.css','utf8')).replace('@import "tailwindcss";',`@import "tailwindcss" source(none);\n@source "${source}";\n@source "${components}";`);
 const css=(await postcss([tailwind()]).process(globals,{from:resolve('app/globals.css')})).css+'\n'+bundle.outputFiles.find(f=>f.path.endsWith('.css')).text;
 const at=new Date().toISOString();
 let draft={id:'00000000-0000-4000-8000-000000000001',salon_id:'salon',token:'checkout-fixture',customer:{id:'customer',name:'Linh',phone:'+13125550198'},customer_handoff_started_at:at,customer_version:3,receipt_version:7,version:10,staff_lines:[{id:'a',amount:50,label:'Signature Pedicure',staffName:'Kim',amountParts:[50]},{id:'b',amount:35,label:'Gel Manicure',staffName:'Staff-Ny',amountParts:[35]},{id:'c',amount:15,label:'Nail Art',staffName:'Staff-Ny',amountParts:[15]}],subtotal:100,discount:0,tax:0,tip:0,total:100,total_before_tip:100,status:'draft',updated_at:at,server_now:at,last_tip_action_id:null,completed_at:null,reset_at:null};
 let request=null,unavailable=false,tipFailure=false;
 let gift={id:'gift',revision:1,mode:'use',entry:'code',status:'open',total:10000,purchase:0,amount:0,card:null,approved:false,qrVisible:false,mobile:'fixture',expires:new Date(Date.now()+600000).toISOString(),dismissed:true};
 const offers=[{id:'five',title:'$5 off this visit',points:100,valueCents:500,minimumCents:4000},{id:'six',title:'$6 off',points:120,valueCents:600,minimumCents:5000},{id:'seven',title:'$7 off',points:140,valueCents:700,minimumCents:6000},{id:'eight',title:'$8 off',points:150,valueCents:800,minimumCents:8000}];
 const operations=[];
 function changed(){draft={...draft,receipt_version:draft.receipt_version+1,version:draft.version+1,updated_at:new Date().toISOString()};gift={...gift,total:Math.round(draft.total*100),amount:0,approved:false,revision:gift.revision+1};}
 function view(){return {enabled:true,salonId:'salon',salonName:'King Nails Spa LLC',visitId:'visit',available:160-(request?.points||0),reserved:request?.points||0,pending:0,offers,request,checkout:{customerId:'customer',subtotalCents:10000,discountCents:Math.round(draft.discount*100),tipCents:Math.round(draft.tip*100),totalCents:Math.round(draft.total*100),rewardValueCents:request?.valueCents||0,giftCents:gift.approved?gift.amount:0,earningEnabled:true,points:Math.floor(Math.max(0,10000-Math.round(draft.discount*100)-(gift.approved?gift.amount:0))/2000)*20}};}
 const server=createServer(async(req,res)=>{
  const send=(data,status=200)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
  let body='';if(req.method==='POST')for await(const chunk of req)body+=chunk;
  if(req.url==='/fixture/draft')return send(draft);
  if(req.url==='/fixture/tip'){
   const input=JSON.parse(body);operations.push({op:'tip',input});
   if(tipFailure){tipFailure=false;return send({ok:false,error:'Synthetic tip save failed. Try again.'});}
   if(input.customerVersion!==draft.customer_version||input.receiptVersion!==draft.receipt_version||input.draftId!==draft.id)return send({ok:false,error:'The receipt changed. Please select your tip again.'});
   draft={...draft,tip:input.tipAmount,total:draft.total_before_tip+input.tipAmount,last_tip_action_id:input.requestId};changed();return send({ok:true,data:draft});
  }
  if(req.url==='/api/rewards'){
   const q=JSON.parse(body);operations.push({op:'reward:'+q.op});
   if(unavailable)return send({error:'Synthetic reward unavailable'},503);
   if(q.op==='request'){assert.equal(q.args.consent,true);const offer=offers.find(o=>o.id===q.args.offerId);request={...offer,title:offer.title,status:'confirmed',quote:'synthetic-quote',revision:1,expires:gift.expires};draft={...draft,discount:offer.valueCents/100,total_before_tip:100-offer.valueCents/100,total:100-offer.valueCents/100+draft.tip};changed();}
   if(q.op==='cancel'){request=null;draft={...draft,discount:0,total_before_tip:100,total:100+draft.tip};changed();}
   return send({view:view()});
  }
  if(req.url==='/api/gift-cards'){
   const q=JSON.parse(body);operations.push({op:'gift:'+q.op});
   if(q.op==='appearance')return send({installed:true,salonName:'King Nails Spa LLC'});
   if(q.op==='open')gift={...gift,...q.args,prompt:(gift.prompt||0)+1,dismissed:false,revision:gift.revision+1};
   if(q.op==='dismiss')gift={...gift,dismissed:true,qrVisible:false,revision:gift.revision+1};
   if(q.op==='code')gift={...gift,amount:2500,approved:true,card:{id:'card',last4:'4821',balance:2500,status:'active',salonId:'salon',salonName:'King Nails Spa LLC',generation:1,design:{background:'#eee8d9',color:'#344735',image:'',logo:'',elements:[{id:'title',kind:'text',text:'Owner saved artwork',x:50,y:50,size:28,font:'serif'}]}},revision:gift.revision+1};
   return send({installed:true,session:gift});
  }
  if(req.url.startsWith('/api/'))return send({});
  if(req.url.startsWith('/pos/')||req.url.startsWith('/brand/')||req.url.startsWith('/gift-cards/')){
   try{const bytes=await readFile(join('public',req.url));res.setHeader('Content-Type',req.url.endsWith('.svg')?'image/svg+xml':req.url.endsWith('.webp')?'image/webp':'image/png');return res.end(bytes);}catch{res.statusCode=404;return res.end();}
  }
  res.setHeader('Content-Type',req.url==='/a.js'?'text/javascript':req.url==='/a.css'?'text/css':'text/html');res.end(req.url==='/a.js'?js:req.url==='/a.css'?css:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/a.css"><div id="root"></div><script type="module" src="/a.js"></script>');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const out=resolve('artifacts/customer-checkout-benefits/browser');await mkdir(out,{recursive:true});
 let page;const errors=[];
 try{
  page=await browser.newPage({viewport:{width:1920,height:1080}});page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await page.goto(origin);await page.locator('[data-reward-checkout]').waitFor();await page.locator('.customer-checkout-tip-options button').last().waitFor();
  assert.equal(await page.getByRole('button',{name:'Confirm tip',exact:true}).count(),0);
  assert.equal(await page.locator('[data-customer-display-receipt-total]').count(),1);
  assert.equal(await page.locator('.customer-checkout-tip-options button').count(),4,'Empty server options fall back to all four configured tips');
  assert.match(await page.locator('[data-reward-checkout]').evaluate(e=>getComputedStyle(e).backgroundImage),/reward-card-background/);
  await page.screenshot({path:join(out,'01-checkout-default.png'),fullPage:true});
  await page.getByRole('button',{name:'View all rewards (4)',exact:true}).click();await page.getByRole('dialog',{name:'All rewards'}).getByRole('button',{name:'Review',exact:true}).last().click();await page.getByRole('button',{name:'Use 150 points',exact:true}).waitFor();await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Use points',exact:true}).click();await page.getByRole('button',{name:'Use 100 points',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-customer-display-receipt-total]')?.textContent==='$95.00');
  await page.locator('.customer-checkout-tip-options button').last().click();
  await page.waitForFunction(()=>document.querySelector('[data-customer-display-receipt-total]')?.textContent==='$114.00');
  await page.getByRole('button',{name:'Use a card',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Gift card',exact:true});
  await dialog.getByLabel('Card code',{exact:true}).fill('AB12CD34EF567890');await dialog.getByLabel('Security PIN',{exact:true}).fill('12345678');await dialog.getByRole('button',{name:'Check & apply',exact:false}).click();
  await dialog.getByText('Owner saved artwork',{exact:true}).waitFor();await dialog.getByRole('button',{name:'Close gift card',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-customer-display-receipt-total]')?.textContent==='$89.00');await page.waitForFunction(()=>document.querySelector('[data-checkout-earning] b')?.textContent.includes('60'));
  await page.screenshot({path:join(out,'02-reward-tip-gift.png'),fullPage:true});
  assert.equal(await page.locator('.customer-checkout-gift-preview [data-gift-artwork=saved]').count(),1,'Entry preview matches the issued owner artwork');
  await page.getByRole('button',{name:'Custom tip',exact:true}).click();const custom=page.getByRole('dialog',{name:'Custom tip',exact:true});await custom.getByRole('textbox',{name:'Tip amount ($)',exact:true}).fill('12.50');
  await page.waitForFunction(()=>document.querySelector('[data-customer-display-receipt-total]')?.textContent==='$107.50');await custom.getByRole('button',{name:'Done',exact:true}).click();
  assert.equal(await page.locator('[data-checkout-gift-reduction]').count(),0,'Money edits require fresh gift authorization');
  tipFailure=true;await page.getByRole('button',{name:'No tip',exact:true}).click();await page.getByRole('alert').getByText('Synthetic tip save failed. Try again.',{exact:true}).waitFor();assert.equal(draft.tip,12.5);
  await page.getByRole('button',{name:'No tip',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-customer-display-receipt-total]')?.textContent==='$95.00');
  unavailable=true;await page.getByRole('button',{name:'Retry rewards',exact:true}).waitFor({timeout:10000});unavailable=false;await page.getByRole('button',{name:'Retry rewards',exact:true}).click();await page.getByRole('button',{name:'Retry rewards',exact:true}).waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Custom tip',exact:true}).click();await page.getByRole('dialog',{name:'Custom tip',exact:true}).getByRole('textbox',{name:'Tip amount ($)',exact:true}).fill('99');
  draft={...draft,customer_version:draft.customer_version+1,version:draft.version+1};await page.evaluate(next=>window.applyCheckoutSnapshot(next),draft);
  await page.getByRole('dialog',{name:'Custom tip',exact:true}).waitFor({state:'hidden'});await page.waitForTimeout(850);
  assert.equal(operations.filter(o=>o.op==='tip'&&o.input.tipAmount===99).length,0,'Changing customer context cancels the unfinished auto-save');
  for(const size of[{width:1920,height:1080},{width:1366,height:768},{width:1024,height:600},{width:820,height:1180},{width:390,height:844},{width:320,height:568}]){
   await page.setViewportSize(size);await page.waitForTimeout(80);
   assert.ok(await page.locator('.customer-checkout').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'No overflow '+size.width);
   const left=await page.locator('.customer-checkout-receipt').boundingBox(),right=await page.locator('.customer-checkout-actions').boundingBox();
   if(size.width>=900)assert.ok(right.x>=left.x+left.width&&Math.abs(left.y-right.y)<2,'Two aligned columns '+size.width);
   const footer=await page.locator('.customer-checkout-summary').boundingBox();assert.ok(footer.y+footer.height<=left.y+left.height+1,'Totals stay inside receipt '+size.width);
   assert.ok(await page.locator('.customer-checkout-tip-options button').first().evaluate(e=>e.getBoundingClientRect().height>=44));
   await page.screenshot({path:join(out,'checkout-'+size.width+'.png'),fullPage:true});
  }
  assert.deepEqual(errors,[]);await writeFile(join(out,'result.json'),JSON.stringify({passed:true,actualProductComponents:true,syntheticTransport:true,noProductionWrites:true,tipOptions:4,noGlobalConfirm:true,explicitRewardConsent:true,allFourOffers:true,ownerGiftArtwork:true,moneyEditInvalidatesGift:true,customAutoSave:true,tipFailurePreservesMoney:true,errors,operations:operations.map(o=>o.op)},null,2));
 }catch(error){if(page){await page.screenshot({path:join(out,'failure.png'),fullPage:true});console.log(JSON.stringify({errors,total:await page.locator('[data-customer-display-receipt-total]').allTextContents(),body:(await page.locator('body').innerText()).slice(-1800),operations:operations.map(o=>o.op)}));}throw error;}finally{await browser.close();await new Promise(r=>server.close(r));}
});
