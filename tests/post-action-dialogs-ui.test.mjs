import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright-core';

test('post dialogs keep Love, Comment, Share, Book in one row and preserve their actions', { timeout: 120000 }, async () => {
  const source = readFileSync('app/salon-profile/salon-profile-view.tsx', 'utf8');
  const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  const fixture = `
    import React,{useState,useId,useContext,createContext} from 'react';import {createRoot} from 'react-dom/client';
    import {ContentViewer} from './components/content-viewer';import {SavePostButton} from './app/saved-post/save-post-button';
    import {ExploreBookButton,ExploreAccountActionsProvider} from './components/explore-account-actions';
    import {PostShareButton} from './components/post-share-button';
    import {WorkspaceText,useWorkspaceTranslation} from './components/workspace-language';
    const ProfilePreferencesContext=createContext({allow_comments:true,allow_saves:true,allow_sharing:true});
    const ProfileSavePostButton=SavePostButton,ProfileSharePostButton=PostShareButton;
    const ProfilePostCommentThread=()=> <textarea aria-label="Write a comment"/>;
    const ProfilePostAvatar=()=>null,ProfilePostIdentity=()=> 'King Nails Spa LLC',ProfileCustomerIdentity=()=> 'Nina',PostActions=()=>null;
    const LookImage=()=> <div style={{height:180,background:'#f4ded4'}}/>,BeforeAfterCompare=LookImage;
    const CaptionWithHashtags=({text})=>text;
    const postCommentViewer=()=>({isAuthenticated:true,userId:'viewer'}),initialsFor=()=> 'NN',joinMeta=parts=>parts.filter(Boolean).join(' · '),timeAgo=()=> 'Today';
    const formatMoney=()=> '$40',formatDuration=()=> '45m';
    ${section('function profileFeedCommentTarget(', 'function formatMoney(')}
    ${section('type TimelineActionIconName =', 'function LookImage(')}
    ${section('function LookDetailDialog(', 'function StaffDetailDialog(')}
    const salonId='10000000-0000-4000-8000-000000000000',id='20000000-0000-4000-8000-000000000000';
    const look={id,title:'Fall season',caption:'Fall is coming!',hashtags:[],commentCount:2};
    const post={...look,profileId:'nina',authorDisplayName:'Nina',media:[],postHref:'/explore/beauty/nina/posts/'+id,booking:{eligible:true,href:'/book/'+salonId+'?beautyPostId='+id}};
    window.events=[];window.shares=[];Object.defineProperty(navigator,'share',{configurable:true,value:async data=>window.shares.push(data)});
    window.addEventListener('reylumi:quick-book',event=>window.events.push(['book',event.detail.href]));
    function App(){const [kind,setKind]=useState('look');window.select=setKind;
      const props={capabilities:{isAuthenticated:true,currentUserId:'viewer',canBook:true},commentCount:2,onClose:()=>{},onCommentCountChange:()=>{},onBook:context=>window.events.push(['book',context]),onSave:()=>window.events.push(['love']),onShare:()=>window.events.push(['share']),onViewInTimeline:()=>{},salonId};
      return <ExploreAccountActionsProvider authenticated>{kind==='look'?<LookDetailDialog {...props} look={look} saveCount={1}/>:kind==='feed'?<FeedPostDetailDialog {...props} item={{...look,salonId,contentType:'look'}}/>:<BeautyPostDetailDialog {...props} post={post}/>}</ExploreAccountActionsProvider>;
    }createRoot(document.getElementById('root')).render(<App/>);
  `;
  const mocks = {
    'next/navigation': "export const usePathname=()=>'/explore';",
    'next/link': 'export default function Link({children,...props}){return <a {...props}>{children}</a>}',
    '@/lib/supabase/browser': 'export function createSupabaseBrowserClient(){return null}',
    '@/app/explore/account-actions': 'export async function salonLoveAction(){return {}};export async function referenceLoveAction(){return {}}',
    '@/app/saved-post/actions': 'export async function getAccountSavedPostStatesAction(){return {canSave:true,savedKeys:[],saveCountsByKey:{}}};export async function setAccountSavedPostAction(target,active){window.events.push(["love",target]);return {active,saveCount:active?1:0}}',
  };
  const bundle = await build({ stdin:{contents:fixture,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,outdir:"fixture",jsx:'automatic',plugins:[{name:'boundaries',setup(b){
    b.onResolve({filter:/.*/},a=>a.path in mocks?{path:a.path,namespace:'stub'}:undefined);
    b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:mocks[a.path],loader:'tsx',resolveDir:process.cwd()}));
  }}] });
  const {css} = await postcss([tailwind()]).process(readFileSync('app/globals.css','utf8').replace('@import "tailwindcss";','@import "tailwindcss" source(none); @source "./salon-profile/salon-profile-view.tsx"; @source "./saved-post/save-post-button.tsx"; @source "../components/content-viewer.tsx"; @source "../components/explore-account-actions.tsx"; @source "../components/post-share-button.tsx";'),{from:'app/globals.css'});
  const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  mkdirSync('artifacts/post-actions-20261013/qa',{recursive:true});
  try {
    const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('https://dialogs.test/',r=>r.fulfill({contentType:'text/html',body:`<style>${css}body{margin:0;font-family:Arial}</style><div id="root"></div><script src="/app.js"></script>`}));
    await page.route('https://dialogs.test/app.js',r=>r.fulfill({contentType:'text/javascript',body:bundle.outputFiles.find(f=>f.path.endsWith('.js')).text}));
    for(const width of [320,390,768,1440]) for(const kind of ['look','feed','beauty']) {
      await page.setViewportSize({width,height:900});await page.goto('https://dialogs.test/');
      await page.waitForFunction(()=>typeof window.select==='function',{},{timeout:3000}).catch(error=>{console.log(errors);throw error;});await page.evaluate(kind=>window.select(kind),kind);
      const toolbar=page.locator('.post-action-toolbar');await toolbar.waitFor();
      const buttons=toolbar.getByRole('button');assert.equal(await buttons.count(),4);
      const labels=await buttons.evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-label')));
      assert.match(labels[0],/Love|Save post/);assert.match(labels[1],/comments/);assert.match(labels[2],/Share/);assert.match(labels[3],/Book/);
      await toolbar.scrollIntoViewIfNeeded();
      const boxes=await buttons.evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect(),icon=node.querySelector('svg').getBoundingClientRect();return {x:r.x,right:r.right,y:r.y+r.height/2,height:r.height,iconWidth:icon.width}}));
      assert.ok(boxes.every(box=>box.x>=0&&box.right<=width&&box.height>=44&&box.iconWidth>=16));
      assert.ok(Math.max(...boxes.map(box=>box.y))-Math.min(...boxes.map(box=>box.y))<2);
      await buttons.nth(0).click();await page.waitForFunction(()=>window.events.some(event=>event[0]==='love'));
      await buttons.nth(1).click();assert.equal(await page.getByLabel('Write a comment').evaluate(node=>document.activeElement===node),true);
      await buttons.nth(2).click();await buttons.nth(3).click();
      if(kind==='beauty') {assert.match(await page.evaluate(()=>window.shares[0].url),/\/posts\/20000000/);assert.match(await page.evaluate(()=>window.events.find(event=>event[0]==='book')[1]),/beautyPostId=/);}
      else {assert.ok(await page.evaluate(()=>window.events.some(event=>event[0]==='share')));assert.equal(await page.evaluate(()=>window.events.find(event=>event[0]==='book')[1].lookId),'20000000-0000-4000-8000-000000000000');}
      if(width===390)await page.screenshot({path:'artifacts/post-actions-20261013/qa/'+kind+'-dialog.png'});
    }
    // Browsers without native sharing copy the canonical post URL instead.
    await page.evaluate(()=>{Object.defineProperty(navigator,'share',{value:undefined,configurable:true});Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>window.copied=text},configurable:true});});
    await page.getByRole('button',{name:'Share post',exact:true}).click();
    await page.getByRole('status').filter({hasText:'Link copied.'}).waitFor();assert.match(await page.evaluate(()=>window.copied),/\/posts\/20000000/);
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});
