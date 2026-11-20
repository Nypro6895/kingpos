import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';

const fixture=`import React,{Activity,useRef,useState}from'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';import{useOverlayViewport}from'./components/use-overlay-viewport';
const vv=new EventTarget(),listeners=new Map();Object.assign(vv,{height:innerHeight,width:innerWidth,offsetTop:0,scale:1});
const add=vv.addEventListener.bind(vv),remove=vv.removeEventListener.bind(vv);vv.addEventListener=(name,fn,...args)=>{if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);add(name,fn,...args)};vv.removeEventListener=(name,fn,...args)=>{listeners.get(name)?.delete(fn);remove(name,fn,...args)};
Object.defineProperty(window,'visualViewport',{configurable:true,value:vv});window.vv=vv;window.listenerCount=()=>[...listeners.values()].reduce((n,v)=>n+v.size,0);
window.resizeOverlay=(height,offsetTop=0,scale=1)=>{Object.assign(vv,{height,offsetTop,scale});for(let n=0;n<20;n++){vv.dispatchEvent(new Event('resize'));vv.dispatchEvent(new Event('scroll'));}};
function Overlay({mode,active}){const ref=useRef(null);useOverlayViewport(ref,active,mode);return mode==='panel'?<dialog ref={ref} open className="panel" style={{maxHeight:'80dvh'}} data-owned="panel"><div className="spacer"/><input aria-label="Draft" defaultValue="Preserved draft"/><button>Save</button><div className="edge-wrap"><footer className="sticky-edge" data-overlay-sticky-edge>Panel actions</footer></div></dialog>:<div ref={ref} className="frame" style={{maxHeight:'calc(100dvh - 8px)'}} data-owned="frame"><header>Modal header</header><div className="scroller"><div className="spacer"/><input aria-label="Draft" defaultValue="Preserved draft"/><div className="edge-wrap"><footer className="sticky-edge" data-overlay-sticky-edge>Nested actions</footer></div></div><footer><button>Save</button></footer></div>}
function App(){const[mode,setMode]=useState('frame'),[active,setActive]=useState(true),[visible,setVisible]=useState(true),[mounted,setMounted]=useState(true);window.setMode=mode=>flushSync(()=>setMode(mode));window.setActive=active=>flushSync(()=>setActive(active));window.setVisible=visible=>flushSync(()=>setVisible(visible));window.setMounted=mounted=>flushSync(()=>setMounted(mounted));return <Activity mode={visible?'visible':'hidden'}>{mounted&&<Overlay key={mode} mode={mode} active={active}/>}</Activity>};createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);`;
const css=`body{margin:0;height:1800px;font:16px Arial}.frame{position:fixed;inset:0;height:100dvh;display:flex;flex-direction:column;background:white}.frame header,.frame footer{flex:none;height:44px;background:#eee}.scroller{min-height:0;flex:1;overflow:auto}.spacer{height:1000px}input{box-sizing:border-box;display:block;height:44px;width:100%}button{height:44px}.edge-wrap{display:contents}.sticky-edge{position:sticky;bottom:0;height:56px;background:#ddd}.panel{position:fixed;inset:0;width:300px;height:fit-content;overflow:auto;margin:auto;padding:12px;border:1px solid #ccc}`;
const bundle=await build({stdin:{contents:fixture,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,jsx:'automatic',alias:{'@':process.cwd()}});
const styleOf=locator=>locator.evaluate(el=>Array.from(el.style).filter(p=>p!=='display').map(p=>p+':'+el.style.getPropertyValue(p)+':'+el.style.getPropertyPriority(p)).join(';'));
const frames=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));

