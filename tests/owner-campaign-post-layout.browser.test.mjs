
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
const output='artifacts/owner-campaign-thumbnail-list/browser';
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
export const loadCampaignPreviewAction=async(id)=>{window.previewReads=(window.previewReads||0)+1;const c=window.fixture.campaigns.find(c=>c.id===id);return {campaign:c,returns:{total:0,known:0,closure:0,limit:0,complete:true,reason:null},checkedAt:new Date().toISOString(),creativeError:null,creative:{title:c.title,caption:id.endsWith("1")?"A fresh French manicure, ready for your next visit.\\nSoft pink with a clean white finish.":"A little color for your next visit.",image:location.search.includes("broken")&&!window.repairPhoto?"/broken.webp":id.endsWith("1")?"/post-photo.webp":"/portrait.svg"}}};
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
  if(req.url==='/post-photo.webp')return send('image/webp',fs.readFileSync('public/images/nail-defaults/nails-01.webp'));
  if(req.url==='/portrait.svg')return send('image/svg+xml','<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="#e8b8ba"/><circle cx="300" cy="350" r="160" fill="#faf2e7"/><text x="135" y="600" font-size="34" fill="#6d4547">Portrait photo</text></svg>');
  if(req.url==='/broken.webp'){res.writeHead(404);return res.end()}
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

test('owner thumbnail lists stay compact, open full previews and retain controls',async()=>{
 const local=await fixture(),browser=await chromium.launch({headless:true,executablePath:process.env.TEST_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const checks=[];
 try{
  for(const width of [320,390,1280]){
   const page=await browser.newPage({viewport:{width,height:844}}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.goto(local.url+'/owner');
   const landscape=page.getByRole('img',{name:'New salon look',exact:true});
   await landscape.waitFor();await landscape.evaluate(img=>img.decode());
   await page.getByRole('heading',{name:'We can do this!',exact:true}).scrollIntoViewIfNeeded();
   const portrait=page.getByRole('img',{name:'We can do this!',exact:true});await portrait.waitFor();await portrait.evaluate(img=>img.decode());
   for(const image of [landscape,portrait]){
    const box=await image.boundingBox();
    assert.equal(box.width,72);assert.equal(box.height,72);
    assert.equal(await image.evaluate(img=>getComputedStyle(img).objectFit),'cover');

   }
   await page.getByText('A fresh French manicure, ready for your next visit.',{exact:false}).waitFor();
   assert.equal(await page.locator('details').first().getAttribute('open'),null,'totals stay secondary to the post');
   await page.getByRole('button',{name:'Reserve & submit',exact:true}).waitFor();
   assert.equal(local.events.length,0,'owner photos do not call advertising delivery or impression APIs');
   await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:output+'/owner-list-'+width+'.png',fullPage:true});
   await page.locator('article').first().screenshot({path:output+'/owner-first-row-'+width+'.png'});
   await page.getByRole('button',{name:'Preview post: New salon look',exact:true}).click();
   const preview=page.getByRole('dialog',{name:'Ad preview'});await preview.waitFor();
   const full=preview.locator('img');await full.evaluate(img=>img.decode());const fullBox=await full.boundingBox();
   assert.ok(fullBox.width>72);assert.equal(await full.evaluate(img=>getComputedStyle(img).objectFit),'contain');
   await page.getByRole('button',{name:'Close dialog'}).click();
   await page.locator('article').first().getByRole('button',{name:'Settings',exact:true}).click();
   await page.getByRole('dialog',{name:'Campaign settings'}).waitFor();
   await page.getByRole('button',{name:'Close dialog'}).click();
   await page.getByRole('button',{name:'History',exact:true}).click();
   await page.getByRole('img',{name:'New salon look',exact:true}).waitFor();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.screenshot({path:output+'/history-list-'+width+'.png',fullPage:true});
   checks.push({width,landscape:true,portrait:true,history:true,noOverflow:true,noDeliveryRequests:true});
   assert.deepEqual(errors,[]);await page.close();
  }
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.goto(local.url+'/owner?broken=1');
  await page.getByRole('button',{name:'Retry photo'}).first().waitFor();
  await page.getByRole('button',{name:'Reserve & submit',exact:true}).waitFor();
  await page.evaluate(()=>{window.repairPhoto=true});
  await page.getByRole('button',{name:'Retry photo'}).first().click();
  const repaired=page.getByRole('img',{name:'New salon look',exact:true});await repaired.waitFor();await repaired.evaluate(img=>img.decode());
  await page.close();
  fs.writeFileSync(output+'/checks.json',JSON.stringify({checks,retry:true},null,2));
 }finally{await browser.close();await local.close()}
});
