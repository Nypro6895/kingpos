import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

test('real kiosk: persistent salon QR → phone → hello → services → confirmation and summary',{
 skip:!process.env.TEST_BROWSER_PATH,timeout:120000,
},async()=>{
 const bundle=await build({bundle:true,write:false,format:'iife',jsx:'automatic',outdir:'fixture',define:{'process.env.NODE_ENV':'"production"'},stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
  import React from 'react';import {createRoot} from 'react-dom/client';import {CustomerDisplayClient} from './app/pos/customer-display/customer-display-client';
  window.calls=[];window.lookupFail=false;window.saveFail=false;
  window.multipleAccounts=new URL(location.href).searchParams.has('accounts');
  window.kingposDisplay={printCheckinReceipt:async()=>{window.calls.push(['print']);}};
  window.services=[{id:'s1',name:'Manicure',basePrice:35,durationMinutes:30,category:'Nails',sortOrder:0},{id:'s2',name:'Pedicure',basePrice:45,durationMinutes:45,category:'Nails',sortOrder:1}];
  window.visit={id:'visit1',customerId:'customer1',firstName:'Nene',phone:'5035550100',requestedServices:[],source:'walk_in',status:'waiting',checkedInAt:new Date().toISOString(),ticketId:null,appointmentId:null};
  window.snapshot={id:'draft1',token:'display1',salon_id:'salon1',version:1,status:'draft',customer:null,items:[],staff_lines:[],payments:[],discount:0,subtotal:0,tax:0,tip:0,total:0,total_before_tip:0,receipt_version:1,server_now:new Date().toISOString()};
  const settings={salonName:'Nails Studio',salonLogoUrl:null,appDownloadUrl:'',customerShowSalonName:true,customerShowCustomerName:true,customerShowServiceName:true,customerShowStaffName:true,customerShowReceiptStatus:true,customerShowBarcode:false,tipSuggestions:[],customerBackgroundImageUrl:null,customerLeftAdImageUrl:null,customerRightAdImageUrl:null,customerPromoTitle:'Welcome',customerPromoBody:'',customerLeftAdText:'',customerRightAdText:''};
  window.fetch=async()=>({ok:true,json:async()=>({entry:'00000000-0000-4000-8000-000000000111'})});
  createRoot(document.getElementById('root')).render(<CustomerDisplayClient token="display1" settings={settings} serviceCatalog={window.services}/>);
 `},plugins:[{name:'boundaries',setup(b){
  b.onResolve({filter:/app\/pos\/actions$|workspace-language$|supabase\/browser$|pos-local-display$|pos-workspace-sync$|^\.\/actions$|next\/navigation|app\/pos\/checkin-receipt-actions$|browser-public-origin$/},a=>({path:a.path,namespace:'stub'}));
  b.onLoad({filter:/.*/,namespace:'stub'},a=>({loader:'tsx',resolveDir:process.cwd(),contents:
   a.path.endsWith('app/pos/actions')?`
    export const getPosLiveDraft=async()=>({ok:true,data:window.snapshot});export const getCustomerDisplayLiveDraftTipOptions=async()=>({ok:true,data:[]});
    export const submitCustomerDisplayPhone=async input=>{window.calls.push(['lookup',input]);if(window.multipleAccounts&&!input.identityChoice)return {ok:false,code:'identity_choice_required',error:'Choose your account.',candidates:[{id:'nene',label:'Nene',phoneHint:'••• 0100'},{id:'other',label:'Other',phoneHint:'••• 0100'}]};return {ok:true,data:{mode:'check_in',state:'checked_in',visit:structuredClone(window.visit)}};};
    export const saveCustomerDisplayRequestedServices=async input=>{window.calls.push(['confirm',input]);if(window.saveFail)return {ok:false,error:'Please retry.'};window.visit.requestedServices=window.services.filter(s=>input.serviceIds.includes(s.id));return {ok:true,data:{mode:'check_in',state:'checked_in',visit:structuredClone(window.visit)}};};
    export const findLiveDraftCustomerByPhone=async()=>({ok:true,data:null});export const createLiveDraftCustomer=async()=>({ok:true,data:null});
    export const confirmCustomerDisplayLiveDraftTip=async()=>({ok:true,data:window.snapshot});export const resetCustomerDisplayCompletedDraft=async()=>({ok:true,data:window.snapshot});export const searchCustomerDisplayLiveDraftCustomers=async()=>({ok:true,data:[]});`:
   a.path.endsWith('workspace-language')?'export const WorkspaceText=({text})=>text;export const useWorkspaceTranslation=()=>text=>text;':
   a.path.endsWith('supabase/browser')?'export const createSupabaseBrowserClient=()=>null;':
   a.path.endsWith('pos-local-display')?'export const subscribeLocalDisplay=()=>()=>{};export const connectLocalReceipt=()=>({close(){}});export const localReceiptSnapshot=(a)=>a;export const requestLocalReceiptTip=async()=>false;export const requestLocalReceiptCustomer=async()=>false;export const dismissLocalReceipt=()=>{};export const publishLocalDisplaySnapshot=()=>{};':
   a.path.endsWith('pos-workspace-sync')?'export const usePosResourceRefresh=()=>{};':
   a.path.endsWith('checkin-receipt-actions')?'export const issueCheckinReceipt=async()=>({receipt:{visitId:"visit1",salonName:"Nails Studio",customerName:"Nene",queueNumber:28,businessDate:"2026-10-26"}});':
   a.path.endsWith('browser-public-origin')?'export const browserPublicOrigin=()=>"https://reylumi.com";':
   a.path==='next/navigation'?'export const useRouter=()=>({refresh(){}});':
   'export const issueServiceRelayPass=async()=>({data:{passToken:"pass1",queueNumber:28}});'
  }));
 }}]});
 const style=fs.readFileSync('app/globals.css','utf8').replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source "./pos/customer-display";\n@source "./service-relay/customer-relay.tsx";');
 const css=(await postcss([tailwind({base:process.cwd()})]).process(style,{from:'app/globals.css'})).css;
 const script=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text;
 const server=createServer((req,res)=>{
  const asset=path.resolve('public','.'+new URL(req.url,'http://fixture').pathname);
  if(asset.startsWith(path.resolve('public')+path.sep)&&fs.existsSync(asset)&&fs.statSync(asset).isFile()){res.setHeader('Content-Type',asset.endsWith('.svg')?'image/svg+xml':asset.endsWith('.webp')?'image/webp':'image/png');res.end(fs.readFileSync(asset));return;}
  res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':req.url==='/app.css'?'text/css':'text/html');res.end(req.url==='/app.js'?script:req.url==='/app.css'?css:'<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH,headless:true});
 const out='artifacts/phone-checkin-20261026';fs.mkdirSync(out,{recursive:true});
 try{for(const [width,height] of [[1024,768],[768,1024],[375,812]]){
  const page=await browser.newPage({viewport:{width,height}}),errors=[];page.on('pageerror',e=>{errors.push(e.message);process.stderr.write('Browser error: '+e.message+'\n');});
  await page.goto('http://127.0.0.1:'+server.address().port);
  const attract=page.locator('[data-customer-display-attract]');await attract.waitFor();
  await page.getByLabel('Scan to check in on your phone',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-salon-checkin-qr]').count(),1);
  await page.screenshot({path:`${out}/${width}-welcome.png`});
  await attract.click({position:{x:30,y:Math.min(200,height/3)}});
  // Use the actual keypad, not component state injection.
  for(const digit of '5035550100')await page.getByRole('button',{name:`Digit ${digit}`,exact:true}).click();
  await page.getByRole('heading',{name:'Hello, NENE!'}).waitFor();
  const confirm=page.getByRole('button',{name:'Confirm check-in',exact:true});assert.equal(await confirm.isDisabled(),true);
  await page.getByRole('button',{name:/Manicure/}).click();await page.getByRole('button',{name:/Pedicure/}).click();
  await page.getByText('Estimated total $80.00',{exact:false}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:`${out}/${width}-services.png`});
  await page.evaluate(()=>window.saveFail=true);await confirm.click();await page.getByText('Please retry.',{exact:true}).waitFor();
  await page.evaluate(()=>window.saveFail=false);await confirm.click();
  await page.getByRole('heading',{name:"You're checked in!"}).waitFor();
  assert.match(await page.locator('[data-customer-display-checkin]').innerText(),/Manicure[\s\S]*Pedicure[\s\S]*80\.00/);
  await page.getByText("Please have a seat. Our team will guide you when it's your turn.",{exact:true}).waitFor();
  await page.getByText('Your number #28',{exact:true}).waitFor();
  await page.waitForFunction(()=>window.calls.some(c=>c[0]==='print'));
  await page.screenshot({path:`${out}/${width}-confirmed.png`});
  assert.equal(await page.evaluate(()=>window.calls.filter(c=>c[0]==='confirm').length),2);
  await page.goto('http://127.0.0.1:'+server.address().port+'?accounts=1');await page.locator('[data-customer-display-attract]').click({position:{x:30,y:150}});
  for(const digit of '5035550100')await page.getByRole('button',{name:`Digit ${digit}`,exact:true}).click();
  await page.getByRole('heading',{name:'Choose your account',exact:true}).waitFor();
  assert.equal(await page.locator('[data-customer-display-create-profile]').count(),0);
  await page.getByRole('button',{name:/Nene.*0100/}).click();await page.getByRole('heading',{name:'Hello, NENE!'}).waitFor();
  assert.equal(await page.evaluate(()=>window.calls.at(-1)[1].identityChoice),'nene');
  assert.deepEqual(errors,[]);await page.close();
 }}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