test('opt-in viewport sizing preserves ordinary layout, focus, drafts and lifecycle ownership', {timeout:60000}, async t=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{for(const mode of ['frame','panel'])await t.test(mode,async()=>{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
   await page.setContent(`<style>${css}</style><div id="root"></div>`);await page.addScriptTag({content:bundle.outputFiles[0].text});
   await page.evaluate(mode=>window.setMode(mode),mode);await frames(page);
   const overlay=page.locator(`[data-owned=${mode}]`),input=page.getByLabel('Draft');
   const original=await styleOf(overlay);assert.equal(await overlay.getAttribute('data-overlay-keyboard'),null);
   assert.equal(await page.evaluate(()=>window.listenerCount()),2,'StrictMode must retain exactly one resize/scroll subscription');
   await input.fill('Unsaved local draft');await page.evaluate(()=>scrollTo(0,120));
   const scroll=await page.evaluate(()=>scrollY);
   for(const [height,offset]of[[360,0],[360,60],[220,0]]){
    await input.focus();await page.evaluate(([h,o])=>window.resizeOverlay(h,o),[height,offset]);await frames(page);
    const r=await overlay.boundingBox();assert.ok(r.y>=offset-1&&r.y+r.height<=offset+height+1,JSON.stringify({r,height,offset}));
    const field=await input.boundingBox();assert.ok(field.y>=offset-1&&field.y+field.height<=offset+height+1,JSON.stringify({field,height,offset}));
    assert.equal(await input.evaluate(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit===el||el.contains(hit)}),true,JSON.stringify(await input.evaluate(el=>({field:el.getBoundingClientRect().toJSON(),hit:document.elementFromPoint(el.getBoundingClientRect().x+10,el.getBoundingClientRect().y+22)?.outerHTML,edges:[...document.querySelectorAll('[data-overlay-sticky-edge]')].map(e=>({box:e.getBoundingClientRect().toJSON(),parent:e.parentElement.tagName}))}))));assert.equal(await input.inputValue(),'Unsaved local draft');assert.equal(await page.evaluate(()=>scrollY),scroll,'focus reveal must not scroll underlying document');
    assert.equal(await overlay.getAttribute('data-overlay-keyboard'),'true');
   }
   await page.evaluate(()=>window.resizeOverlay(844));await frames(page);assert.equal(await styleOf(overlay),original,'keyboard dismissal restores exact original inline declarations');
   assert.equal(await overlay.getAttribute('data-overlay-keyboard'),null);
   await page.evaluate(()=>window.resizeOverlay(360,0,2));await frames(page);assert.equal(await styleOf(overlay),original,'pinch zoom must remain browser-owned');
   await page.evaluate(()=>window.resizeOverlay(360,0,1));await frames(page);
   await page.evaluate(()=>window.setActive(false));assert.equal(await styleOf(overlay),original);assert.equal(await page.evaluate(()=>window.listenerCount()),0);
   await page.evaluate(()=>window.setActive(true));await frames(page);assert.equal(await page.evaluate(()=>window.listenerCount()),2);
   for(let cycle=0;cycle<8;cycle++){
    await page.evaluate(()=>{window.resizeOverlay(350);window.setVisible(false)});
    assert.equal(await page.evaluate(()=>window.listenerCount()),0,'Activity cleanup removes only this overlay subscriptions');
    assert.equal(await styleOf(overlay),original);
    await page.evaluate(()=>window.setVisible(true));await frames(page);
    assert.equal(await page.evaluate(()=>window.listenerCount()),2);assert.equal(await input.inputValue(),'Unsaved local draft');
   }
   await page.evaluate(()=>{window.resizeOverlay(300);window.setMounted(false)});await frames(page);assert.equal(await page.evaluate(()=>window.listenerCount()),0,'pending frame cannot recreate listeners after unmount');
   assert.deepEqual(errors,[]);
  }finally{await page.close();}
 });
 await t.test('no visualViewport or already-resized layout receives no second adjustment',async()=>{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  try{
   await page.setContent(`<style>${css}</style><div id="root"></div>`);await page.addScriptTag({content:bundle.outputFiles[0].text});await frames(page);
   const overlay=page.locator('[data-owned=frame]'),original=await styleOf(overlay);
   await page.setViewportSize({width:390,height:360});await page.evaluate(()=>window.resizeOverlay(360));await frames(page);
   assert.equal(await styleOf(overlay),original);assert.equal(await overlay.getAttribute('data-overlay-keyboard'),null);
   await page.evaluate(()=>{window.setMounted(false);Object.defineProperty(window,'visualViewport',{value:undefined});window.setMounted(true)});await frames(page);
   const fresh=await styleOf(overlay);await page.evaluate(()=>dispatchEvent(new Event('resize')));await frames(page);
   assert.equal(await styleOf(overlay),fresh);assert.equal(await overlay.getAttribute('data-overlay-keyboard'),null);
  }finally{await page.close();}
 });
 }finally{await browser.close();}
});
