import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { build } from "esbuild";
import { chromium } from "playwright-core";

// The real components run against a synthetic, local-only persistence fixture.
// Database authorization and transition guarantees are tested separately.
async function fixture() {
  const apps = [];
  const calls = [];
  let failNext = false;
  let failTransport = false;
  let releasePending;
  let delayNext = false;
  const publisher = { id: randomUUID(), name: "Example Studio" };
  const actions = `
    const call = name => (_previous, form) => window.registryAction(name, form);
    export const saveDraftAction = call('save');
    export const submitDraftAction = call('submit');
    export const withdrawSubmissionAction = call('withdraw');
    export const reviewSubmissionAction = call('review');
  `;
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(), loader: "tsx", contents: `
        import React, {useEffect, useState} from 'react';
        import {createRoot} from 'react-dom/client';
        import Layout from './app/(market-private)/layout';
        import {DeveloperWorkspace} from './components/market-registry/developer-workspace';
        import {ReviewWorkspace} from './components/market-registry/review-workspace';
        import {RegistryUnavailable} from './components/market-registry/registry-shell';
        window.registryAction = async (name, form) => {
          const result = await fetch('/action', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name, fields:Object.fromEntries(form)})});
          if (!result.ok) throw Error('Local test transport failure');
          return result.json();
        };
        function Preview() {
          const [data, setData] = useState(null);
          useEffect(() => {
            const load = () => fetch('/state').then(response => response.json()).then(setData);
            load(); window.addEventListener('registry-refresh', load);
            return () => window.removeEventListener('registry-refresh', load);
          }, []);
          return <Layout>{location.pathname === '/unavailable' ? <RegistryUnavailable /> : !data ? <p>Loading fixture…</p> : location.pathname === '/market-review' ? <ReviewWorkspace queue={data.queue}/> : <DeveloperWorkspace workspace={data.workspace}/>}</Layout>;
        }
        createRoot(document.getElementById('root')).render(<Preview/>);
      `,
    },
    bundle: true, write: false, outdir: "fixture", jsx: "automatic",
    plugins: [{ name: "local-registry-actions", setup(builder) {
      builder.onResolve({ filter: /^@\/app\/\(market-private\)\/actions$/ }, () => ({ path: "actions", namespace: "fixture" }));
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ loader: "js", contents: path === "actions" ? actions : "export const useRouter = () => ({refresh: () => window.dispatchEvent(new Event('registry-refresh'))});" }));
    } }],
  });
  const js = bundle.outputFiles.find(file => file.path.endsWith(".js")).text;
  const css = bundle.outputFiles.filter(file => file.path.endsWith(".css")).map(file => file.text).join("\n");
  const queue = () => apps.flatMap(app => app.submissions.filter(item => item.status === "submitted").map(item => ({ ...item, publisher_name: publisher.name, app_registry_key: app.registry_key, previous_manifest: app.submissions.find(previous => previous.draft_version < item.draft_version)?.manifest ?? null })));
  const server = createServer(async (req, res) => {
    const json = value => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(value)); };
    if (req.url === "/bundle.js") { res.setHeader("Content-Type", "application/javascript"); return res.end(js); }
    if (req.url === "/state") return json({ workspace: { publisher, apps }, queue: { submissions: queue() } });
    if (req.url === "/action" && req.method === "POST") {
      let body = ""; for await (const chunk of req) body += chunk;
      const { name, fields } = JSON.parse(body); calls.push({ name, fields });
      if (failTransport) { failTransport = false; res.statusCode = 503; return json({ ok: false }); }
      if (delayNext) { delayNext = false; await new Promise(resolve => { releasePending = resolve; }); }
      if (failNext) { failNext = false; return json({ ok: false, message: "This draft or submission changed. Reload it before trying again." }); }
      if (name === "save") {
        if (!/^\d+\.\d+\.\d+/.test(fields.appVersion)) return json({ ok: false, message: "Use a version such as 1.0.0 or 1.0.0-beta.1." });
        const manifest = { manifestSchemaVersion: 1, appVersion: fields.appVersion, displayName: fields.displayName, description: fields.description, requestedCapabilities: [] };
        let app = apps.find(item => item.id === fields.appId);
        if (!app) { app = { id: randomUUID(), registry_key: "test-app", draft_version: 1, draft_manifest: manifest, submissions: [] }; apps.unshift(app); }
        else { assert.equal(Number(fields.expectedVersion), app.draft_version); app.draft_version++; app.draft_manifest = manifest; }
        return json({ ok: true, message: "Draft saved." });
      }
      if (name === "submit") {
        const app = apps.find(item => item.id === fields.appId);
        assert.equal(Number(fields.expectedVersion), app.draft_version);
        app.submissions.unshift({ id: randomUUID(), app_id: app.id, draft_version: app.draft_version, manifest: structuredClone(app.draft_manifest), manifest_hash: String(app.draft_version).padStart(64, "0"), status: "submitted", submitted_at: new Date().toISOString(), review: null });
        return json({ ok: true, message: "Submitted for review." });
      }
      const submission = apps.flatMap(app => app.submissions).find(item => item.id === fields.submissionId);
      assert.equal(fields.expectedHash, submission.manifest_hash);
      if (name === "withdraw") { submission.status = "withdrawn"; submission.withdrawn_at = new Date().toISOString(); return json({ ok: true, message: "Submission withdrawn." }); }
      assert.equal(name, "review");
      assert.equal(Number(fields.expectedVersion), submission.draft_version);
      assert.ok(["metadata_approved", "rejected"].includes(fields.decision));
      submission.status = fields.decision;
      submission.review = { decision: fields.decision, reason: fields.reason, reviewed_at: new Date().toISOString() };
      return json({ ok: true, message: "Review recorded." });
    }
    res.setHeader("Content-Type", "text/html;charset=utf-8");
    res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}*{box-sizing:border-box}${css}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}`, apps, calls, fail: () => { failNext = true; }, transportFail: () => { failTransport = true; }, delay: () => { delayNext = true; }, release: () => { delayNext = false; releasePending?.(); } };
}

test("private registry UI persists drafts, protects unsaved input, reviews frozen versions and starts revisions", { timeout: 60_000 }, async () => {
  const f = await fixture();
  let browser;
  try {
    browser = await chromium.launch({ channel: "msedge", headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 980 } });
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    const requests = []; page.on("request", request => requests.push(request.url()));
    await page.goto(`${f.base}/developers/market`);
    await page.getByRole("heading", { name: "Start an app draft" }).waitFor();
    await page.getByLabel("App name", { exact: true }).fill("Salon Notes");
    await page.getByLabel("Description", { exact: true }).fill("A private appointment notes concept.");
    await page.getByLabel("App version", { exact: true }).fill("bad-version");
    await page.getByRole("button", { name: "Create draft", exact: true }).click();
    await page.getByRole("alert").waitFor();
    assert.equal(await page.getByLabel("App name", { exact: true }).inputValue(), "Salon Notes");
    assert.equal(await page.getByLabel("App version", { exact: true }).inputValue(), "bad-version");
    assert.equal(await page.getByLabel("Description", { exact: true }).inputValue(), "A private appointment notes concept.");
    await page.getByLabel("App version", { exact: true }).fill("1.0.0");
    f.transportFail();
    await page.getByRole("button", { name: "Create draft", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "The request could not be completed" }).waitFor();
    assert.equal(await page.getByLabel("App name", { exact: true }).inputValue(), "Salon Notes");
    assert.equal(await page.getByLabel("Description", { exact: true }).inputValue(), "A private appointment notes concept.");
    f.delay();
    await page.getByRole("button", { name: "Create draft", exact: true }).click();
    await page.getByText("Saving your request…", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Create draft", exact: true }).isDisabled(), true);
    f.release();
    await page.getByRole("heading", { name: "App details", exact: true }).waitFor();
    assert.equal(f.apps.length, 1);
    await page.reload();
    await page.getByRole("button", { name: "Save draft", exact: true }).waitFor();
    assert.equal(await page.getByLabel("Description", { exact: true }).inputValue(), "A private appointment notes concept.");
    await page.getByLabel("Description", { exact: true }).fill("Updated notes concept.");
    assert.equal(await page.getByRole("button", { name: "Submit saved draft", exact: true }).isDisabled(), true);
    f.fail();
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await page.getByRole("alert").waitFor();
    assert.equal(await page.getByLabel("Description", { exact: true }).inputValue(), "Updated notes concept.");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await page.getByText("Saved revision 2", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Submit saved draft", exact: true }).click();
    await page.getByRole("button", { name: "Withdraw submission", exact: true }).waitFor();
    assert.equal(await page.getByLabel("Description", { exact: true }).count(), 0);
    assert.equal(f.apps[0].submissions[0].manifest.description, "Updated notes concept.");
    await page.goto(`${f.base}/market-review`);
    await page.getByRole("button", { name: "Request changes", exact: true }).waitFor();
    await page.getByLabel("Reason or feedback", { exact: true }).fill("Please explain the intended salon workflow.");
    f.fail();
    await page.getByRole("button", { name: "Request changes", exact: true }).click();
    await page.getByRole("alert").waitFor();
    assert.equal(await page.getByLabel("Reason or feedback", { exact: true }).inputValue(), "Please explain the intended salon workflow.");
    await page.getByRole("button", { name: "Request changes", exact: true }).click();
    await page.getByRole("heading", { name: "No submissions waiting", exact: true }).waitFor();
    await page.goto(`${f.base}/developers/market`);
    await page.getByRole("button", { name: "Save new revision", exact: true }).waitFor();
    await page.getByText("Please explain the intended salon workflow.", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Submit saved draft", exact: true }).isDisabled(), true);
    const inert = '<img src="https://remote.invalid/pixel" onerror="alert(1)"> Plain text';
    await page.getByLabel("Description", { exact: true }).fill(inert);
    await page.getByLabel("App version", { exact: true }).fill("1.0.1");
    await page.getByRole("button", { name: "Save new revision", exact: true }).click();
    await page.getByText("Saved revision 3", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Submit saved draft", exact: true }).click();
    await page.getByRole("button", { name: "Withdraw submission", exact: true }).waitFor();
    assert.equal(f.apps[0].submissions[1].manifest.description, "Updated notes concept.");
    await page.goto(`${f.base}/market-review`);
    await page.getByRole("table").waitFor();
    assert.match(await page.getByRole("table").innerText(), /Updated notes concept/);
    assert.match(await page.getByRole("table").innerText(), /remote\.invalid/);
    assert.equal(await page.locator("img, iframe").count(), 0);
    await mkdir("artifacts/market-registry-ui", { recursive: true });
    await page.screenshot({ path: "artifacts/market-registry-ui/reviewer-desktop.png", fullPage: true });
    await page.getByLabel("Reason or feedback", { exact: true }).fill("The submitted description is clear for this private review.");
    await page.getByRole("button", { name: "Approve details", exact: true }).click();
    await page.getByRole("heading", { name: "No submissions waiting", exact: true }).waitFor();
    await page.goto(`${f.base}/developers/market`);
    await page.getByText("Details approved", { exact: true }).first().waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: "artifacts/market-registry-ui/developer-mobile.png", fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.getByRole("button", { name: "Save new revision", exact: true }).click();
    await page.getByText("Saved revision 4", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Submit saved draft", exact: true }).click();
    await page.getByRole("button", { name: "Withdraw submission", exact: true }).waitFor();
    await page.getByRole("button", { name: "Withdraw submission", exact: true }).click();
    await page.getByRole("button", { name: "Save new revision", exact: true }).waitFor();
    assert.equal(f.apps[0].submissions[0].status, "withdrawn");
    assert.ok(f.calls.filter(call => call.name === "review").every(call => call.fields.reason && call.fields.expectedHash.length === 64));
    assert.equal(requests.some(url => !url.startsWith(f.base)), false);
    assert.deepEqual(errors, []);
    await page.goto(`${f.base}/unavailable`);
    await page.getByRole("heading", { name: "This workspace is unavailable", exact: true }).waitFor();
    assert.equal(await page.locator("form").count(), 0);
  } finally {
    f.release();
    await browser?.close();
    f.server.closeAllConnections();
    await new Promise(resolve => f.server.close(resolve));
  }
});
