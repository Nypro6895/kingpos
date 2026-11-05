import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const artifact = resolve("artifacts/post-tag-book-comment");
await mkdir(artifact, { recursive: true });
const bundle = await build({
  stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React, { useRef, useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { ContentViewer } from './components/content-viewer';
    import { useCommentComposerVisibility } from './components/use-comment-composer-visibility';
    function App() {
      const ref = useRef(null), [value,setValue]=useState('');
      useCommentComposerVisibility(ref,value);
      return <><ContentViewer onClose={()=>{}}><article id="panel">
        <div id="photo">Post image</div><p>Nene · At King Nails Spa LLC</p>
        <p>Would you like this set?</p>
        <button id="comment" onClick={()=>ref.current.focus({preventScroll:true})}>Comment</button>
        <textarea ref={ref} value={value} onChange={e=>setValue(e.target.value)} placeholder="Comment as King Nails Spa LLC"/>
        <div id="comments">Existing comments</div>
      </article></ContentViewer><nav className="workspace-mobile-nav">Today · Book · Profile · Reports · More</nav></>;
    }
    createRoot(document.getElementById('root')).render(<App/>);
  ` },
  bundle: true, write: false, format: "iife", jsx: "automatic",
  plugins: [{ name: "fixture-aliases", setup(b) {
    b.onResolve({ filter: /^@\/components\/overlay-dismissal$/ }, () => ({ path: "dismiss", namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export function useCloseOnNavigation() {}" }));
    b.onResolve({ filter: /^@\/lib\/comment-composer-visibility$/ }, () => ({ path: resolve("lib/comment-composer-visibility.ts") }));
  } }],
});
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setContent(`<style>
    *{box-sizing:border-box}body{margin:0;font:16px sans-serif}
    .content-viewer{position:fixed;inset:0;display:grid;overflow:hidden;top:var(--content-viewer-top,0);bottom:auto;height:var(--content-viewer-height,100dvh)}
    #panel{overflow-y:auto;max-height:100%;min-height:0;background:#fff;padding:0 12px 20px}
    #photo{height:580px;background:#e6d0bc;display:grid;place-items:center}
    textarea{width:100%;height:72px;font-size:16px;color:#27272a;resize:none;display:block;margin-top:8px}
    #comments{height:500px}.workspace-mobile-nav{position:fixed;bottom:0;height:70px;background:#eedfcd;width:100%;padding:20px 8px}
  </style><div id="root"></div>`);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.locator("#comment").click();
  const visible = async () => {
    await page.waitForFunction(() => {
      const el=document.querySelector('textarea'),rect=el.getBoundingClientRect();
      const v=visualViewport,nav=document.querySelector('nav').getBoundingClientRect();
      return rect.top >= v.offsetTop && rect.bottom <= Math.min(v.offsetTop+v.height,nav.top);
    });
    assert.equal(await page.locator("textarea").evaluate(el=>document.activeElement===el),true);
  };
  await visible();
  await page.locator("textarea").fill("I would like this blue and gold set.");
  // Native WKWebView resizes when the keyboard opens; emulate that layout change.
  await page.setViewportSize({width:390,height:390});
  await visible();
  assert.equal(await page.locator("textarea").inputValue(),"I would like this blue and gold set.");
  await page.screenshot({path:resolve(artifact,"keyboard-resized.png")});
  await page.setViewportSize({width:640,height:300});
  await visible();
  // Safari may shrink/pan only the visual viewport while layout stays full height.
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(() => {
    Object.defineProperty(visualViewport,'height',{configurable:true,value:340});
    Object.defineProperty(visualViewport,'offsetTop',{configurable:true,value:42});
    visualViewport.dispatchEvent(new Event('resize'));
    visualViewport.dispatchEvent(new Event('scroll'));
  });
  await visible();
  await page.locator("textarea").fill("Reply remains visible after viewport panning.");
  await visible();
  await page.evaluate(() => { document.querySelector('textarea').style.height='144px'; });
  await visible();
  await page.screenshot({path:resolve(artifact,"keyboard-visual-viewport.png")});
  await page.evaluate(() => {
    document.querySelector('textarea').blur();
    delete visualViewport.height; delete visualViewport.offsetTop;
    visualViewport.dispatchEvent(new Event('resize'));
  });
  assert.equal(await page.locator("textarea").inputValue(),"Reply remains visible after viewport panning.");
  assert.deepEqual(errors,[]);
  await writeFile(resolve(artifact,"keyboard-browser-result.json"),JSON.stringify({passed:true,cases:["focus from Comment","native keyboard resize","landscape","Safari visual viewport pan","growing composer","draft retained"],pageErrors:errors},null,2));
  console.log("PASS: comment focus, keyboard resize, landscape, visual viewport pan and draft preservation");
} finally { await browser.close(); }
