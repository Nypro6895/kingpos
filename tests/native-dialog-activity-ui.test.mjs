import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const executablePath = process.env.TEST_BROWSER_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";

test("native dialogs release document inertness on Activity hide, reopen, and preserve ad drafts", { timeout: 90000, skip: !existsSync(executablePath) }, async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(), loader: "tsx", contents: `
import React,{Activity,useState} from 'react';import{createRoot}from'react-dom/client';
import{OwnerCampaignDialog}from'./components/owner-campaign-dialog';import{CreateCampaign}from'./app/campaigns/create-campaign';
import{ExploreSearchToolbar}from'./app/explore/explore-search-toolbar';import{SalonOperatingStatusBadge}from'./components/salon-operating-status-badge';
import{SessionExpiryPrompt}from'./components/session-expiry-prompt';import{WindowsPosDownloadPrompt}from'./components/windows-pos-download';
import{DEFAULT_OWNER_CAMPAIGN_SETTINGS}from'./types/owner-campaign';
window.validSession=false;window.revoked=[];window.saved=0;window.calls=[];
const revoke=URL.revokeObjectURL.bind(URL);URL.revokeObjectURL=url=>{window.revoked.push(url);revoke(url)};
window.fetch=async(input,init)=>{const url=String(input);window.calls.push(url);if(url.startsWith('/api/auth/session'))return Response.json({authenticated:window.validSession});if(url==='/api/pos/windows-download')return Response.json({show:true,release:{href:'/installer.exe',version:'1',edition:'release'}});return Response.json({});};
function App(){const[kind,setKind]=useState('owner');const[visible,setVisible]=useState(true);const[open,setOpen]=useState(false);const[clicks,setClicks]=useState(0);window.setVisible=setVisible;window.setKind=value=>{setKind(value);setOpen(false);setVisible(true);};return <><button id='outside' onClick={()=>setClicks(v=>v+1)}>Outside {clicks}</button><output id='clicks'>{clicks}</output><button id='open' onClick={()=>setOpen(true)}>Open</button><Activity key={kind} mode={visible?'visible':'hidden'}>
{kind==='owner'&&open?<OwnerCampaignDialog target={{sourceId:'20000000-0000-0000-0000-000000000001',sourceType:'salon_profile_look',salonId:'10000000-0000-0000-0000-000000000001',title:'Fresh nails'}} settings={DEFAULT_OWNER_CAMPAIGN_SETTINGS} initialStep='setup' initialLocation={{city:'Chicago',state:'Illinois',country:'United States'}} onClose={()=>setOpen(false)}/>:null}
{kind==='create'&&open?<CreateCampaign onClose={()=>setOpen(false)} onCreated={()=>{window.saved+=1;setOpen(false)}}/>:null}
{kind==='area'?<ExploreSearchToolbar query='' category='' location='' locationSource='unset' scopePolicy='expandable' locating={false} pending={false} message={null} areaOpen={open} onAreaOpenChange={setOpen} onSearch={()=>{}} onSuggestionSelect={()=>{}} onAreaApply={()=>{}} onCurrentLocation={()=>{}}/>:null}
{kind==='hours'?<SalonOperatingStatusBadge salonId='salon' status={{isOpen:true,kind:'open',label:'Open',detail:null}}/>:null}
{kind==='session'?<SessionExpiryPrompt authenticated/>:null}
{kind==='windows'?<WindowsPosDownloadPrompt authenticated/>:null}
</Activity></>};createRoot(document.getElementById('root')).render(<App/>);`,
    },
    bundle: true, write: false, outfile: "fixture.js", format: "iife", jsx: "automatic", alias: { "@": process.cwd() },
    plugins: [{ name: "stubs", setup(builder) {
      builder.onResolve({ filter: /^(next\/(link|image|navigation)|@\/components\/(workspace-language|reylumi-icons)|@\/app\/campaigns\/actions|\.\/creative-actions|@\/app\/salon-profile\/operating-hours-display|@\/app\/explore\/explore-search-input|@\/app\/login\/login-form|@\/lib\/(reset-experience-cache|experience-resource-cache))$/ }, args => ({ path: args.path, namespace: "stub" }));
      builder.onLoad({ filter: /.*/, namespace: "stub" }, args => ({ loader: "tsx", resolveDir: process.cwd(), contents:
        args.path === "next/navigation" ? `export function usePathname(){return '/settings'}` :
        args.path === "next/link" ? `import React from'react';export default function Link(props){return <a {...props}/ >}` :
        args.path === "next/image" ? `import React from'react';export default function Image({unoptimized,fill,...props}){return <img {...props}/ >}` :
        args.path.endsWith("workspace-language") ? `export function WorkspaceText({text}){return text}export function useWorkspaceTranslation(){return text=>text}` :
        args.path.endsWith("reylumi-icons") ? `export function ReylumiIcon(){return null}` :
        args.path.endsWith("operating-hours-display") ? `export function OperatingHoursDisplay(){return '9 am to 5 pm'}` :
        args.path.endsWith("explore-search-input") ? `import React from'react';export function ExploreSearchInput(){return <input aria-label='Explore query'/>}` :
        args.path.endsWith("login-form") ? `import React from'react';export function LoginForm({onAuthenticated}){return <button id='renew-session' onClick={()=>{window.validSession=true;onAuthenticated()}}>Log in</button>}` :
        args.path.endsWith("reset-experience-cache") ? `export function resetExperienceCaches(){}` :
        args.path.endsWith("experience-resource-cache") ? `export function invalidateExperienceResources(){}` :
        `export async function createOwnerCampaignAction(){return{ok:true,message:'Saved'}}export async function createCampaignCreativeAction(form){window.savedForm={title:form.get('title'),caption:form.get('caption'),image:form.get('image').name};return{ok:true,target:{sourceId:'creative',sourceType:'custom',title:form.get('title')}}}`,
      }));
    }}],
  });
  const script = bundle.outputFiles.find(file => file.path.endsWith(".js")).text;
  const css = bundle.outputFiles.find(file => file.path.endsWith(".css"))?.text || "";
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", request.url === "/fixture.js" ? "text/javascript" : "text/html");
    response.end(request.url === "/fixture.js" ? script : `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:Arial}dialog{max-height:85vh;max-width:90vw;overflow:auto}${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const failures = [];
    page.on("pageerror", error => failures.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const opened = () => page.waitForFunction(() => document.querySelectorAll("dialog:modal").length === 1);
    const hiddenAndUsable = async () => {
      await page.evaluate(() => window.setVisible(false));
      await page.waitForFunction(() => document.querySelectorAll("dialog[open],dialog:modal").length === 0);
      assert.equal(await page.evaluate(() => document.body.style.overflow), "");
      const before = Number(await page.locator("#clicks").innerText());
      await page.locator("#outside").click({ timeout: 3000 });
      assert.equal(Number(await page.locator("#clicks").innerText()), before + 1, "another page must remain clickable, not inert");
    };
    const reveal = async () => { await page.evaluate(() => window.setVisible(true)); };
    const choose = async kind => { await page.evaluate(value => window.setKind(value), kind); };

    await page.locator("#open").click(); await opened();
    await page.getByLabel("City", { exact: true }).fill("Madison");
    await hiddenAndUsable(); await reveal(); await opened();
    assert.equal(await page.getByLabel("City", { exact: true }).inputValue(), "Madison");
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => document.activeElement.id), "outside", "reopened dialog restores the current page's opener");

    await choose("area"); await page.getByRole("button", { name: "Search area: Anywhere", exact: true }).click(); await opened();
    await page.getByLabel("City, state or ZIP", { exact: true }).fill("Chicago");
    await hiddenAndUsable(); await reveal(); await opened();
    assert.equal(await page.getByLabel("City, state or ZIP", { exact: true }).inputValue(), "Chicago");
    await page.getByRole("button", { name: "Close search area", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll("dialog:modal").length === 0);
    assert.equal(await page.evaluate(() => document.activeElement.id), "explore-search-area");

    await choose("hours"); await page.getByRole("button", { name: "View salon operating hours" }).click(); await opened();
    await hiddenAndUsable(); await reveal();
    await page.getByRole("button", { name: "View salon operating hours" }).click(); await opened();
    await page.getByRole("button", { name: "Close operating hours", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll("dialog:modal").length === 0);

    await choose("create"); await page.locator("#open").click(); await opened();
    await page.getByLabel("Your photo").setInputFiles({ name: "draft.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR9kAAAAASUVORK5CYII=", "base64") });
    await page.getByLabel("Headline").fill("My saved draft");
    await page.getByLabel("What would you like to say?").fill("A quiet afternoon at our salon.");
    await page.waitForFunction(() => document.querySelector('img[alt="Your ad preview"]')?.naturalWidth > 0);
    const previousUrl = await page.getByAltText("Your ad preview").getAttribute("src");
    await hiddenAndUsable();
    assert.ok(await page.evaluate(url => window.revoked.includes(url), previousUrl));
    await reveal(); await opened();
    await page.waitForFunction(old => { const image = document.querySelector('img[alt="Your ad preview"]'); return image?.src !== old && image?.naturalWidth > 0; }, previousUrl);
    assert.equal(await page.getByLabel("Headline").inputValue(), "My saved draft");
    assert.equal(await page.getByLabel("Your photo").evaluate(element => element.files[0].name), "draft.png");
    await page.getByRole("button", { name: "Choose audience" }).click();
    await page.waitForFunction(() => window.saved === 1);
    assert.deepEqual(await page.evaluate(() => window.savedForm), { title: "My saved draft", caption: "A quiet afternoon at our salon.", image: "draft.png" });

    await choose("session"); await opened(); await hiddenAndUsable();
    await page.evaluate(() => { window.validSession = true; });
    await reveal(); await page.waitForFunction(() => document.querySelectorAll("dialog:modal").length === 0);
    await page.evaluate(() => { window.validSession = false; window.dispatchEvent(new Event("focus")); });
    await opened(); await page.locator("#renew-session").click();
    await page.waitForFunction(() => document.querySelectorAll("dialog:modal").length === 0);

    await choose("windows"); await opened(); await hiddenAndUsable(); await reveal(); await opened();
    await page.getByRole("button", { name: "Close download reminder", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll("dialog:modal").length === 0);
    assert.deepEqual(failures, []);
  } finally {
    await browser.close(); await new Promise(resolve => server.close(resolve));
  }
});
