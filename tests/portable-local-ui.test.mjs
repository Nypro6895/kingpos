import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { chromium } from "playwright-core";

test("browser: mounted tabs, offline edits, durable retry, reload and local display transport", {
  skip: !process.env.ESBUILD_MODULE_PATH || !process.env.TEST_BROWSER_PATH,
  timeout: 60_000,
}, async () => {
  const { build } = await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
  const repo = resolve(".").replaceAll("\\", "/");
  const scratch = mkdtempSync(join(tmpdir(), "kingpos-portable-ui-"));
  const entry = join(scratch, "entry.tsx");
  writeFileSync(entry, `
    import React, {useState,useCallback,useMemo} from 'react';
    import {createRoot} from 'react-dom/client';
    import {PortablePanels} from '${repo}/app/pos/portable/portable-panels';
    import {savePortableOperation} from '${repo}/lib/portable-operations';
    import {usePortableDraft} from '${repo}/app/pos/portable/use-portable-draft';
    import {subscribeLocalDisplay,publishLocalDisplaySnapshot} from '${repo}/lib/pos-local-display';
    window.publishSnapshot=publishLocalDisplaySnapshot;
    subscribeLocalDisplay('test-token',snapshot=>window.receivedSnapshot=snapshot);
    function Desk(){
      const [amount,setAmount]=useState('');
      const recovery=useMemo(()=>({amount}),[amount]);
      const restore=useCallback(value=>setAmount(value.amount),[]);
      const onVersion=useCallback(()=>{},[]);
      const sync=usePortableDraft({scope:'test-salon:test-token',operationScope:'test-salon:key',version:window.serverVersion,recovery,emptyRecovery:{amount:''},restore,onVersion});
      window.commitBeforeCrash=()=>savePortableOperation('test-salon:key','receipt',{localDraftKey:sync.recoveryKey.current});
      return <><input aria-label="Amount" value={amount} onChange={event=>{
        const value=event.target.value;setAmount(value);
        sync.enqueue({token:'test-token',selectedStaffId:null,staffLines:[],customer:null,
          subtotal:Number(value),total:Number(value),totalBeforeTip:Number(value),tip:0,tax:0,discount:0});
      }}/><p data-status>{sync.status}</p><span data-ready>{String(sync.ready)}</span></>;
    }
    function App(){return <><nav><a href="/pos/portable">POS</a> <a href="/pos/portable/book">Book</a></nav>
      <PortablePanels panels={{'/pos/portable':<Desk/>,'/pos/portable/book':<input aria-label="Booking note"/>}}>
        <p>Uncached server route</p>
      </PortablePanels></>}
    createRoot(document.getElementById('root')).render(<App/>);
  `);
  const bundled = await build({ entryPoints: [entry], bundle: true, write: false,
    format: "iife", platform: "browser", jsx: "automatic", nodePaths: [join(repo, "node_modules")],
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "navigation-fixture", setup(b) {
      b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "fixture" }));
      b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ resolveDir: repo, contents: `
        import {useSyncExternalStore} from 'react';
        const push=history.pushState.bind(history);
        history.pushState=(...args)=>{push(...args);window.dispatchEvent(new Event('popstate'));};
        const subscribe=f=>{window.addEventListener('popstate',f);return ()=>window.removeEventListener('popstate',f);};
        export const usePathname=()=>useSyncExternalStore(subscribe,()=>location.pathname);
        export const useSearchParams=()=>new URLSearchParams(useSyncExternalStore(subscribe,()=>location.search));
      ` }));
    } }],
  });
  let version = 0; let calls = 0; let unavailable = false;
  const server = createServer(async (request, response) => {
    if (request.url === "/bundle.js") { response.setHeader("Content-Type", "text/javascript"); response.end(bundled.outputFiles[0].text); return; }
    if (request.url === "/api/pos/portable/draft") {
      calls++; let raw = ""; for await (const part of request) raw += part;
      const operation = JSON.parse(raw);
      await new Promise((r) => setTimeout(r, 400));
      response.setHeader("Content-Type", "application/json");
      if (unavailable) { response.statusCode = 503; response.end('{}'); return; }
      assert.equal(operation.expectedVersion, version); version++;
      response.end(JSON.stringify({ kind: "ok", version })); return;
    }
    response.setHeader("Content-Type", "text/html");
    response.end(`<div id="root"></div><script>window.serverVersion=${version}</script><script src="/bundle.js"></script>`);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch({ executablePath: process.env.TEST_BROWSER_PATH, headless: true });
  try {
    const context = await browser.newContext(); const page = await context.newPage();
    const base = `http://127.0.0.1:${server.address().port}`;
    const errors = []; page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base + "/pos/portable"); await page.waitForFunction(() => document.querySelector('[data-ready]')?.textContent === 'true');
    await page.getByLabel("Amount").fill("10");
    await page.waitForFunction(() => document.querySelector('[data-status]')?.textContent.includes('waiting'));
    await page.getByRole("link", { name: "Book", exact: true }).click();
    assert.equal(await page.getByLabel("Booking note").isVisible(), true);
    await page.getByLabel("Booking note").fill("Keep booking work");
    await page.getByRole("link", { name: "POS", exact: true }).click();
    assert.equal(await page.getByLabel("Amount").inputValue(), "10");
    await page.waitForFunction(() => document.querySelector('[data-status]')?.textContent === 'Draft synced');
    await context.setOffline(true); const before = calls;
    await page.getByLabel("Amount").fill("20");
    await page.getByRole("link", { name: "Book", exact: true }).click();
    assert.equal(await page.getByLabel("Booking note").inputValue(), "Keep booking work");
    await page.getByRole("link", { name: "POS", exact: true }).click();
    assert.equal(await page.getByLabel("Amount").inputValue(), "20"); assert.equal(calls, before);
    await context.setOffline(false);
    await page.waitForFunction(() => document.querySelector('[data-status]')?.textContent === 'Draft synced');
    unavailable = true;
    await page.getByLabel("Amount").fill("30");
    await page.waitForTimeout(550); await page.reload();
    await page.waitForFunction(() => document.querySelector('input[aria-label="Amount"]')?.value === '30');
    unavailable = false;
    await page.waitForFunction(() => document.querySelector('[data-status]')?.textContent === 'Draft synced');
    const display = await context.newPage(); await display.goto(base + '/display');
    await page.evaluate(() => window.publishSnapshot({ token: 'test-token', version: 8, staff_lines: [], status: 'draft', total: 30 }));
    await display.waitForFunction(() => window.receivedSnapshot?.version === 8);
    await context.setOffline(true);
    await page.getByLabel("Amount").fill("45");
    await page.evaluate(() => window.commitBeforeCrash());
    // Simulate a crash after IndexedDB commit but before React clears the form.
    unavailable = true;
    await context.setOffline(false); await page.reload();
    await page.waitForFunction(() => document.querySelector('[data-ready]')?.textContent === 'true');
    assert.equal(await page.getByLabel("Amount").inputValue(), "");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await new Promise((r) => server.close(r)); }
});
