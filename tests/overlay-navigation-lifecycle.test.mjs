import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
const root=process.cwd();
const canonical=process.cwd();
const fixture=`
import React,{Activity,StrictMode,useState,useRef} from 'react';
import{createRoot}from'react-dom/client';
import{usePathname}from'next/navigation';
import{ContentViewer}from'./components/content-viewer';
import{OverlayDismissal,useTransientOverlay,useCloseOnNavigation,useNativeDialogNavigation}from'./components/overlay-dismissal';
const roles=['guest','customer','owner','manager','staff','admin','portable','kiosk'];
window.go=(url)=>{history.pushState(null,'',url);window.dispatchEvent(new Event('route'));};
function Page({role}){
 const[open,setOpen]=useState(false),[simple,setSimple]=useState(false),[draft,setDraft]=useState('');
 useTransientOverlay(()=>setSimple(false),simple);
 const native=useRef(null);useNativeDialogNavigation(native);const[late,setLate]=useState(false);const lateRef=useRef(null);useNativeDialogNavigation(lateRef);useTransientOverlay(()=>setLate(false),late);React.useEffect(()=>{if(late)lateRef.current?.showModal();},[late]);
 return <section data-page={role}><h1>{role}</h1><button onClick={()=>setOpen(true)}>Open post</button><button onClick={()=>setSimple(true)}>Open editor</button><button onClick={()=>native.current.showModal()}>Open native</button>
 <button onClick={()=>setLate(true)}>Open conditional native</button>{late?<dialog ref={lateRef} aria-label='Conditional native' onClose={()=>setLate(false)}>Conditional</dialog>:null}<input aria-label='Preserved draft' value={draft} onChange={e=>setDraft(e.target.value)}/>
 {simple?<div role='dialog' aria-label='Editor'><button onClick={()=>setSimple(false)}>Close editor</button></div>:null}
 <dialog ref={native} aria-label='Native'><button onClick={()=>native.current.close()}>Close native</button></dialog>
 <ContentViewer open={open} aria-label='Salon post' onClose={()=>setOpen(false)}><article><a id='salon-link' href='/profile' onClick={e=>{e.preventDefault();window.go('/profile');}}>Salon identity</a><button onClick={()=>native.current.showModal()}>Nested report</button><button onClick={()=>setOpen(false)}>Close post</button><a id='cancelled' href='/blocked' onClick={e=>e.preventDefault()}>Guarded navigation</a><a id='new-tab' target='_blank' href='/elsewhere'>New tab</a></article></ContentViewer>
 </section>;
}
function NativeDestination(){const[open,setOpen]=useState(true),ref=useRef(null);useNativeDialogNavigation(ref);React.useEffect(()=>{if(open)ref.current?.showModal();},[open]);return open?<dialog ref={ref} aria-label='Native destination' onClose={()=>setOpen(false)}>Native destination</dialog>:null;}
function Destination(){const[open,setOpen]=useState(true);useTransientOverlay(()=>setOpen(false),open);return <>{open?<div role='dialog' aria-label='Destination'>New route dialog</div>:null}</>;}
function App(){const path=usePathname();return <><OverlayDismissal/><details data-dismissible-popover><summary>Menu</summary><a href='#item'>Item</a></details>{roles.map(role=><Activity key={role} mode={path==='/'+role?'visible':'hidden'}><Page role={role}/></Activity>)}{path==='/destination'?<Destination/>:null}{path==='/native-destination'?<NativeDestination/>:null}<nav className='workspace-mobile-nav'>{roles.map(role=><button key={role} onClick={()=>window.go('/'+role)}>{role}</button>)}</nav></>};
createRoot(document.getElementById('root')).render(<StrictMode><App/></StrictMode>);
`;
const result=await build({stdin:{contents:fixture,loader:'tsx',resolveDir:root},bundle:true,write:false,jsx:'automatic',format:'iife',alias:{'@':canonical,'@/components/overlay-dismissal':root+'/components/overlay-dismissal.tsx'},plugins:[{name:'navigation',setup(b){b.onResolve({filter:/^next\/navigation$/},a=>({path:a.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:`import{useSyncExternalStore}from'react';const sub=cb=>{for(const event of ['route','popstate','hashchange'])window.addEventListener(event,cb);return()=>{for(const event of ['route','popstate','hashchange'])window.removeEventListener(event,cb);}};export const usePathname=()=>useSyncExternalStore(sub,()=>location.pathname);export const useSearchParams=()=>new URLSearchParams(useSyncExternalStore(sub,()=>location.search));`,loader:'js',resolveDir:root}));}}]});
const executablePath=process.env.TEST_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe';assert.ok(existsSync(executablePath));
const browser=await chromium.launch({executablePath,headless:true});const evidence=[],errors=[];
try{
const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});page.on('pageerror',e=>errors.push(e.message));
await page.route('https://overlay.test/**',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><meta name='viewport' content='width=device-width,initial-scale=1'><style>body{margin:0}.content-viewer{position:fixed;inset:0;z-index:100;background:#eee;top:var(--content-viewer-top,0);height:var(--content-viewer-height,100vh)}[hidden]{display:none!important}.workspace-mobile-nav{position:fixed;bottom:0;left:0;right:0;z-index:50;height:65px;display:flex;flex-wrap:wrap}article{padding:20px}dialog{max-width:85vw}</style><div id='root'></div><script>${result.outputFiles[0].text}</script>`}));
await page.goto('https://overlay.test/guest');
const post=page.getByRole('dialog',{name:'Salon post',exact:true});
for(const role of ['guest','customer','owner','manager','staff','admin','portable','kiosk']){
 await page.evaluate(role=>window.go('/'+role),role);const scope=page.locator('[data-page="'+role+'"]');
 await scope.getByLabel('Preserved draft').fill('draft-'+role);
 await scope.getByRole('button',{name:'Open post',exact:true}).click();await post.waitFor();
 await post.locator('#cancelled').click();assert.equal(new URL(page.url()).pathname,'/'+role);assert.ok(await post.isVisible(),'Cancelled navigation preserves popup');
 await post.getByRole('button',{name:'Nested report'}).click();await page.getByRole('dialog',{name:'Native',exact:true}).waitFor();await page.getByRole('button',{name:'Close native',exact:true}).click();assert.ok(await post.isVisible(),'Nested dialog retains parent');
 await post.locator('#salon-link').click();await post.waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>document.body.style.overflow),'','Scroll lock released');
 await page.evaluate(role=>window.go('/'+role),role);await scope.waitFor({state:'visible'});assert.equal(await post.isVisible(),false,'Cached page does not reopen old popup');assert.equal(await scope.getByLabel('Preserved draft').inputValue(),'draft-'+role,'Unrelated draft preserved');
 await scope.getByRole('button',{name:'Open editor'}).click();await page.getByRole('dialog',{name:'Editor',exact:true}).waitFor();
 await page.evaluate(()=>window.go('/profile'));await page.getByRole('dialog',{name:'Editor',exact:true}).waitFor({state:'hidden'});
 await page.evaluate(role=>window.go('/'+role),role);assert.equal(await page.getByRole('dialog',{name:'Editor',exact:true}).isVisible(),false);
 await scope.getByRole('button',{name:'Open native',exact:true}).click();await page.getByRole('dialog',{name:'Native',exact:true}).waitFor();
 await page.evaluate(()=>window.go('/profile'));await page.waitForFunction(()=>document.querySelectorAll('dialog:modal').length===0);
 await page.evaluate(role=>window.go('/'+role),role);await scope.getByRole('button',{name:'Open conditional native'}).click();await page.getByRole('dialog',{name:'Conditional native',exact:true}).waitFor();await page.evaluate(()=>window.go('/profile'));await page.waitForFunction(()=>document.querySelectorAll('dialog:modal').length===0);await page.evaluate(role=>window.go('/'+role),role);assert.equal(await page.getByRole('dialog',{name:'Conditional native',exact:true}).isVisible(),false,'A conditionally mounted native dialog stays dismissed after cached return');
 evidence.push({role,postNavigation:true,cachedReturn:true,nativeTopLayerReleased:true,draftPreserved:true,cancelledLinkPreserved:true,nestedDialogPreserved:true});
}
await page.evaluate(()=>window.go('/customer'));const scope=page.locator('[data-page="customer"]');
await scope.getByRole('button',{name:'Open post',exact:true}).click();await post.waitFor();await page.evaluate(()=>window.go('/customer?q=salon'));await post.waitFor({state:'hidden'});
await scope.getByRole('button',{name:'Open editor'}).click();await page.evaluate(()=>window.go('/customer?q=salon&editor=1'));assert.ok(await page.getByRole('dialog',{name:'Editor',exact:true}).isVisible(),'Query-managed editor is not dismissed by its own URL state');await page.getByRole('button',{name:'Close editor'}).click();
await scope.getByRole('button',{name:'Open post',exact:true}).click();await post.waitFor();await page.evaluate(()=>location.hash='customer-experiences');await post.waitFor({state:'hidden'});
await scope.getByRole('button',{name:'Open post',exact:true}).click();await post.waitFor();await page.evaluate(()=>history.back());await post.waitFor({state:'hidden'});
await scope.getByRole('button',{name:'Open post',exact:true}).click();await post.waitFor();await page.evaluate(()=>history.forward());await post.waitFor({state:'hidden'});
await page.locator('summary').click();assert.equal(await page.locator('details').getAttribute('open'),'');await page.evaluate(()=>window.go('/customer?q=other'));await page.waitForFunction(()=>!document.querySelector('details').open);
await page.evaluate(()=>window.go('/destination'));await page.getByRole('dialog',{name:'Destination',exact:true}).waitFor();await page.waitForTimeout(100);assert.ok(await page.getByRole('dialog',{name:'Destination',exact:true}).isVisible(),'New destination dialog survives root route notification and StrictMode');
await page.evaluate(()=>window.go('/native-destination'));await page.getByRole('dialog',{name:'Native destination',exact:true}).waitFor();await page.waitForTimeout(100);assert.ok(await page.getByRole('dialog',{name:'Native destination',exact:true}).isVisible(),'New native destination dialog survives StrictMode cleanup');await page.evaluate(()=>window.go('/destination'));await page.waitForFunction(()=>document.querySelectorAll('dialog:modal').length===0);
assert.deepEqual(errors,[]);mkdirSync(root+'/artifacts/overlay-navigation/qa',{recursive:true});await page.screenshot({path:root+'/artifacts/overlay-navigation/qa/destination-mobile.png'});
writeFileSync(root+'/artifacts/overlay-navigation/qa/browser-results.json',JSON.stringify({roles:evidence,queryNavigation:true,hashNavigation:true,backForward:true,popoverQueryDismissal:true,destinationDialogPreserved:true,strictMode:true,errors},null,2));console.log('PASS: 8 role-labelled lifecycle fixtures; path/query/hash/Back/Forward; cached return; scroll/native top-layer cleanup; preserved drafts/guards/nested/new destination dialogs.');
}finally{await browser.close();}
