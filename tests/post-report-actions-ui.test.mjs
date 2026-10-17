import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

test("post report survives permission and submission failures, retries the selected reason, and hides only its target", { timeout: 120000 }, async () => {
  const { css } = await postcss([tailwind()]).process('@import "tailwindcss" source(none); @source "./components/post-safety.tsx"; @source "./app/salon-profile/post-actions.tsx";', { from: "post-report-fixture.css" });
  const result = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {PostActions} from './app/salon-profile/post-actions';
      import {postIdentity,useHiddenPosts} from './components/post-safety';
      window.calls=[];window.hiddenCallbacks=[];window.permissionResponse='throw';window.permissionSettled=0;window.reportResponse='error';window.serverHidden=[];
      const posts=[{sourceType:'beauty_post',sourceId:'00000000-0000-4000-8000-000000000001',title:'First look'},{sourceType:'salon_profile_look',sourceId:'00000000-0000-4000-8000-000000000002',title:'Second look'}];
      function App(){const hidden=useHiddenPosts('viewer-1');return <main>{posts.filter(post=>!hidden.includes(postIdentity(post))).map(post=><section key={post.sourceId} aria-label={post.title}><h2>{post.title}</h2><PostActions target={post} viewerId="viewer-1" onHidden={()=>window.hiddenCallbacks.push(post.sourceId)}/></section>)}</main>}
      createRoot(document.getElementById('root')).render(<App/>);
    ` }, bundle: true, write: false, outdir: "fixture", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "process.env": '{}' },
    plugins: [{ name: "server-boundaries", setup(builder) {
      const mocks = {
        "next/navigation": "export const useRouter=()=>({refresh(){}});export const usePathname=()=>'/explore';",
        "@/app/post-moderation/actions": `
          export async function loadHiddenPostIdentitiesAction(){return window.serverHidden}
          export async function postModerationAction(target,action,payload){
            window.calls.push({target,action,payload});
            const response=action==='permissions'?window.permissionResponse:window.reportResponse;
            await new Promise(resolve=>setTimeout(resolve,80));
            if(action==='permissions'){
              window.permissionSettled++;
              if(response==='throw')throw new Error('Permission transport offline');
              return {data:response==='owner'?{canBlock:true,canManage:true,canFeature:true,canPromote:true}:{},error:null};
            }
            if(response==='throw')throw new Error('Report transport offline');
            if(response==='error')return {data:null,error:'Please retry your report.'};
            if(action==='report')window.serverHidden=[...new Set([...window.serverHidden,target.sourceType+':'+target.sourceId])];
            return {data:{supportHref:'/support/report-1'},error:null};
          }
        `,
        "@/app/salon-profile/report-actions": "export async function reportSalonAction(){throw new Error('Unexpected salon report')}"
      };
      builder.onResolve({ filter: /.*/ }, args => args.path in mocks ? { path: args.path, namespace: "fixture" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: mocks[args.path], loader: "tsx", resolveDir: process.cwd() }));
    } }]
  });
  const executablePath = [process.env.TEST_BROWSER_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/chromium"].find(path => path && existsSync(path));
  assert.ok(executablePath, "A Chromium browser is required for the post report UI test");
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("https://post-report.test/", route => route.fulfill({ contentType: "text/html", body: `<style>${css}body{font:15px Arial;margin:16px}section{padding:16px;margin:16px 0;border:1px solid #ddd}</style><div id="root"></div><script src="/app.js"></script>` }));
    await page.route("**/app.js", route => route.fulfill({ contentType: "text/javascript", body: result.outputFiles.find(file => file.path.endsWith(".js")).text }));
    await page.goto("https://post-report.test/");
    const first = page.getByRole("region", { name: "First look", exact: true });
    const second = page.getByRole("region", { name: "Second look", exact: true });
    await first.getByLabel("Post actions").click();
    await page.waitForFunction(() => window.permissionSettled === 1);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.deepEqual(errors, [], "rejected permission loading must not escape as an unhandled error");
    assert.equal(await page.getByRole("menuitem", { name: "Report post", exact: true }).count(), 1);
    for (const name of ["Block user", "Edit post", "Archive post", "Delete post", "Use as featured photo", "Let more people see it"]) {
      assert.equal(await page.getByRole("menuitem", { name, exact: true }).count(), 0, name);
    }
    await page.getByRole("menuitem", { name: "Report post", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Report", exact: true });
    await dialog.waitFor();
    assert.equal(await dialog.getByRole("button", { name: "Send", exact: true }).count(), 0);
    await dialog.getByRole("button", { name: "Scam, fraud or false information", exact: false }).click();
    await dialog.getByRole("button", { name: "Send", exact: true }).click();
    await dialog.getByRole("alert").filter({ hasText: "Please retry your report." }).waitFor();
    assert.equal(await dialog.getByText("Scam, fraud or false information", { exact: true }).count(), 1);
    assert.equal(await first.count(), 1);
    assert.equal(await second.count(), 1);
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("reylumi-hidden-posts:viewer-1") ?? "[]")), []);
    await page.evaluate(() => { window.reportResponse = "throw"; });
    await dialog.getByRole("button", { name: "Send", exact: true }).click();
    await dialog.getByRole("alert").filter({ hasText: "Could not complete the request. Please try again." }).waitFor();
    assert.equal(await dialog.getByText("Scam, fraud or false information", { exact: true }).count(), 1);
    await page.evaluate(() => { window.reportResponse = "ok"; });
    await dialog.getByRole("button", { name: "Send", exact: true }).dblclick();
    await dialog.getByRole("status").waitFor();
    assert.equal(await dialog.getByRole("link", { name: "View report & conversation" }).getAttribute("href"), "/support/report-1");
    const submissions = await page.evaluate(() => window.calls.filter(call => call.action === "report"));
    assert.equal(submissions.length, 3, "a double click must produce one successful submission");
    for (const submission of submissions) {
      assert.equal(submission.target.sourceType, "beauty_post");
      assert.equal(submission.target.sourceId, "00000000-0000-4000-8000-000000000001");
      assert.equal(submission.payload.reason, "scam");
    }
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await first.waitFor({ state: "hidden" });
    assert.equal(await second.count(), 1);
    assert.deepEqual(await page.evaluate(() => window.hiddenCallbacks), ["00000000-0000-4000-8000-000000000001"]);
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("reylumi-hidden-posts:viewer-1"))), ["beauty_post:00000000-0000-4000-8000-000000000001"]);
    await page.evaluate(() => { window.permissionResponse = "owner"; });
    await second.getByLabel("Post actions").click();
    await page.getByRole("menuitem", { name: "Edit post", exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("menu").waitFor({ state: "hidden" });
    await page.evaluate(() => { window.permissionResponse = "throw"; });
    await second.getByLabel("Post actions").click();
    await page.waitForFunction(() => window.permissionSettled === 3);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.getByRole("menuitem", { name: "Report post", exact: true }).count(), 1);
    for (const name of ["Block user", "Edit post", "Archive post", "Delete post", "Use as featured photo", "Let more people see it"]) {
      assert.equal(await page.getByRole("menuitem", { name, exact: true }).count(), 0, `failed refresh must clear ${name}`);
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
