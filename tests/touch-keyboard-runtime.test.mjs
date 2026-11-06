import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';

test('touch activation, More navigation, WK keyboard resize and modal navigation exclusion', {timeout:60000}, async()=>{
 const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
 assert.ok(executablePath,'A browser is required for this regression test');
 const built=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
 import React,{useState,useRef} from 'react';import{createRoot}from'react-dom/client';
 import styles from './app/account/account-profile-editor.module.css';
 import{useDialogViewport}from'./components/use-dialog-viewport';
 import{installMobileViewport}from'./lib/mobile-viewport';import{installPopoverDismissal}from'./lib/dismissible-popovers';
 import{RoleMoreContent}from'./components/role-more-content';
 import{AppLocalNavigationProvider}from'./app/local-app/navigation';
 installMobileViewport();installPopoverDismissal(document);window.hit={menu:0,under:0};
 function Sheet(){const ref=useRef(null);useDialogViewport(ref,true,'sheet');return <dialog ref={ref}><input aria-label="Amount" inputMode="decimal"/><button onClick={()=>ref.current.close()}>Close expense</button></dialog>}
 function App(){const[path,setPath]=useState('/staff/today');return <AppLocalNavigationProvider value={{path,navigate:p=>{window.destination=p;setPath(p)},refresh(){}}}>
 <header>King Nails</header><input aria-label="Comment"/>
 <details id="touch-menu" data-dismissible-popover><summary>Settings</summary><div className="menu"><button onClick={()=>{window.hit.menu++;document.querySelector('#touch-menu').open=false}}>Availability</button></div></details>
 <button id="under" onClick={()=>window.hit.under++}>9 AM appointment</button>
 <button id="open-dialog" onClick={()=>document.querySelector('dialog').showModal()}>Add expense</button>
 <Sheet/><footer className={styles.actions} id="profile-save"><button>Save profile</button></footer>
 <nav className="workspace-mobile-nav"><details id="more" data-dismissible-popover><summary>More</summary><div className="panel"><RoleMoreContent roleKind="owner" activeItemIds={[]} onNavigate={()=>queueMicrotask(()=>document.querySelector('#more').open=false)}/></div></details></nav>
 </AppLocalNavigationProvider>};createRoot(document.getElementById('root')).render(<App/>);
 `},bundle:true,write:false,outdir:'fixture',jsx:'automatic',plugins:[{name:'native-links',setup(b){
 b.onResolve({filter:/^next\/link$/},()=>({path:'link',namespace:'fixture'}));
 b.onResolve({filter:/^next\/navigation$/},()=>({path:'navigation',namespace:'fixture'}));
 b.onResolve({filter:/workspace-language$/},()=>({path:'language',namespace:'fixture'}));
 b.onResolve({filter:/workspace-navigation-icon$/},()=>({path:'icons',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'tsx',resolveDir:process.cwd(),contents:a.path==='language'?`export const WorkspaceText=({text})=>text;`:a.path==='icons'?`export const WorkspaceNavigationIcon=()=>null;`:a.path==='link'?`export{AppLocalLink as default,useLinkStatus}from'./app/local-app/navigation';`:`export * from './app/local-app/navigation';`}));
 }}]});
 const js=built.outputFiles.find(f=>f.path.endsWith('.js')).text;
 const css=readFileSync('components/iphone-glass-nav.css','utf8')+built.outputFiles.filter(f=>f.path.endsWith('.css')).map(f=>f.text).join('\n');
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/fixture.js'?'text/javascript':'text/html');res.end(req.url==='/fixture.js'?js:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{margin:0}header{position:sticky;top:0;background:white;height:50px}.workspace-mobile-nav{position:fixed;bottom:0;width:100%;height:60px;background:white}.panel{position:fixed;bottom:70px;left:12px;right:12px;max-height:65vh;overflow:auto;background:white}.menu{position:absolute;z-index:60;background:white}button,summary{min-height:44px}dialog{position:fixed;bottom:0;max-height:85dvh}</style><div id="root"></div><script src="/fixture.js"></script>`);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({executablePath,headless:true});
 try{
 const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.locator('#touch-menu summary').tap();
 // WebKit can transfer touch focus to the page before delivering activation.
 await page.evaluate(()=>document.body.dispatchEvent(new FocusEvent('focusin',{bubbles:true})));
 assert.equal(await page.locator('#touch-menu').evaluate(e=>e.open),true);
 await page.getByRole('button',{name:'Availability',exact:true}).tap();
 assert.deepEqual(await page.evaluate(()=>window.hit),{menu:1,under:0});
 await page.locator('#more summary').tap();await page.getByRole('link',{name:'All',exact:true}).tap();
 assert.equal(await page.evaluate(()=>window.destination),'/more');
 await page.getByRole('textbox',{name:'Comment',exact:true}).focus();await page.setViewportSize({width:390,height:500});
 await page.waitForFunction(()=>document.documentElement.dataset.keyboardOpen==='true');
 assert.equal(await page.locator('.workspace-mobile-nav').isVisible(),false);
 await page.getByRole('textbox',{name:'Comment',exact:true}).blur();
 assert.equal(await page.locator('.workspace-mobile-nav').isVisible(),false,'Blur must not move navigation into the gesture while the keyboard is still closing');
 await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>document.documentElement.dataset.keyboardOpen==='false');
 assert.equal(await page.locator('.workspace-mobile-nav').isVisible(),true);
 assert.equal(await page.locator('header').evaluate(e=>e.getBoundingClientRect().top),0);
 // Mirroring/hardware keyboards may leave only the short input accessory bar.
 await page.getByRole('textbox',{name:'Comment',exact:true}).focus();
 await page.setViewportSize({width:390,height:800});
 await page.waitForFunction(()=>document.documentElement.dataset.keyboardOpen==='true');
 assert.equal(await page.locator('.workspace-mobile-nav').isVisible(),false);
 await page.getByRole('textbox',{name:'Comment',exact:true}).blur();
 assert.equal(await page.locator('.workspace-mobile-nav').isVisible(),false);
 await page.setViewportSize({width:390,height:844});
 await page.waitForFunction(()=>document.documentElement.dataset.keyboardOpen==='false');
 assert.equal(await page.locator('.workspace-mobile-nav').isVisible(),true);
 // Current native uses WebKit's visual viewport without shrinking innerHeight.
 await page.getByRole('textbox',{name:'Comment',exact:true}).focus();
 await page.evaluate(()=>{
   Object.defineProperty(visualViewport,'height',{configurable:true,value:500});
   visualViewport.dispatchEvent(new Event('resize'));
 });
 await page.waitForFunction(()=>document.documentElement.dataset.keyboardOpen==='true');
 assert.equal(await page.locator('#profile-save').evaluate(e=>getComputedStyle(e).position),'fixed');
 assert.ok(await page.locator('#profile-save').evaluate(e=>e.getBoundingClientRect().bottom)<=501,'Save must be above the Safari/WK keyboard');
 await page.locator('#open-dialog').tap();await page.waitForFunction(()=>document.documentElement.dataset.modalOpen==='true');
 await page.evaluate(()=>visualViewport.dispatchEvent(new Event('resize')));
 await page.waitForFunction(()=>document.querySelector('dialog').getBoundingClientRect().bottom<=501);
 assert.equal(await page.locator('.workspace-mobile-nav').isVisible(),false);
 await page.getByRole('button',{name:'Close expense'}).tap();await page.waitForFunction(()=>document.documentElement.dataset.modalOpen==='false');
 await page.evaluate(()=>{delete visualViewport.height;visualViewport.dispatchEvent(new Event('resize'))});
 await page.waitForFunction(()=>document.documentElement.dataset.keyboardOpen==='false');
 assert.equal(await page.locator('.workspace-mobile-nav').isVisible(),true);assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
