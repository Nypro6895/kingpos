import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright-core";

test("mobile resource hooks retain warm views, dedupe, refresh silently and hide a revoked or switched scope", { timeout: 60_000 }, async () => {
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React,{useState}from'react';import{createRoot}from'react-dom/client';
    import{useExperienceResource}from'./lib/use-experience-resource';
    import{experienceResourceCache,ExperienceResourceAccessError}from'./lib/experience-resource-cache';
    const initialAt=Date.now()-60000, calls=[],pending=[];
    window.calls=calls;window.pending=pending;window.cache=experienceResourceCache;
    window.finish=(index,value)=>pending[index].resolve({data:{value},etag:'"'+value+'"'});
    window.rejectAccess=index=>pending[index].reject(new ExperienceResourceAccessError(403));
    function View({scope}){
      const resource=useExperienceResource({scope,key:'today?tab=live&date=2026-10-11',tags:['tickets'],
        initialData:{value:scope+' seed'},initialUpdatedAt:initialAt,freshForMs:10000,retainForMs:1800000,
        fetcher:options=>new Promise((resolve,reject)=>{calls.push({scope,etag:options.etag});pending.push({resolve,reject,signal:options.signal})})});
      return <output data-scope={scope} data-available={resource.available} data-refreshing={resource.refreshing}>{resource.data?.value??'hidden'}</output>;
    }
    function App(){const[scope,setScope]=useState('account-a'),[shown,setShown]=useState(true);
      window.setScope=setScope;window.setShown=setShown;
      return shown?<><View scope={scope}/><View scope={scope}/></>:<p>Other menu</p>;
    }
    createRoot(document.getElementById('root')).render(<App/>);
  ` }, outfile: "bundle.js", bundle: true, write: false, jsx: "automatic", format: "iife" });
  const js = result.outputFiles[0].text;
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", request.url === "/bundle.js" ? "application/javascript" : "text/html");
    response.end(request.url === "/bundle.js" ? js : '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ args: ['--no-proxy-server'], executablePath: process.env.TEST_BROWSER_PATH, channel: process.env.TEST_BROWSER_PATH ? undefined : "chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.calls?.length === 1);
    assert.deepEqual(await page.locator("output").allTextContents(), ["account-a seed", "account-a seed"]);
    await page.evaluate(() => window.finish(0, "account-a current"));
    await page.waitForFunction(() => [...document.querySelectorAll("output")].every(output => output.textContent === "account-a current"));
    await page.evaluate(() => window.setShown(false));
    await page.getByText("Other menu").waitFor();
    await page.evaluate(() => window.setShown(true));
    await page.waitForFunction(() => [...document.querySelectorAll("output")].length === 2 && [...document.querySelectorAll("output")].every(output => output.textContent === "account-a current"));
    assert.equal(await page.evaluate(() => window.calls.length), 1);
    await page.evaluate(() => window.cache.invalidate({ scope: "account-a", tags: ["tickets"] }));
    await page.waitForFunction(() => window.calls.length === 2);
    assert.deepEqual(await page.locator("output").allTextContents(), ["account-a current", "account-a current"]);
    assert.equal(await page.evaluate(() => window.calls[1].etag), '"account-a current"');
    await page.evaluate(() => { window.cache.suspend(); window.setScope("account-b"); });
    await page.waitForFunction(() => [...document.querySelectorAll("output")].every(output => output.dataset.scope === "account-b" && output.textContent === "hidden"));
    assert.equal(await page.evaluate(() => window.pending[1].signal.aborted), true);
    await page.evaluate(() => window.cache.resume());
    await page.waitForFunction(() => window.calls.length === 3);
    await page.evaluate(() => { window.finish(1, "account-a stale"); window.finish(2, "account-b current"); });
    await page.waitForFunction(() => [...document.querySelectorAll("output")].every(output => output.textContent === "account-b current"));
    assert.equal(await page.evaluate(() => window.cache.get({ scope: "account-a", key: "today?date=2026-10-11&tab=live" })), undefined);
    await page.evaluate(() => window.cache.invalidate({ scope: "account-b", tags: ["tickets"] }));
    await page.waitForFunction(() => window.calls.length === 4);
    await page.evaluate(() => window.rejectAccess(3));
    await page.waitForFunction(() => [...document.querySelectorAll("output")].every(output => output.dataset.available === "false" && output.textContent === "hidden"));
    assert.equal(await page.evaluate(() => window.calls.length), 4);
    assert.equal(await page.evaluate(() => Object.keys(sessionStorage).length + Object.keys(localStorage).length), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
