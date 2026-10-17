import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";
const executablePath = process.env.TEST_BROWSER_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";

test("owner campaign popup works on mobile and desktop with retained inputs and accessible dismissal", { skip:!fs.existsSync(executablePath) }, async () => {
  const bundle = await build({
    stdin:{resolveDir:process.cwd(),loader:"tsx",contents:`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{OwnerCampaignDialog}from'./components/owner-campaign-dialog';import{CampaignWorkspace}from'./app/campaigns/campaign-workspace';import{DEFAULT_OWNER_CAMPAIGN_SETTINGS}from'./types/owner-campaign';function App(){const[open,setOpen]=useState(false);return <><button id="open" onClick={()=>setOpen(true)}>Promote</button><CampaignWorkspace initialCampaigns={[]} initialError=""/>{open?<OwnerCampaignDialog target={{sourceId:'20000000-0000-0000-0000-000000000001',sourceType:'salon_profile_look',salonId:'10000000-0000-0000-0000-000000000001',title:'Fresh summer nails'}} settings={DEFAULT_OWNER_CAMPAIGN_SETTINGS} initialLocation={{city:'Chicago',state:'Illinois',country:'United States'}} onClose={()=>setOpen(false)}/>:null}</>};createRoot(document.getElementById('root')).render(<App/>);`},
    bundle:true,write:false,outfile:"fixture.js",format:"iife",jsx:"automatic",alias:{"@":process.cwd()},plugins:[{name:"actions",setup(builder){
      builder.onResolve({filter:/^(next\/(link|image|navigation)|@\/app\/campaigns\/actions|\.\/(actions|credit-actions|creative-actions))$/},args=>({path:args.path,namespace:"stub"}));
      builder.onLoad({filter:/.*/,namespace:"stub"},args=>({loader:"js",resolveDir:process.cwd(),contents:args.path==="next/navigation"?`export function useRouter(){return{refresh(){}}}export function usePathname(){return '/campaigns'}`:args.path==="next/image"?`import React from'react';export default function Image({unoptimized,fill,...props}){return React.createElement('img',props)}`:args.path==="next/link"?`import React from'react';export default function Link(props){return React.createElement('a',props,props.children)}`:`export async function campaignWalletAction(){return{available_credits:0,auto_topup_enabled:false,installed:true,topup_credits:500,threshold_credits:100,monthly_limit_cents:3000}};export async function loadCampaignResultsAction(){return[]};export async function saveCampaignLimitAction(){return{ok:true,message:'Saved'}};export async function loadCampaignPostsAction(){return[]};export async function campaignCardSetupAction(){return{ok:false,message:'Unavailable'}};export async function campaignPaymentControlAction(){return{ok:true,message:'Saved'}};export async function loadCampaignCardAction(){return null};export async function loadCampaignLedgerAction(){return{entries:[],hasMore:false}};export async function saveCampaignRemindersAction(){};export async function createOwnerCampaignAction(input){window.savedCampaign=input;return{ok:true,message:"Your ad is saved."}};export async function loadOwnerCampaignsAction(){return{campaigns:[]}};export async function changeOwnerCampaignAction(){return{ok:true,message:'Updated'}};export async function fundSavedCampaignAction(){return{ok:true,message:'Ready'}};export async function buyCampaignCreditsAction(){return{ok:false,message:'Payment not connected'}};export async function saveCampaignTopupAction(){return{ok:true,message:'Saved'}};export async function createCampaignCreativeAction(form){window.savedCreative={title:form.get("title"),caption:form.get("caption"),image:form.get("image").name};return{ok:true,target:{sourceId:'20000000-0000-0000-0000-000000000002',sourceType:'custom',title:'My custom ad'}}};` }));
    }}],
  });
  const js=bundle.outputFiles.find(f=>f.path.endsWith(".js")).text;
  const css=bundle.outputFiles.find(f=>f.path.endsWith(".css")).text;
  const server=createServer((req,res)=>{res.setHeader("Content-Type",req.url==="/fixture.js"?"text/javascript":"text/html");res.end(req.url==="/fixture.js"?js:`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#fcfdfb;font-family:Arial,sans-serif}*{box-sizing:border-box}${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`)});
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const browser=await chromium.launch({executablePath,headless:true});
  const failures=[];
  try {
    fs.mkdirSync("artifacts/owner-campaigns",{recursive:true});
    for(const [name,width,height] of [["desktop",1440,1000],["mobile",390,844]]){
      const page=await browser.newPage({viewport:{width,height}});
      page.on("pageerror",error=>failures.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.screenshot({path:path.resolve(`artifacts/owner-campaigns/${name}-workspace.png`),fullPage:true});
      await page.locator("#open").click();
      await page.getByRole("dialog").waitFor();
      await page.screenshot({path:path.resolve(`artifacts/owner-campaigns/${name}-suggestion.png`)});
      await page.getByRole("button",{name:"Get more people"}).click();
      await page.getByLabel("City",{exact:true}).fill("Chicago");
      await page.getByRole("button",{name:"14 days",exact:true}).click();
      await page.screenshot({path:path.resolve(`artifacts/owner-campaigns/${name}-setup.png`)});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
      await page.getByRole("button",{name:"Continue"}).click();
      await page.getByRole("button",{name:"Back",exact:true}).click();
      assert.equal(await page.getByLabel("City",{exact:true}).inputValue(),"Chicago");
      await page.getByRole("button",{name:"Continue"}).click();
      await page.getByRole("button",{name:"Save campaign"}).click();
      await page.getByRole("heading",{name:"Your campaign is saved."}).waitFor();
      assert.equal(await page.evaluate(()=>window.savedCampaign.days),14);
      await page.getByRole("button",{name:"Done",exact:true}).click();
      await page.locator("#open").click();
      await page.keyboard.press("Escape");
      assert.equal(await page.getByRole("dialog").count(),0);
      assert.equal(await page.evaluate(()=>document.activeElement.id),"open");
      await page.getByRole("button",{name:"Create new",exact:true}).click();
      await page.getByRole("button",{name:"Add a new photo & message",exact:true}).click();
      await page.getByLabel("Your photo").setInputFiles({name:"salon.png",mimeType:"image/png",buffer:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR9kAAAAASUVORK5CYII=","base64")});
      await page.getByLabel("Headline").fill("My custom ad");await page.getByLabel("What would you like to say?").fill("Visit our beautiful salon.");
      await page.screenshot({path:path.resolve(`artifacts/owner-campaigns/${name}-custom-ad.png`)});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
      await page.getByRole("button",{name:"Choose audience"}).click();await page.getByLabel("City",{exact:true}).waitFor();
      assert.equal(await page.evaluate(()=>window.savedCreative.title),"My custom ad");
      await page.screenshot({path:path.resolve(`artifacts/owner-campaigns/${name}-credit-setup.png`)});
      await page.keyboard.press("Escape");
      await page.getByRole("button",{name:"Settings",exact:true}).first().click();
      assert.equal(await page.getByRole("switch",{name:/Automatically buy/}).isChecked(),false);
      await page.screenshot({path:path.resolve(`artifacts/owner-campaigns/${name}-credits.png`),fullPage:true});
      await page.close();
    }
    assert.deepEqual(failures,[]);
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
