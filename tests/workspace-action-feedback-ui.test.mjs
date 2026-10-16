import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const executablePath = process.env.TEST_BROWSER_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";

test("workspace navigation feedback survives closed menus until route readiness and clears on pageshow or Activity hide", { skip: !existsSync(executablePath), timeout: 60000 }, async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React,{Activity,Suspense,useState}from'react';import{createRoot}from'react-dom/client';
      import{CustomerContextSheet,CustomerDesktopWorkspaceSwitcher}from'./app/navigation-shell';import{routes}from'./lib/routes';
      window.routeCalls=[];window.documentCalls=[];window.throwHandoff=false;window.refreshes=0;
      const common={accountId:'account-1',accountName:'Fixture account',avatarUrl:null,businessId:null,businessMode:null,businessName:null,description:null,menuActions:[],primaryAction:null,secondaryAction:null,quickActions:[],roleCode:null,roleLabel:'Owner',salonCount:null,salonId:null,salonMode:null,salonName:null};
      const owner={...common,id:'account-1',type:'account',label:'Fixture owner',defaultHref:'/account',menuActions:[{id:'create',href:routes.salons.create(),label:'Create Salon'}]};
      const salon={...common,id:'salon-1',type:'salon',salonMode:'manage',salonName:'Fixture salon',label:'Fixture salon',defaultHref:'/pos'};
      const personal={...common,id:'personal-1',type:'personal',label:'Fixture viewer',defaultHref:'/explore'};
      let routeReady=false;let resolveRoute;const routePromise=new Promise(resolve=>resolveRoute=resolve);
      window.finishRoute=()=>{routeReady=true;resolveRoute()};
      function Route({path}){if(path!=='/start'&&!routeReady)throw routePromise;return <h1>{path}</h1>}
      function App(){const[open,setOpen]=useState(true);const[visible,setVisible]=useState(true);const[path,setPath]=useState('/start');
        window.setSheetOpen=setOpen;window.setWorkspaceVisible=setVisible;window.pushRoute=href=>{window.routeCalls.push(href);setPath(href)};
        const props={accountAvatarUrl:null,accountEmail:'fixture@example.invalid',accountLabel:'Fixture viewer',currentWorkspace:owner,workspaceOptions:[owner,personal,salon]};
        return <><Activity mode={visible?'visible':'hidden'}>{new URLSearchParams(location.search).get('desktop')==='1'?<CustomerDesktopWorkspaceSwitcher {...props}/>:<CustomerContextSheet {...props} isOpen={open} onClose={()=>setOpen(false)}/>}</Activity><Suspense fallback={<p>Route waiting</p>}><Route path={path}/></Suspense></>}
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": process.cwd() }, define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "workspace-navigation-fixture", setup(builder) {
      const modules = {
        "next/navigation": `export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);export const useRouter=()=>({push(href){window.pushRoute(href)},refresh(){window.refreshes++}});`,
        "next/link": `export const useLinkStatus=()=>({pending:false});export default function Link({prefetch,...props}){return <a {...props}/>}`,
        "next/image": `export default function Image({fill,priority,...props}){return <img {...props}/>}`,
        "@/components/workspace-language": `export const WorkspaceText=({text})=>text;export const useWorkspaceTranslation=()=>value=>value;`,
        "@/lib/workspace-navigation": `export function navigateToWorkspace(id,href){window.documentCalls.push({id,href});if(window.throwHandoff)throw Error('Fixture blocked handoff')}`,
        "@/app/explore/explore-header-search-slot": `export const ExploreHeaderSearchSlot=()=>null;`,
        "@/components/workspace-navigation-icon": `export const WorkspaceNavigationIcon=()=>null;`,
        "@/components/role-more-content": `export const RoleMoreContent=()=>null;`,
        "@/app/account/logout-button": `export function LogoutButton({children,...props}){return <button {...props}>{children}</button>}`,
        "@/components/explore-advertising": `export const ExploreAdSlot=()=>null;`,
        "@/app/action-dialog": `export function ActionDialog({open,description,onClose}){return open?<div role='alert'>{description}<button onClick={onClose}>Dismiss fixture alert</button></div>:null}`,
        "@/app/customer-shell-context": `export const CustomerShellContextProvider=({children})=>children;`,
        "@/app/notifications/notification-list": `export const NotificationFeedList=()=>null;`,
        "@/app/quick-workspace-panel": `export const QuickWorkspacePanel=()=>null;`,
        "@/lib/supabase/browser": `export const createSupabaseBrowserClient=()=>null;`,
        "@/lib/notification-client": `export const NOTIFICATIONS_REFRESH='fixture:refresh';export function markAllCenterViewed(){}export const useNotificationSummary=()=>({});`,
      };
      builder.onResolve({ filter: /./ }, args => args.path in modules ? { path: args.path, namespace: "fixture" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "tsx", resolveDir: process.cwd(), contents: modules[args.path] }));
      // Exercise these private production components without changing their exports.
      builder.onLoad({ filter: /[/\\]app[/\\]navigation-shell\.tsx$/ }, args => ({ loader: "tsx", resolveDir: process.cwd() + "/app", contents: readFileSync(args.path, "utf8") + "\nexport { CustomerContextSheet, CustomerDesktopWorkspaceSwitcher };" }));
    }}],
  });
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", request.url === "/fixture.js" ? "text/javascript" : "text/html");
    response.end(request.url === "/fixture.js" ? bundle.outputFiles[0].text : '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:Arial}button{min-height:32px}button:disabled{opacity:.5}.fixed{position:fixed}.inset-x-0{left:0;right:0}.top-0{top:0}.h-1{height:4px}.block{display:block}.bg-brand-orange{background:#f26f3d}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ executablePath, headless: true, args: ["--no-proxy-server"] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const visit = desktop => page.goto(`http://127.0.0.1:${server.address().port}/fixture?desktop=${desktop ? "1" : "0"}`);
  const progress = page.getByRole("status").filter({ hasText: "Opening…" });
  const open = async desktop => { if (desktop) await page.getByRole("button", { name: "Open account menu", exact: true }).click(); else await page.evaluate(() => window.setSheetOpen(true)); };
  try {
    for (const desktop of [false, true]) {
      await visit(desktop); await open(desktop);
      await page.getByRole("button", { name: "Create Salon", exact: true }).click();
      await progress.waitFor();
      if (desktop) await page.keyboard.press("Escape"); else await page.evaluate(() => window.setSheetOpen(false));
      if (desktop) assert.equal(await page.getByTestId("customer-desktop-account-menu").count(), 0); else assert.equal(await page.getByRole("dialog").count(), 0);
      assert.equal(await progress.count(), 1, "closed menu must keep global route feedback");
      assert.equal(await progress.evaluate(element => element.parentElement === document.body), true, "feedback is not clipped inside the closed sheet");
      assert.equal(await page.getByRole("heading", { name: "/start", exact: true }).count(), 1, "previous route remains usable while destination waits");
      assert.equal(await page.evaluate(() => window.routeCalls.length), 1);
      assert.equal(await page.evaluate(() => window.refreshes), 1);
      await page.evaluate(() => window.finishRoute());
      await progress.waitFor({ state: "detached" });

      await visit(desktop); await open(desktop);
      await page.getByRole("button", { name: "Switch to Fixture salon", exact: true }).evaluate(button => { button.click(); button.click(); });
      await progress.waitFor();
      assert.equal(await page.evaluate(() => window.documentCalls.length), 1, "same-tick duplicate clicks do not repeat the workspace handoff");
      assert.deepEqual(await page.evaluate(() => window.documentCalls[0]), { id: "salon-1", href: undefined }, "workspace switching retains the existing checked handoff destination");
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
      await progress.waitFor({ state: "detached" });
      await open(desktop);
      assert.equal(await page.getByRole("button", { name: "Switch to Fixture salon", exact: true }).isDisabled(), false, "BFCache restore releases the duplicate guard");
      await page.evaluate(() => { window.throwHandoff = true; });
      await page.getByRole("button", { name: "Switch to Fixture salon", exact: true }).click();
      await page.getByRole("alert").waitFor();
      assert.equal(await progress.count(), 0, "a blocked navigation recovers without stuck progress");
      assert.equal(await page.getByRole("button", { name: "Switch to Fixture salon", exact: true }).isDisabled(), false);
      await page.evaluate(() => { window.throwHandoff = false; });
      await page.getByRole("button", { name: "Switch to Fixture salon", exact: true }).click();
      await progress.waitFor();
      await page.evaluate(() => window.setWorkspaceVisible(false));
      await progress.waitFor({ state: "detached" });
      await page.evaluate(() => window.setWorkspaceVisible(true));
      assert.equal(await progress.count(), 0, "an old document navigation cannot reappear on Activity reveal");
      await open(desktop);
      assert.equal(await page.getByRole("button", { name: "Switch to Fixture salon", exact: true }).isDisabled(), false);
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
