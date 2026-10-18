import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright-core';

test('rapid page revisits coalesce slow refreshes and offline browsing preserves input and a working retry', { timeout: 60_000 }, async () => {
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React,{Activity,useState,useEffect}from'react';import{createRoot}from'react-dom/client';
    import{ExperiencePageBoundary}from'./components/experience-page-boundary';
    window.refreshes=0;window.clock=100000;Date.now=()=>window.clock;
    function App(){const[shown,setShown]=useState(true);const[revision,setRevision]=useState('one');
      useEffect(()=>{window.ready=true;window.show=setShown;window.finish=()=>setRevision('two')},[]);
      return <Activity mode={shown?'visible':'hidden'}><ExperiencePageBoundary renderRevision={revision}><input aria-label="Search" defaultValue="original"/></ExperiencePageBoundary></Activity>;
    }createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', alias: { '@': process.cwd() }, plugins: [{ name: 'revisit', setup(b) {
    b.onLoad({ filter:/components[\\/]experience-page-boundary\.tsx$/ },args=>({loader:'tsx',resolveDir:process.cwd(),contents:readFileSync(args.path,'utf8').replace('}, 12_000);','}, 500);')}));
    b.onResolve({ filter:/^(next\/navigation|.*experience-scope|.*loading-feedback)$/ },args=>({path:args.path,namespace:'fixture'}));
    b.onLoad({ filter:/.*/, namespace:'fixture' },({path})=>({loader:'tsx',resolveDir:process.cwd(),contents:path==='next/navigation'
      ? "const router={refresh:()=>window.refreshes++};const params=new URLSearchParams();export const useRouter=()=>router;export const usePathname=()=>'/explore';export const useSearchParams=()=>params;"
      : path.endsWith('experience-scope') ? 'export const useExperienceScope=()=>null;'
      : "import React from'react';export const PageLoadingSkeleton=()=>React.createElement('p',{},'Loading');"}));
  } }] });
  const server = createServer((request,response)=>{
    response.setHeader('Content-Type',request.url==='/bundle.js'?'application/javascript':'text/html');
    response.end(request.url==='/bundle.js'?result.outputFiles[0].text:'<div id="root"></div><script src="/bundle.js"></script>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser = process.env.TEST_BROWSER_ENGINE === 'webkit' ? await webkit.launch({headless:true})
    : await chromium.launch({channel:process.env.TEST_BROWSER_PATH?undefined:'chrome',executablePath:process.env.TEST_BROWSER_PATH,headless:true,args:['--no-proxy-server']});
  try {
    const page=await browser.newPage({viewport:{width:390,height:844}});
    page.setDefaultTimeout(5000);
    await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.ready);
    await page.getByLabel('Search').fill('retained search');
    const revisit=async()=>{
      await page.evaluate(()=>window.show(false));await page.getByLabel('Search').waitFor({state:'hidden'});
      await page.evaluate(()=>window.show(true));await page.getByLabel('Search').waitFor({state:'visible'});
    };
    await page.evaluate(()=>window.clock+=31000);await revisit();
    await page.waitForFunction(()=>window.refreshes===1);await revisit();
    assert.equal(await page.evaluate(()=>window.refreshes),1,'an unfinished refresh is shared across repeated reveals');
    await page.getByRole('button',{name:'Try again',exact:true}).waitFor();
    assert.equal(await page.getByLabel('Search').inputValue(),'retained search');
    await page.getByRole('button',{name:'Try again',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.refreshes),2);
    await page.evaluate(()=>window.finish());await page.getByRole('button',{name:'Try again',exact:true}).waitFor({state:'hidden'});
    await page.context().setOffline(true);await page.evaluate(()=>window.clock+=31000);await revisit();
    assert.equal(await page.evaluate(()=>window.refreshes),2,'offline reveal does not queue another complete server read');
    assert.equal(await page.getByLabel('Search').inputValue(),'retained search');
    await page.context().setOffline(false);await page.getByRole('button',{name:'Try again',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.refreshes),3);
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
});
