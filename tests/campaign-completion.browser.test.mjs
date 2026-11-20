
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
const output='artifacts/campaign-completion/browser';
fs.mkdirSync(output,{recursive:true});
const actions=`const ok=async()=>({ok:true,message:"Saved"});
export const changeOwnerCampaignAction=ok,createOwnerCampaignAction=ok,runAgainOwnerCampaignAction=ok,fundSavedCampaignAction=ok,saveCampaignLimitAction=ok;
export const loadOwnerCampaignsAction=async()=>({campaigns:window.fixture.campaigns,hasMore:false});
export const loadOwnerCampaignAction=async(id)=>window.fixture.campaigns.find(c=>c.id===id);
export const loadCampaignPostsAction=async()=>[];
export const loadCampaignReportAction=async()=>({days:[{day:new Intl.DateTimeFormat("en-CA",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date()),views:0,clicks:1,likes:0,comments:0,bookings:0}],deliveryReason:"in_review",checkedAt:new Date().toISOString(),lastViewAt:null,bookingOutcomes:{completed:0,cancelled:0,other:0,unavailable:0}});
export const campaignWalletAction=async()=>window.fixture.wallet;
export const buyCampaignCreditsAction=ok,campaignCardSetupAction=ok,campaignPaymentControlAction=ok,saveCampaignRemindersAction=ok;
export const saveCampaignTopupAction=async(input)=>{window.autoConsent=input;return {ok:true,message:"Saved"}};
export const loadCampaignCardAction=async()=>({brand:"visa",last4:"4242"}),loadCampaignLedgerAction=async()=>({entries:[],hasMore:false});
export const loadCampaignPreviewAction=async()=>{throw Error("Not used")};
export const createCampaignCreativeAction=async()=>{throw Error("No upload fixture")};`;
const entry=`import React from "react";import{createRoot}from"react-dom/client";
import{OwnerSponsoredPost}from"./components/owner-sponsored-post";
import{CampaignWorkspace}from"./app/campaigns/campaign-workspace";
import{CreditPanel}from"./app/campaigns/credit-panel";
import{OwnerCampaignDialog}from"./components/owner-campaign-dialog";
import{DEFAULT_OWNER_CAMPAIGN_SETTINGS as settings}from"./types/owner-campaign";
window.fixture={wallet:{available_credits:300,reserved_credits:300,welcome_credits:300,installed:true,auto_topup_enabled:false,topup_credits:500,threshold_credits:100,monthly_limit_cents:3000,payment_ready:true,has_payment_method:true},campaigns:[]};
const c={id:"30000000-0000-0000-0000-000000000001",salon_id:"10000000-0000-0000-0000-000000000001",source_type:"custom",source_id:"20000000-0000-0000-0000-000000000001",title:"New salon look",area:"city",location:"Milwaukee",country:"US",state:"WI",city:"Milwaukee",days:3,daily_views:500,daily_price_cents:100,total_price_cents:300,status:"awaiting_payment",views:0,clicks:0,likes:0,comments:0,bookings:0,spent_cents:0,created_at:new Date().toISOString(),starts_at:null,ends_at:null};
window.fixture.campaigns=[c,{...c,id:"30000000-0000-0000-0000-000000000002",title:"We can do this!",status:"pending_review"}];
const route=location.pathname;
createRoot(document.getElementById("root")).render(route.startsWith("/ad")?<OwnerSponsoredPost location="Milwaukee"/>:route==="/credits"?<CreditPanel wallet={window.fixture.wallet} initialView="auto"/>:route==="/create"?<OwnerCampaignDialog target={{sourceType:"custom",sourceId:c.source_id,salonId:c.salon_id,title:"New salon look"}} settings={settings} initialLocation={{city:"Milwaukee",state:"WI",country:"US"}} initialStep="setup" availableCredits={300} onClose={()=>{}}/>:<CampaignWorkspace initialCampaigns={window.fixture.campaigns} initialError="" wallet={window.fixture.wallet} settings={settings}/>);`;
async function fixture(){
 const built=await build({stdin:{contents:entry,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,outfile:'fixture.js',format:'iife',jsx:'automatic',alias:{'@':process.cwd()},define:{'process.env.NODE_ENV':'"development"','process.env':'{}'},plugins:[{name:'isolated-actions',setup(b){
  b.onResolve({filter:/(^@\/app\/campaigns\/actions$|\/?(credit-actions|preview-actions|creative-actions)$|^\.\/actions$)/},()=>({path:'actions',namespace:'fixture'}));
  b.onResolve({filter:/^@\/components\/workspace-language$/},()=>({path:'language',namespace:'fixture'}));
  b.onResolve({filter:/^next\/navigation$/},()=>({path:'navigation',namespace:'fixture'}));
  b.onResolve({filter:/^next\/link$/},()=>({path:'link',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='actions'?actions:a.path==='language'?'export const WorkspaceText=({text})=>text;const translate=s=>s;export const useWorkspaceTranslation=()=>translate;':a.path==='navigation'?'const router={refresh(){}};export const useRouter=()=>router;export const usePathname=()=>"/campaigns";export const useSearchParams=()=>new URLSearchParams();':'export default function Link(p){return <a {...p}/>}',loader:'jsx',resolveDir:process.cwd()}));
 }}]});
 const js=built.outputFiles.find(f=>f.path.endsWith('.js')).text,css=built.outputFiles.find(f=>f.path.endsWith('.css')).text;
 const events=[];
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#e1b5af"/><text x="50" y="200" fill="#512821" font-size="32">Salon photo fixture</text></svg>';
 const server=createServer(async(req,res)=>{
  const send=(type,body)=>{res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(body)};
  if(req.url==='/fixture.js')return send('text/javascript',js);
  if(req.url==='/photo.svg')return send('image/svg+xml',svg);
  if(req.url.startsWith('/api/campaigns/delivery')){
   if(req.method==='POST'){let raw='';for await(const chunk of req)raw+=chunk;events.push({...JSON.parse(raw),referer:req.headers.referer});return send('application/json','{"ok":true}')}
   const count=req.headers.referer?.includes('single')?1:5;
   return send('application/json',JSON.stringify(Array.from({length:count},(_,i)=>({salonName:'Lumi Nail Studio',salonLocation:'Milwaukee, WI',title:'New salon look '.repeat(10),caption:'Beautiful nails and thoughtful service. '.repeat(60),image:'/photo.svg',href:'/destination',ticket:'ticket-'+i}))));
  }
  send('text/html','<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;font-family:Arial;background:#fff;color:#23382d}button,input,select{font:inherit}'+css+'</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {url:'http://127.0.0.1:'+server.address().port,events,close:()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve)})};
}
test('real campaign components: long ads, fast clicks, truthful zero state and exact automatic consent',async()=>{
 const local=await fixture(),browser=await chromium.launch({headless:true,executablePath:process.env.TEST_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const checks=[],errors=[]; const newPage=async(options)=>{const page=await browser.newPage(options);page.on('pageerror',e=>errors.push(e.message));return page;};
 try{
  for(const width of [320,390,1280])for(const mode of ['single','carousel']){
   const page=await newPage({viewport:{width,height:720}});
   await page.goto(local.url+'/ad-'+mode);
   await page.getByRole('article',{name:'Sponsored post'}).first().waitFor();
   await page.waitForTimeout(1300);
   const view=local.events.filter(e=>e.kind==='view'&&e.referer===local.url+'/ad-'+mode);
   assert.ok(view.length>0,'long '+mode+' ad earns a view at '+width);
   const rect=await page.getByRole('article',{name:'Sponsored post'}).first().boundingBox();
   assert.ok(rect.height<720,'card fits the viewport');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.screenshot({path:output+'/ad-'+mode+'-'+width+'.png',fullPage:true});
   checks.push({width,mode,height:rect.height,views:view.length});
   await page.close();local.events.length=0;
  }
  const fast=await newPage({viewport:{width:390,height:720}});
  await fast.goto(local.url+'/ad-fast');await fast.getByRole('link',{name:'Discover this post →'}).first().click();
  await fast.waitForURL('**/destination');await fast.waitForTimeout(200);
  assert.equal(local.events.filter(e=>e.kind==='click').length,1);
  assert.equal(local.events.filter(e=>e.kind==='view').length,0);
  await fast.close();
  for(const width of [320,390,1280]){
   const page=await newPage({viewport:{width,height:844}});
   await page.goto(local.url+'/owner');
   await page.locator('summary').filter({hasText:'Your campaign results'}).waitFor();
   assert.equal(await page.getByText('Customers are noticing your salon',{exact:true}).count(),0);
   await page.getByText('In review',{exact:true}).waitFor();
   await page.getByRole('button',{name:'View results →'}).first().click();
   await page.getByText('This ad will not be shown until it is approved.',{exact:false}).waitFor();
   await page.getByRole('button',{name:'Unique clicks',exact:true}).click();
   await page.getByRole('button',{name:'Close dialog'}).click();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.screenshot({path:output+'/owner-'+width+'.png',fullPage:true});
   await page.goto(local.url+'/credits');
   await page.getByLabel('Monthly credit limit').fill('3600.6');
   await page.getByLabel('Monthly credit limit').fill('3600');
   await page.getByRole('button',{name:'Review payment & confirm →'}).click();
   await page.getByText('3,600 credits · $30.00',{exact:true}).waitFor();
   assert.equal(await page.getByText('$300.00',{exact:false}).count(),0);
   await page.screenshot({path:output+'/consent-'+width+'.png',fullPage:true});
   await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Enable automatic purchases'}).click();
   await page.waitForFunction(()=>window.autoConsent);
   assert.equal(await page.evaluate(()=>window.autoConsent.limit),3000);
   assert.equal(await page.evaluate(()=>window.autoConsent.amount),500);
   await page.goto(local.url+'/create');
   await page.getByRole('button',{name:'Continue →'}).click();
   await page.getByText('360 credits · $3.00',{exact:true}).waitFor();
   await page.getByRole('button',{name:'Reserve credits & submit for review'}).waitFor();
   await page.screenshot({path:output+'/review-'+width+'.png',fullPage:true});
   await page.close();
  }
  assert.deepEqual(errors,[]);
  fs.writeFileSync(output+'/checks.json',JSON.stringify({checks,fastClick:{clicks:1,views:0},consent:{credits:3600,usd:30,payloadUnits:3000}},null,2));
 }finally{await browser.close();await local.close()}
});
