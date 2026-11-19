import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import {chromium} from 'playwright-core';

const out='artifacts/ipad-explore-two-fixes-20261118';
const sid='11111111-1111-4111-8111-111111111111';
const fixture=`
import React,{useState,Activity} from 'react';import{createRoot}from'react-dom/client';
import{ContentViewer}from'@/components/content-viewer';
import{useSalonFollowState}from'@/components/use-salon-follow-state';
import{ExploreSocialProvider,useSalonSocial}from'@/components/explore-social';
import{publishSalonFollowChange}from'@/lib/salon-follow-state';
window.requests=[];window.fetch=(url,init)=>new Promise(resolve=>window.requests.push({url,init,reply:(following)=>resolve({ok:true,json:async()=>({states:{'${sid}':{following,loved:true,saved:true,hidden:false}}})})}));
window.replyAll=(following)=>{for(const r of window.requests.splice(0))r.reply(following)};
function Profile({actor}){const s=useSalonFollowState('${sid}',actor,false);return <><output id='profile'>{String(s.following)}</output><output id='loading'>{String(s.loading)}</output><button id='commit' onClick={()=>s.commit(false)}>Commit unfollow</button></>}
function Card(){const s=useSalonSocial('${sid}');return <output id='card'>{JSON.stringify(s.state)}</output>}
function App(){const[open,setOpen]=useState(false),[actor,setActor]=useState('actor-a'),[visible,setVisible]=useState(true);window.actor=setActor;window.visible=setVisible;window.publish=publishSalonFollowChange;return <><button id='open' onClick={()=>setOpen(true)}>Open</button><Activity mode={visible?'visible':'hidden'}><ExploreSocialProvider viewerId={actor}><Card/></ExploreSocialProvider><Profile actor={actor}/></Activity><ContentViewer open={open} onClose={()=>setOpen(false)} aria-label='Post preview'><article className='panel'><div className='media'>Photo</div><div className='body'><h2>Salon</h2><p style={{height:160}}>Post metadata and actions</p><textarea aria-label='Comment as viewer' style={{height:52,width:'100%'}}/><button id='close' onClick={()=>setOpen(false)}>Close</button></div></article></ContentViewer></>};createRoot(document.getElementById('root')).render(<App/>);`;

async function assets(){
 const stubs={
  '@/components/overlay-dismissal':`export const useTransientOverlay=()=>{};`,
  '@/components/auth-intent-prompt':`export const AuthIntentPrompt=()=>null;`,
  '@/components/reylumi-icons':`export const ReylumiIcon=()=>null;`,
  '@/components/workspace-language':`export const WorkspaceText=({text})=>text;`,
  '@/components/action-feedback':`export const ActionFeedback=({children})=>children;`,
  '@/components/explore-account-actions':`export const ExploreBookButton=()=>null;`,
  '@/app/salon-profile/post-actions':`export const PostActions=()=>null;`,
  '@/app/saved-post/save-post-button':`export const SavePostButton=()=>null;`,
  '@/app/explore/social-actions':`export const setExploreSalonPreferenceAction=async()=>({error:null});`,
  '@/lib/post-share':`export const sharePostLink=async()=>{};`,
  'next/link':`export default function Link(){return null;}`,
 };
 const bundle=await build({stdin:{contents:fixture,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,jsx:'automatic',format:'iife',alias:{'@':process.cwd()},plugins:[{name:'fixture',setup(b){b.onResolve({filter:/.*/},args=>stubs[args.path]?{path:args.path,namespace:'stub'}:args.path.endsWith('.module.css')?{path:args.path,namespace:'css'}:null);b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:stubs[args.path],loader:'js'}));b.onLoad({filter:/.*/,namespace:'css'},()=>({contents:'export default {}',loader:'js'}));}}]});
 const source=fs.readFileSync('app/globals.css','utf8').replace('@import "tailwindcss";','@import "tailwindcss" source(none);\n@source "../components/content-viewer.tsx";');
 const {css}=await postcss([tailwind()]).process(source,{from:path.resolve('app/globals.css')});
 return {js:bundle.outputFiles[0].text,css:css+'\n'+fs.readFileSync('components/salon-post-preview.module.css','utf8')};
}

