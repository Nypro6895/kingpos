import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright-core';

const executablePath = process.env.TEST_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
test('post viewers keep all mobile navigation targets and final actions reachable, including the shipped iOS viewport rules', {
  skip: !existsSync(executablePath), timeout: 120000,
}, async () => {
  const fixture = `
import React,{Activity,useState} from 'react';import{createRoot}from'react-dom/client';
import{ContentViewer}from'./components/content-viewer';
function App(){const[open,setOpen]=useState(false),[visible,setVisible]=useState(true),[nav,setNav]=useState(true),[selected,setSelected]=useState('Explore');window.setVisible=setVisible;window.setNav=setNav;
return <><main style={{height:1800}}><button id='open' onClick={()=>setOpen(true)}>Open post</button><output>{selected}</output></main>
{nav?<nav aria-label='Workspace' className='workspace-mobile-nav fixed inset-x-0 bottom-0 z-50 grid grid-cols-5 border-t bg-white px-1 pb-[calc(0.35rem+env(safe-area-inset-bottom))] pt-1 lg:hidden'>{['Today','Book','Explore','Notifications','More'].map(label=><button key={label} className='flex min-h-[58px] flex-col items-center justify-center gap-1' onClick={()=>setSelected(label)}><svg aria-hidden width='28' height='28' viewBox='0 0 24 24'><circle cx='12' cy='12' r='8' fill='none' stroke='currentColor'/></svg>{label}</button>)}</nav>:null}
<Activity mode={visible?'visible':'hidden'}><ContentViewer open={open} aria-label='Salon post' onClose={()=>setOpen(false)}><div className='mt-auto grid max-h-[100dvh] overflow-auto overscroll-contain rounded-t-xl bg-white sm:m-auto sm:max-h-[88vh] sm:w-full sm:max-w-5xl'><div style={{height:560,background:'#fbe5dc'}}>Photo</div><div className='grid gap-5 p-5'><h2>King Nails Spa LLC</h2><button onClick={()=>setOpen(false)}>Close post</button><p>Full summer multi color nails design</p><h3>Comments</h3><p>No comments yet.</p><textarea aria-label='Write a public comment' rows={4}/><label><input type='checkbox'/>Reply as salon</label><button id='submit' onClick={()=>window.posted=true}>Post comment</button><button onClick={()=>document.querySelector('#nested').showModal()}>Open report</button></div></div></ContentViewer></Activity>
<dialog id='nested'><p>Report</p><button onClick={()=>document.querySelector('#nested').close()}>Close report</button></dialog></>};createRoot(document.getElementById('root')).render(<App/>);`;
  const bundle = await build({ stdin: { contents: fixture, loader: 'tsx', resolveDir: process.cwd() }, bundle: true, write: false, jsx: 'automatic', format: 'iife', alias: { '@': process.cwd() }, plugins: [{ name: 'navigation', setup(b) {
    b.onResolve({ filter: /^next\/navigation$/ }, args => ({ path: args.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: `export const usePathname=()=>'/explore';`, loader: 'js' }));
  } }] });
  const source = readFileSync('app/globals.css','utf8').replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source "../components/content-viewer.tsx";\n@source "../tests/content-viewer-navigation.test.mjs";');
  const { css } = await postcss([tailwind()]).process(source, { from: path.resolve('app/globals.css') });
  const browser = await chromium.launch({ executablePath, headless: true });
  const evidence=[];
  try {
    for (const native of [false,true]) {
      const page = await browser.newPage({ viewport: {width:390,height:844}, isMobile:true, hasTouch:true });
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      if(native) await page.addInitScript({content:`window.webkit={messageHandlers:{reylumi:{postMessage(){}}}};${readFileSync('ios/Reylumi/AppViewport.js','utf8')}`});
      await page.route('https://viewer.test/**', route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'><style>${css}</style></head><body><div id='root'></div><script>${bundle.outputFiles[0].text}</script></body></html>`}));
      await page.goto('https://viewer.test/');
      assert.equal(await page.locator('[role="dialog"]').count(),0,'Closed comment viewers do not block background page behavior');
      for(const [width,height] of [[320,568],[390,844],[430,932],[667,375],[844,390],[932,430],[390,360],[1280,800]]) {
        await page.setViewportSize({width,height});
        await page.locator('#open').click();
        const viewer=page.getByRole('dialog',{name:'Salon post'});
        await viewer.waitFor();
        const nav=page.getByRole('navigation',{name:'Workspace'});
        const mobile=width<1024;
        await page.waitForFunction(mobile=>document.querySelector('.content-viewer').getAttribute('aria-modal')===(mobile?'false':'true'),mobile);
        const navBox=mobile?await nav.boundingBox():null, box=await viewer.boundingBox();
        assert.ok(box.x===0&&box.width===width, 'Viewer fills width even under native dialog rules');
        assert.ok(box.y>=0&&box.y+box.height<=(navBox?.y??height)+1, `${native}:${width}x${height} viewer clears navigation`);
        if(mobile){
          const reachable=await nav.locator('button').evaluateAll(buttons=>buttons.map(button=>{const r=button.getBoundingClientRect();return button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}));
          assert.deepEqual(reachable,[true,true,true,true,true]);
        }
        await viewer.getByLabel('Write a public comment').fill('Keep this draft');
        await viewer.locator('#submit').click();
        assert.equal(await page.evaluate(()=>window.posted),true);
        const submit=await viewer.locator('#submit').boundingBox();
        assert.ok(submit.y>=0&&submit.y+submit.height<=(navBox?.y??height)+1,'Final comment action stays above the bar');
        if(width===390&&height===844){mkdirSync('artifacts/mobile-viewer-nav-20261013/qa',{recursive:true});await page.screenshot({path:`artifacts/mobile-viewer-nav-20261013/qa/${native?'ios':'web'}-post.png`});}
        if(mobile){await nav.getByRole('button',{name:'More',exact:true}).click();await viewer.waitFor({state:'hidden'});assert.equal(await page.locator('output').innerText(),'More');}
        else {await page.keyboard.press('Escape');await viewer.waitFor({state:'hidden'});}
        assert.equal(await page.evaluate(()=>document.body.style.overflow),'');
        evidence.push({native,width,height,navTop:navBox?.y,viewerBottom:box.y+box.height,finalActionReachable:true});
      }
      // Next's Activity hide/show must release scroll locks and preserve drafts.
      await page.setViewportSize({width:390,height:844});await page.locator('#open').click();
      await page.evaluate(()=>window.setVisible(false));await page.getByRole('dialog',{name:'Salon post'}).waitFor({state:'hidden'});
      assert.equal(await page.evaluate(()=>document.body.style.overflow),'');
      await page.evaluate(()=>window.setVisible(true));await page.getByRole('dialog',{name:'Salon post'}).waitFor();
      assert.equal(await page.getByLabel('Write a public comment').inputValue(),'Keep this draft');
      await page.getByRole('button',{name:'Open report',exact:true}).click();await page.keyboard.press('Escape');
      assert.ok(await page.getByRole('dialog',{name:'Salon post'}).isVisible(),'Nested report closes without closing post');
      await page.evaluate(()=>document.dispatchEvent(new Event('reylumi:overlay-navigation')));
      await page.getByRole('dialog',{name:'Salon post'}).waitFor({state:'hidden'});
      // Guest / standalone pages have no bottom navigation and use the full viewport.
      await page.evaluate(()=>window.setNav(false));await page.locator('#open').click();
      await page.waitForFunction(()=>document.querySelector('.content-viewer').getAttribute('aria-modal')==='true');
      assert.equal((await page.getByRole('dialog',{name:'Salon post'}).boundingBox()).height,844);
      await page.keyboard.press('Escape');
      await page.evaluate(()=>{const dialog=document.createElement('div');dialog.id='fullscreen';dialog.className='fixed inset-0 z-[120] bg-white';dialog.setAttribute('role','dialog');document.body.append(dialog)});
      const full=await page.locator('#fullscreen').boundingBox();
      assert.equal(full.width,390,'Full-screen task backdrops have no clipped side strip');
      assert.equal(full.height,844,'Full-screen task backdrops cover the bar completely');
      assert.deepEqual(errors,[]);await page.close();
    }
    writeFileSync('artifacts/mobile-viewer-nav-20261013/qa/measurements.json',JSON.stringify(evidence,null,2));
  }finally{await browser.close();}
});
