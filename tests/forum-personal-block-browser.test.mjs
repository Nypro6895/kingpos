import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
test('Forum personal block retries without hiding on failure, removes only blocked content and refreshes on cross-tab unblock',async()=>{
 const built=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`import React from'react';import{createRoot}from'react-dom/client';import Forum from'./app/(app)/forum/forum';
 const section={id:'30000000-0000-4000-8000-000000000001',name:'Operations',description:'',archived:false,position:0};
 const topics=['Blocked topic','Other topic'].map((title,i)=>({id:'30000000-0000-4000-8000-00000000000'+(i+2),author_id:i?'third':'other',author_name:i?'Third':'Other',section_id:section.id,title,body:'Public discussion',created_at:new Date().toISOString(),updated_at:new Date().toISOString(),reply_count:0,following:false,bookmarked:false,pinned:false,locked:false,deleted_at:null}));
 window.blocked=false;window.failBlock=true;window.calls=[];window.fixture={read:async input=>{await new Promise(r=>setTimeout(r,40));return{data:topics.filter(t=>!window.blocked||t.author_id!=='other')};},write:async()=>({data:{ok:true}})};
 createRoot(document.getElementById('root')).render(<Forum initialContext={{user_id:'owner',display_name:'Owner',sections:[section],can_moderate:false,can_manage:false,restriction:null}} initialTopics={topics}/>);`},outdir:'fixture',bundle:true,write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'fixture',setup(b){
 const mocks={
  'next/link':`import React from'react';export default function Link(p){return React.createElement('a',p);}`,
  'next/image':`import React from'react';export default function Image({fill,unoptimized,priority,...p}){return React.createElement('img',p);}`,
  'next/navigation':`export const useRouter=()=>({refresh(){}});`,
  './actions':`export const readForum=i=>window.fixture.read(i);export const writeForum=i=>window.fixture.write(i);`,
  '@/components/explore-advertising':`export const ForumCampaignSlot=()=>null;`,
  '@/components/workspace-language':`export const WorkspaceText=({text})=>text;`,
  './workspace-language':`export const WorkspaceText=({text})=>text;`,
  '@/components/post-safety':`export function notifyUserBlocksChanged(){window.dispatchEvent(new Event('reylumi:user-blocks-changed'));}`,
  './post-safety':`export function notifyUserBlocksChanged(){window.dispatchEvent(new Event('reylumi:user-blocks-changed'));}`,
  '@/app/post-moderation/block-actions':`export async function setUserBlocked(id){window.calls.push(id);if(window.failBlock)return{error:'Try again.'};window.blocked=true;return{error:null};}`
 };
 b.onResolve({filter:/.*/},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'fixture'}:null);
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],loader:'tsx',resolveDir:process.cwd()}));
 }}]});
 const executablePath=[process.env.TEST_BROWSER_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>p&&existsSync(p));assert(executablePath);
 const browser=await chromium.launch({executablePath,headless:true});try{
 const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://forum-fixture.test/**',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));await page.goto('https://forum-fixture.test/forum');
 await page.addScriptTag({content:built.outputFiles.find(f=>f.path.endsWith('.js')).text});
 await page.getByRole('button',{name:'Blocked topic',exact:true}).waitFor();await page.waitForTimeout(100);
 await page.getByLabel('Content actions').first().click();await page.getByRole('button',{name:'Block user',exact:true}).click();
 await page.getByRole('button',{name:'Confirm block',exact:true}).click();await page.getByRole('alert').waitFor();
 assert.equal(await page.getByRole('button',{name:'Blocked topic',exact:true}).count(),1);
 await page.evaluate(()=>{window.failBlock=false});await page.getByRole('button',{name:'Confirm block',exact:true}).click();
 await page.getByRole('button',{name:'Blocked topic',exact:true}).waitFor({state:'detached'});await page.getByRole('button',{name:'Other topic',exact:true}).waitFor();
 await page.evaluate(()=>{window.blocked=false;window.dispatchEvent(new StorageEvent('storage',{key:'reylumi:block-change',newValue:'updated'}));});
 await page.getByRole('button',{name:'Blocked topic',exact:true}).waitFor();assert.deepEqual(await page.evaluate(()=>window.calls),['other','other']);assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