test('actual viewer keeps the focused composer inside the resized viewport without moving the feed; actor-scoped follow state survives stale reads and account changes',{timeout:90000},async()=>{
 fs.mkdirSync(out,{recursive:true});const {js,css}=await assets();const browser=await chromium.launch({headless:true,executablePath:process.env.TEST_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});const results=[];
 try{
  for(const [width,height,keyboard] of [[1024,768,400],[768,1024,690],[390,844,450]]){
   const p=await browser.newPage({viewport:{width,height}});const errors=[];p.on('pageerror',e=>errors.push(e.message));
   await p.setContent(`<meta name='viewport' content='width=device-width,initial-scale=1'><style>${css}</style><div id='root'></div><script>${js}</script>`);
   await p.waitForFunction(()=>window.requests.length===2);await p.evaluate(()=>window.replyAll(true));await p.waitForFunction(()=>document.querySelector('#profile').textContent==='true');
   assert.equal(JSON.parse(await p.locator('#card').textContent()).following,true,'Profile overrides stale public false with actor-scoped state used by Explore');
   await p.locator('#open').click();await p.getByLabel('Comment as viewer').focus();
   await p.evaluate(h=>{Object.defineProperty(visualViewport,'height',{configurable:true,get:()=>h});visualViewport.dispatchEvent(new Event('resize'));},keyboard);
   await p.waitForFunction(h=>{const r=document.querySelector('textarea').getBoundingClientRect();return r.top>=0&&r.bottom<=h;},keyboard);
   const visible=await p.locator('textarea').evaluate(field=>{const r=field.getBoundingClientRect();const panel=field.closest('.panel').getBoundingClientRect();const overlay=field.closest('.content-viewer').getBoundingClientRect();return r.top>=Math.max(panel.top,overlay.top)&&r.bottom<=Math.min(panel.bottom,overlay.bottom)&&field.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));});
   assert.equal(visible,true,'Composer must be inside the actual clipping panel and receive touches, not just above the keyboard');
   assert.equal(await p.evaluate(()=>window.scrollY),0,'The underlying feed stays in place');
   await p.screenshot({path:`${out}/keyboard-${width}.png`});
   if(width===1024){
    await p.evaluate(()=>{Object.defineProperty(window,'innerHeight',{configurable:true,get:()=>496});Object.defineProperty(visualViewport,'offsetTop',{configurable:true,get:()=>252.5});Object.defineProperty(visualViewport,'height',{configurable:true,get:()=>395});visualViewport.dispatchEvent(new Event('resize'));});
    await p.waitForFunction(()=>document.querySelector('.content-viewer').style.getPropertyValue('--content-viewer-height')==='395px');
    assert.equal(await p.locator('.content-viewer').evaluate(e=>e.getBoundingClientRect().height),395,'iPad keyboard pan must not subtract visualViewport.offsetTop twice');
    await p.evaluate(()=>{Object.defineProperty(window,'innerHeight',{configurable:true,get:()=>768});Object.defineProperty(visualViewport,'offsetTop',{configurable:true,get:()=>0});});
   }
   await p.evaluate(()=>{Object.defineProperty(visualViewport,'height',{configurable:true,get:()=>innerHeight});visualViewport.dispatchEvent(new Event('resize'));});
   await p.locator('#close').click();
   await p.evaluate(()=>window.dispatchEvent(new Event('focus')));await p.waitForFunction(()=>window.requests.length>0);await p.locator('#commit').click();await p.evaluate(()=>window.replyAll(true));
   await p.waitForFunction(()=>document.querySelector('#profile').textContent==='false');assert.equal(JSON.parse(await p.locator('#card').textContent()).following,false,'Stale in-flight profile response cannot undo a completed action');
   await p.evaluate(()=>window.visible(false));await p.waitForFunction(()=>document.querySelector('#profile').getClientRects().length===0);await p.evaluate(()=>window.replyAll(false));
   await p.evaluate(()=>window.visible(true));await p.waitForFunction(()=>window.requests.length>=2);await p.evaluate(()=>window.replyAll(true));
   await p.waitForFunction(()=>document.querySelector('#profile').textContent==='true');await p.waitForFunction(()=>JSON.parse(document.querySelector('#card').textContent).following===true);
   await p.evaluate(()=>window.actor('actor-b'));await p.waitForFunction(()=>document.querySelector('#loading').textContent==='true');assert.equal(await p.locator('#profile').textContent(),'false','Previous actor follow does not leak during new read');
   await p.evaluate(salonId=>window.publish({viewerId:'actor-a',salonId,following:true}),sid);assert.equal(await p.locator('#profile').textContent(),'false');await p.evaluate(()=>window.replyAll(false));
   await p.waitForFunction(()=>document.querySelector('#loading').textContent==='false');
   await p.evaluate(()=>window.actor(null));await p.waitForFunction(()=>document.querySelector('#profile').textContent==='false');assert.deepEqual(errors,[]);results.push({width,height,keyboard,passed:true});await p.close();
  }
  const p=await browser.newPage();await p.setContent(`<style>${css}</style><div id='root'></div><script>${js}</script>`);await p.waitForFunction(()=>window.requests.length===2);
  await p.evaluate(salonId=>window.publish({viewerId:'actor-a',salonId,following:false}),sid);await p.evaluate(()=>window.replyAll(true));await p.waitForFunction(()=>JSON.parse(document.querySelector('#card').textContent).loved);
  assert.deepEqual(JSON.parse(await p.locator('#card').textContent()),{following:false,loved:true,saved:true,hidden:false},'A late initial Explore read preserves other preferences and the newer follow event');await p.close();
  fs.writeFileSync(out+'/runtime-results.json',JSON.stringify(results,null,2));
 }finally{await browser.close();}
});
