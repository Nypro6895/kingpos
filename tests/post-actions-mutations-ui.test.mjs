import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { build } from "esbuild";
import { chromium, webkit } from "playwright-core";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const firstId = "00000000-0000-4000-8000-000000000001";
const otherId = "00000000-0000-4000-8000-000000000002";
const fullCaption = "The full original caption, including details omitted from the card preview.";
const { css } = await postcss([tailwind()]).process('@import "tailwindcss" source(none); @source "./components/post-safety.tsx"; @source "./app/salon-profile/post-actions.tsx";', { from: "post-mutations-fixture.css" });
const bundle = await build({
  stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
    import {PostActions} from './app/salon-profile/post-actions';
    import {postIdentity,useHiddenPosts} from './components/post-safety';
    import {usePostCaption} from './components/post-change-state';
    window.calls=[];window.changed=[];window.events=[];window.hidden=[];window.pins={'${otherId}':true};
    window.permissions={};window.permissionDelay=60;window.mutationResponse='ok';window.permissionSettled=0;
    window.addEventListener('reylumi:post-changed',event=>window.events.push(event.detail));
    const first={sourceType:'beauty_post',sourceId:'${firstId}',title:'Truncated preview'};
    const other={sourceType:'salon_profile_look',sourceId:'${otherId}',title:'Other post'};
    function Card({post,label}){const caption=usePostCaption(post,post.title,'viewer');return <section aria-label={label}><h2>{label}</h2><p data-testid="caption">{caption}</p><PostActions target={post} viewerId="viewer" onHidden={()=>window.hidden.push(label)} onChanged={change=>window.changed.push(change)}/></section>}
    function OwnerBeautyCopy(){const hidden=useHiddenPosts('viewer',true);return hidden.includes(postIdentity(first))?null:<section aria-label="Owner Beauty copy"><h2>Owner Beauty copy</h2></section>}
    function App(){
      const hidden=useHiddenPosts('viewer');const [target,setTarget]=useState(first);window.retarget=setTarget;
      return <main><input aria-label="Unrelated draft" defaultValue="Keep this draft"/>
        {[[target,'Primary copy'],[target,'Another copy'],[other,'Other post']].filter(([post])=>!hidden.includes(postIdentity(post))).map(([post,label])=>
          <Card key={label} post={post} label={label}/>)}<OwnerBeautyCopy/>
      </main>;
    }
    const root=createRoot(document.getElementById('root'));window.remount=()=>root.render(<App key={crypto.randomUUID()}/>);root.render(<App/>);
  ` },
  bundle: true, write: false, outdir: "fixture", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "process.env": '{}' },
  plugins: [{ name: "server-boundaries", setup(builder) {
    const mocks = {
      "@/app/post-moderation/actions": `
        export async function loadHiddenPostIdentitiesAction(){await new Promise(resolve=>setTimeout(resolve,30));window.hiddenSettled=(window.hiddenSettled??0)+1;if(window.remoteHiddenResponse==='throw')throw new Error('Hidden posts unavailable');return window.remoteHiddenResponse??[]}
        export async function postModerationAction(target,action,payload){
          const permission=window.permissions[target.sourceId]??'owner';
          const response=action==='permissions'?permission:window.mutationResponse;
          const delay=action==='permissions'?window.permissionDelay:80;
          window.calls.push({target,action,payload});
          await new Promise(resolve=>setTimeout(resolve,delay));
          if(action==='permissions'){
            window.permissionSettled++;
            if(response==='throw')throw new Error('Permission lookup offline');
            return {data:response==='owner'?{canManage:true,canBlock:false,canFeature:true,caption:'${fullCaption}',...(target.sourceType==='salon_profile_look'?{isPinned:Boolean(window.pins[target.sourceId])}:{})}:{canManage:false},error:null};
          }
          if(response==='throw')throw new Error('Mutation transport offline');
          if(response==='error')return {data:null,error:'Please retry this change.'};
          if(permission!=='owner')return {data:null,error:'You cannot manage this post.'};
          if(action==='feature'){window.pins[target.sourceId]=!window.pins[target.sourceId];return {data:{ok:true,isPinned:window.pins[target.sourceId]},error:null}}
          return {data:{ok:true,...(action==='edit'?{caption:payload.caption.trim()}: {})},error:null};
        }
      `,
      "@/components/workspace-language": "export const useWorkspaceTranslation=()=>text=>text;export const WorkspaceText=({text})=>text;",
      "@/components/salon-report-dialog": "export const SalonReportDialog=()=>null;",
      "next/link": "export default function Link({children,...props}){return <a {...props}>{children}</a>}",
      "next/navigation": "export const useRouter=()=>({refresh:()=>{window.refreshes=(window.refreshes??0)+1}});",
    };
    builder.onResolve({ filter: /.*/ }, args => args.path in mocks ? { path: args.path, namespace: "fixture" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: mocks[args.path], loader: "tsx", resolveDir: process.cwd() }));
  } }],
});

async function fixture(engine, run, options = {}) {
  const executablePath = (engine === chromium
    ? [process.env.TEST_BROWSER_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/chromium"]
    : [webkit.executablePath(), "C:/Users/giuse/AppData/Local/ms-playwright/webkit-2311/Playwright.exe"]
  ).find(path => path && existsSync(path));
  assert.ok(executablePath, "The selected browser must be installed for mutation UI verification");
  const browser = await engine.launch({ executablePath, headless: true });
  try {
    const context = await browser.newContext({ viewport: engine === chromium ? { width: 1280, height: 900 } : { width: 390, height: 844 }, ...(engine === webkit ? { isMobile: true, hasTouch: true } : {}) });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("https://post-mutations.test/", route => route.fulfill({ contentType: "text/html", body: `<meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{font:15px Arial;margin:16px}section{padding:12px;margin:8px 0;border:1px solid #ddd}</style><div id="root"></div><script>window.remoteHiddenResponse=${JSON.stringify(options.remoteHidden ?? [])};${options.localHidden ? `localStorage.setItem('reylumi-hidden-posts:viewer',${JSON.stringify(JSON.stringify(options.localHidden))});` : ""}</script><script src="/app.js"></script>` }));
    await page.route("**/app.js", route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles.find(file => file.path.endsWith(".js")).text }));
    await page.goto("https://post-mutations.test/");
    await page.waitForFunction(() => typeof window.retarget === "function").catch(error => {
      assert.deepEqual(errors, [], "The real shared component must mount in the fixture");
      throw error;
    });
    await run(page);
    assert.deepEqual(errors, [], "Rejected requests must be handled without breaking the page");
  } finally { await browser.close(); }
}

const card = (page, name = "Primary copy") => page.getByRole("region", { name, exact: true });
async function openOwnerMenu(page, name = "Primary copy") {
  await card(page, name).getByLabel("Post actions", { exact: true }).click();
  await page.getByRole("menuitem", { name: "Edit post", exact: true }).waitFor();
}

for (const [name, engine] of [["Chrome", chromium], ["WebKit mobile", webkit]]) {
  test(`${name}: shared edit uses the complete caption and preserves the draft through failure and retry`, { timeout: 120000 }, async () => {
    await fixture(engine, async page => {
      await openOwnerMenu(page);
      await page.evaluate(id => { window.permissions[id] = "throw"; }, firstId);
      await page.getByRole("menuitem", { name: "Edit post", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Edit post", exact: true });
      await dialog.getByRole("alert").filter({ hasText: "This post could not be loaded for editing. Please try again." }).waitFor();
      assert.equal(await dialog.getByLabel("Post caption", { exact: true }).isDisabled(), true);
      assert.equal(await dialog.getByRole("button", { name: "Save changes", exact: true }).isDisabled(), true);
      await page.evaluate(id => { window.permissions[id] = "owner"; }, firstId);
      await dialog.getByRole("button", { name: "Retry loading post", exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('textarea[aria-label="Post caption"]').disabled);
      assert.equal(await dialog.getByLabel("Post caption", { exact: true }).inputValue(), fullCaption);
      await dialog.getByLabel("Post caption", { exact: true }).fill("  Updated caption with all details  ");
      await page.evaluate(() => { window.mutationResponse = "error"; });
      await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
      await dialog.getByRole("alert").filter({ hasText: "Please retry this change." }).waitFor();
      assert.equal(await dialog.getByLabel("Post caption", { exact: true }).inputValue(), "  Updated caption with all details  ");
      assert.deepEqual(await page.evaluate(() => window.changed), []);
      assert.deepEqual(await page.evaluate(() => window.events), []);
      await page.evaluate(() => { window.mutationResponse = "throw"; });
      await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
      await dialog.getByRole("alert").filter({ hasText: "Could not complete the request. Please try again." }).waitFor();
      await page.evaluate(() => { window.mutationResponse = "ok"; });
      await dialog.getByRole("button", { name: "Save changes", exact: true }).dblclick();
      await dialog.waitFor({ state: "hidden" });
      const calls = await page.evaluate(() => window.calls.filter(call => call.action === "edit"));
      assert.equal(calls.length, 3, "Double clicking retry must submit once");
      assert.ok(calls.every(call => call.target.sourceId === firstId && call.target.sourceType === "beauty_post"));
      const [change] = await page.evaluate(() => window.changed);
      assert.equal(change.action, "edit");
      assert.equal(change.target.sourceId, firstId);
      assert.equal(change.caption, "Updated caption with all details", "Use the server-confirmed caption for the update");
      const [event] = await page.evaluate(() => window.events);
      assert.equal(event.viewerId, "viewer");
      assert.equal(event.change.action, "edit");
      assert.equal(event.change.target.sourceId, firstId);
      assert.equal(event.change.caption, change.caption);
      assert.equal(await card(page).getByTestId("caption").innerText(), change.caption);
      assert.equal(await card(page, "Another copy").getByTestId("caption").innerText(), change.caption, "The shared caption hook updates another mounted copy without reloading");
      assert.equal(await card(page, "Other post").getByTestId("caption").innerText(), "Other post");
      await page.evaluate(id => window.dispatchEvent(new CustomEvent("reylumi:post-changed", { detail: { viewerId: "someone-else", change: { target: { sourceType: "beauty_post", sourceId: id }, action: "edit", caption: "Another account's update" } } })), firstId);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await card(page).getByTestId("caption").innerText(), change.caption, "Another viewer's event must not alter this account's mounted cards");
      await page.evaluate(id => window.retarget({ sourceType: "beauty_post", sourceId: id, title: "Newer server caption" }), firstId);
      await card(page).getByTestId("caption").filter({ hasText: "Newer server caption" }).waitFor();
      assert.equal(await page.getByLabel("Unrelated draft").inputValue(), "Keep this draft");
      assert.equal(await card(page, "Another copy").count(), 1);
      assert.equal(await card(page, "Other post").count(), 1);
    });
  });

  test(`${name}: refreshed and stale permissions cannot expose management controls for another post`, { timeout: 120000 }, async () => {
    await fixture(engine, async page => {
      await openOwnerMenu(page);
      await page.keyboard.press("Escape");
      await page.getByRole("menu").waitFor({ state: "hidden" });
      await page.evaluate(id => { window.permissions[id] = "stranger"; window.permissionDelay = 300; }, firstId);
      await card(page).getByLabel("Post actions", { exact: true }).click();
      for (const label of ["Edit post", "Archive post", "Delete post", "Use as featured photo"]) {
        assert.equal(await page.getByRole("menuitem", { name: label, exact: true }).count(), 0, `Clear stale ${label} while refreshing`);
      }
      await page.waitForFunction(() => window.permissionSettled === 2);
      assert.equal(await page.getByRole("menuitem", { name: "Report post", exact: true }).count(), 1);
      await page.keyboard.press("Escape");
      await page.getByRole("menu").waitFor({ state: "hidden" });
      await page.evaluate(id => { window.permissions[id] = "owner"; window.permissionDelay = 300; }, firstId);
      await card(page).getByLabel("Post actions", { exact: true }).click();
      await page.waitForFunction(() => window.calls.filter(call => call.action === "permissions").length === 3);
      await page.evaluate(id => { window.permissions[id] = "stranger"; window.permissionDelay = 30; window.retarget({ sourceType: "salon_profile_look", sourceId: id, title: "Other post" }); }, otherId);
      await page.waitForFunction(() => window.permissionSettled === 4);
      for (const label of ["Edit post", "Archive post", "Delete post", "Use as featured photo"]) {
        assert.equal(await page.getByRole("menuitem", { name: label, exact: true }).count(), 0, `Late permissions for the previous target must not restore ${label}`);
      }
      assert.equal((await page.evaluate(() => window.calls.filter(call => !["permissions"].includes(call.action)))).length, 0);
    });
  });

  test(`${name}: feature toggles use canonical permission state when the shared menu reopens`, { timeout: 120000 }, async () => {
    await fixture(engine, async page => {
      await openOwnerMenu(page, "Other post");
      assert.equal(await page.getByRole("menuitem", { name: "Use as featured photo", exact: true }).count(), 0);
      await page.getByRole("menuitem", { name: "Remove featured selection", exact: true }).click();
      await page.waitForFunction(() => window.changed.some(change => change.action === "feature"));
      assert.equal((await page.evaluate(() => window.changed.find(change => change.action === "feature"))).isPinned, false);
      await openOwnerMenu(page, "Other post");
      assert.equal(await page.getByRole("menuitem", { name: "Remove featured selection", exact: true }).count(), 0);
      await page.getByRole("menuitem", { name: "Use as featured photo", exact: true }).click();
      await page.waitForFunction(() => window.changed.filter(change => change.action === "feature").length === 2);
      assert.equal((await page.evaluate(() => window.changed.filter(change => change.action === "feature")[1])).isPinned, true);
      await openOwnerMenu(page, "Other post");
      assert.equal(await page.getByRole("menuitem", { name: "Remove featured selection", exact: true }).count(), 1);
      assert.equal((await page.evaluate(() => window.calls.filter(call => call.action === "feature"))).length, 2);
    });
  });

  test(`${name}: a menu near the screen edge keeps newly loaded owner actions reachable`, { timeout: 120000 }, async () => {
    await fixture(engine, async page => {
      await page.evaluate(() => { document.body.style.paddingTop = Math.max(0, innerHeight - 160) + "px"; });
      await openOwnerMenu(page);
      const menu = page.getByRole("menu");
      const box = await menu.boundingBox();
      assert.ok(box && box.y >= 0 && box.y + box.height <= page.viewportSize().height + 1, "The full menu or its scroll container must fit in the viewport after owner actions arrive");
      await page.getByRole("menuitem", { name: "Delete post", exact: true }).click();
      await page.getByRole("dialog", { name: "Delete post", exact: true }).waitFor();
    });
  });

  test(`${name}: signed-in legacy hides reconcile with server reports while offline hides are preserved`, { timeout: 120000 }, async () => {
    const legacyArchive = `beauty_post:${firstId}`;
    const serverReport = `salon_profile_look:${otherId}`;
    await fixture(engine, async page => {
      await page.waitForFunction(() => window.hiddenSettled > 0);
      await card(page).waitFor();
      await card(page, "Other post").waitFor({ state: "hidden" });
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("reylumi-hidden-posts:viewer"))), [serverReport], "Only successfully persisted server report/hide identities survive reconciliation");
    }, { localHidden: [legacyArchive, serverReport], remoteHidden: [serverReport] });
    await fixture(engine, async page => {
      await page.waitForFunction(() => window.hiddenSettled > 0);
      assert.equal(await card(page).count(), 0);
      assert.equal(await card(page, "Other post").count(), 1);
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("reylumi-hidden-posts:viewer"))), [legacyArchive], "An unavailable server must preserve the offline list");
    }, { localHidden: [legacyArchive], remoteHidden: "throw" });
  });

  for (const action of ["archive", "delete"]) {
    test(`${name}: ${action} succeeds once, hides all copies of its target and preserves other posts`, { timeout: 120000 }, async () => {
      await fixture(engine, async page => {
        await openOwnerMenu(page);
        const label = action === "archive" ? "Archive post" : "Delete post";
        await page.getByRole("menuitem", { name: label, exact: true }).click();
        const dialog = page.getByRole("dialog", { name: label, exact: true });
        await page.evaluate(() => { window.mutationResponse = "error"; });
        await dialog.getByRole("button", { name: label, exact: true }).click();
        await dialog.getByRole("alert").waitFor();
        assert.equal(await card(page).count(), 1);
        assert.equal(await card(page, "Another copy").count(), 1);
        assert.deepEqual(await page.evaluate(() => window.changed), []);
        assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("reylumi-hidden-posts:viewer") ?? "[]")), []);
        await page.evaluate(() => { window.mutationResponse = "ok"; });
        await dialog.getByRole("button", { name: label, exact: true }).dblclick();
        await dialog.waitFor({ state: "hidden" });
        await card(page).waitFor({ state: "hidden" });
        await card(page, "Another copy").waitFor({ state: "hidden" });
        assert.equal(await card(page, "Other post").count(), 1);
        assert.equal((await page.evaluate(action => window.calls.filter(call => call.action === action), action)).length, 2);
        const changes = await page.evaluate(() => window.changed);
        assert.equal(changes.length, 1);
        assert.equal(changes[0].action, action);
        assert.equal(changes[0].target.sourceId, firstId);
        assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("reylumi-hidden-posts:viewer") ?? "[]")), [], "Archive/delete must not enter the permanent per-viewer report-hidden list");
        if (action === "archive") {
          assert.equal(await card(page, "Owner Beauty copy").count(), 1, "Beauty owners retain their archived post in My posts");
          assert.deepEqual(await page.evaluate(() => window.hidden), [], "Archive must not invoke the permanent removal callback for owner views");
          await page.evaluate(() => window.remount());
          await card(page).waitFor();
          assert.equal(await card(page, "Another copy").count(), 1, "A new mount relies on current server data rather than a permanent local archive exclusion");
        } else {
          assert.equal(await card(page, "Owner Beauty copy").count(), 0);
          assert.deepEqual(await page.evaluate(() => window.hidden), ["Primary copy"]);
        }
      });
    });
  }
}
