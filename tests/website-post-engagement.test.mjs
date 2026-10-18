import assert from "node:assert/strict";
import { readFileSync, mkdirSync } from "node:fs";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

test("all website layouts connect photo Love, comments, booking, menus and continuation", { timeout: 120000 }, async () => {
  const view = readFileSync("app/salon-profile/salon-profile-view.tsx", "utf8");
  const globalCss = readFileSync("app/globals.css", "utf8");
  const { css: toolbarCss } = await postcss([tailwind()]).process(globalCss.replace('@import "tailwindcss";', '@import "tailwindcss" source(none); @source "../components/explore-account-actions.tsx"; @source "../components/post-share-button.tsx"; @source "./saved-post/save-post-button.tsx"; @source "./post-comments/post-comment-thread.tsx";'), { from: "app/globals.css" });
  const section = (start, end) => view.slice(view.indexOf(start), view.indexOf(end, view.indexOf(start)));
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
    import {SalonWebsiteHome} from './app/salon-profile/salon-website-home';
    import {WebsitePostEngagement} from './app/salon-profile/website-post-engagement';
    import {SavePostButton} from './app/saved-post/save-post-button';
    import {PostCommentThread} from './app/post-comments/post-comment-thread';
    import {ExploreBookButton,ExploreAccountActionsProvider} from './components/explore-account-actions';
    import {PostActions} from './app/salon-profile/post-actions';
    ${section("function profileFeedCommentTarget(", "function formatMoney(")}
    const salonId='10000000-0000-4000-8000-000000000000';
    const posts=Array.from({length:16},(_,i)=>({id:'20000000-0000-4000-8000-'+String(i).padStart(12,'0'),salonId,
      title:'Nail design '+i,caption:'Handcrafted nail art',contentType:i===3?'update':'look',updateType:'last_minute_opening',startsAt:'2026-10-14T15:00:00Z',
      imageUrl:'/photo-'+i+'.webp',publishedAt:'2026-10-'+String(20-i).padStart(2,'0'),isPinned:i===15,isSaved:false,saveCount:0,commentCount:4}));
    const customerPost={id:'30000000-0000-4000-8000-000000000001',profileId:'customer',postHref:'/explore/beauty/customer/posts/customer-photo',caption:'Customer favorites',commentCount:4,
      booking:{eligible:true,href:'/book/'+salonId+'?beautyPostId=customer-photo',bookedCount:3}};
    const galleryItems=[...posts.map(item=>({id:item.contentType+'-'+item.id,type:'feed',item,title:item.title,imageUrl:item.imageUrl,publishedAt:item.publishedAt})),
      ...[1,2].map(i=>({id:'beauty-'+i,type:'beauty',post:customerPost,title:'Customer photo '+i,imageUrl:'/customer-'+i+'.webp',publishedAt:'2026-10-01'}))];
    window.events=[];window.mutations=[];window.comments={};window.bookings=[];window.shares=[];
    Object.defineProperty(navigator,'share',{configurable:true,value:async data=>window.shares.push(data)});
    window.addEventListener('reylumi:quick-book',event=>window.bookings.push(event.detail.href));
    function App(){
      const [layout,setLayout]=useState('balanced');const [authenticated,setAuthenticated]=useState(true);
      const [enabled,setEnabled]=useState(true);const [commentTarget,setCommentTarget]=useState(null);
      const [commentCountOverrides,setCommentCountOverrides]=useState(new Map());
      const [savedLookIds,setSavedLookIds]=useState(new Set());const [saveCounts,setSaveCounts]=useState(new Map());
      const capabilities={isAuthenticated:authenticated,canBook:true};const isManagedViewer=false;
      const preferences={layout,show_featured:true,show_services:false,show_team:false,show_customer_reviews:false,allow_comments:enabled,allow_saves:enabled,allow_sharing:enabled};
      const profile={name:'King Nails Spa LLC',salonId,phone:'4145550100',city:'Milwaukee',state:'WI'};
      const data={profile,services:[],staff:[]};const lookById=new Map(posts.filter(p=>p.contentType==='look').map(p=>[p.id,p]));
      window.configure=(layout,auth=true,enabled=true)=>{setLayout(layout);setAuthenticated(auth);setEnabled(enabled)};
      ${section("  function bookingHref(", "  const isManagedViewer =")}
      ${section("  function commentCountForTarget(", "  function selectMood(")}
      ${section("  function applyLookSaveState(", "  function toggleSave(")}
      ${section("  function openWebsiteComments(", "  function openGalleryItem(")}
      return <ExploreAccountActionsProvider authenticated={authenticated}><SalonWebsiteHome key={layout}
        data={data} posts={posts} preferences={preferences} canBook onBook={openBooking}
        onPost={post=>window.events.push(post.id)} onGallery={()=>window.events.push('gallery')} onServices={()=>{}} onTeam={()=>{}}
        libraryPhotos={galleryItems} onLibraryPhoto={photo=>window.events.push(photo.id)}
        renderPostActions={post=><PostActions onOpen={()=>window.events.push(post.id)} onShare={()=>window.events.push('share:'+post.id)}/>}
        renderLibraryActions={photo=><PostActions onOpen={()=>window.events.push(photo.id)}/>}
        renderPostEngagement={renderWebsitePostEngagement} renderLibraryEngagement={renderWebsiteLibraryEngagement}/>
        {commentTarget?<div role="dialog" aria-label="Comments"><button onClick={()=>setCommentTarget(null)}>Close comments</button>
          <PostCommentThread initialCount={commentCountForTarget(commentTarget,0)} target={commentTarget}
            viewer={{userId:'test-user',isAuthenticated:authenticated,canModerate:false,canReplyAsSalon:false}}
            onCountChange={count=>updateCommentCountForTarget(commentTarget,count)}/></div>:null}
      </ExploreAccountActionsProvider>;
    }createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle: true, write: false, outdir: "fixture", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "process.env": '{}' }, plugins: [{ name: "boundaries", setup(builder) {
    const stubs = {
      "next/navigation": "export function usePathname(){return '/explore/salons/test'}export const useRouter=()=>({refresh(){}});",
      "next/link": "export default function Link({children,...props}){return <a {...props}>{children}</a>}",
      "@/lib/supabase/browser": "export function createSupabaseBrowserClient(){return null}",
      "@/app/post-moderation/actions": "export async function postModerationAction(){return {}};export async function loadHiddenPostIdentitiesAction(){return []}",
      "@/app/post-moderation/block-actions": "export async function setUserBlocked(){throw new Error('Unexpected user block in engagement test')}",
      "@/app/salon-profile/report-actions": "export async function reportSalonAction(){return {ok:true}}",
      "@/app/explore/account-actions": "export async function salonLoveAction(){return {}};export async function referenceLoveAction(){return {}}",
      "@/app/saved-post/actions": `export async function getAccountSavedPostStatesAction(targets){return {canSave:true,savedKeys:[],saveCountsByKey:Object.fromEntries(targets.map(t=>[t.sourceType+':'+t.sourceId,0]))}}
        export async function setAccountSavedPostAction(target,active){window.mutations.push({target,active});return {active,saveCount:active?1:0}}`,
      "@/app/post-comments/actions": `export async function createPostCommentAction(input){
        const comment={id:crypto.randomUUID(),body:input.body,authorDisplayName:'Test customer',authorUserId:'test-user',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),isSalonReply:false,parentCommentId:null,replyDepth:0,rootCommentId:null,targetId:input.target.sourceId,targetType:input.target.sourceType};
        window.comments[input.target.sourceId]=[comment];return {error:null,comment,totalCount:5}}
        export async function deletePostCommentAction(){};export async function hidePostCommentAction(){};export async function updatePostCommentAction(){}`,
      "./operating-hours-display": "export function OperatingHoursDisplay(){return null}",
    };
    builder.onResolve({ filter: /.*/ }, args => args.path in stubs ? { path: args.path, namespace: "fixture" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ resolveDir: process.cwd(), loader: "tsx", contents: stubs[args.path] }));
  }}] });
  mkdirSync("work/salon-photo-cards-review", {recursive:true});
  const browser = await chromium.launch({ executablePath: process.env.TEST_BROWSER_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  try {
    const page = await browser.newPage(); page.setDefaultTimeout(10000); const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('https://cards.test/',route=>route.fulfill({contentType:'text/html',body:`<style>*{box-sizing:border-box}body{margin:0;padding:24px;background:#faf8f5;color:#292524;font-family:Arial}#root{max-width:1120px;margin:auto}button{font:inherit;cursor:pointer}h2,h3,h4,p{margin:0}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}[role=dialog]{position:fixed;inset:2%;background:white;z-index:200;overflow:auto;padding:12px;border:1px solid #ddd}${bundle.outputFiles.find(f=>f.path.endsWith('.css')).text}${toolbarCss}</style><div id="root"></div><script src="/app.js"></script>`}));
    await page.route('**/app.js',route=>route.fulfill({contentType:'text/javascript',body:bundle.outputFiles.find(f=>f.path.endsWith('.js')).text}));
    await page.route('**/*.webp',route=>route.fulfill({contentType:'image/webp',body:readFileSync('public/explore/mockup-look-floral.webp')}));
    await page.route('**/api/post-comments?*',async route=>{
      const id=new URL(route.request().url()).searchParams.get('sourceId');
      const items=await page.evaluate(id=>window.comments[id]??[],id);
      return route.fulfill({json:{error:null,items,totalCount:4+items.length,rootCount:4+items.length,hasMore:false,nextOffset:null}});
    });
    for(const width of [320,390,768,1440]) for(const layout of ['booking','portfolio','balanced']) {
      await page.setViewportSize({width,height:1000});await page.goto('https://cards.test/');
      await page.waitForFunction(()=>typeof window.configure==='function');await page.evaluate(layout=>window.configure(layout),layout);
      const latest=page.locator('[data-count]');const more=page.getByRole('region',{name:'More salon photos'});
      assert.equal(await latest.locator('article').count(),6);assert.equal(await more.locator('article').count(),6);
      const rows=await latest.locator('article').evaluateAll(cards=>new Set(cards.map(c=>Math.round(c.getBoundingClientRect().top))).size);
      assert.equal(rows,width===1440?2:width===768?3:6);
      for(const grid of [latest,more]) {
        const card=grid.locator('article').first();const love=card.getByRole('button',{name:'Save post',exact:true});
        const toolbar=card.locator('.post-action-toolbar');
        const buttons=toolbar.getByRole('button');
        assert.equal(await buttons.count(),4);
        const boxes=await buttons.evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();const icon=n.querySelector('svg')?.getBoundingClientRect();return {x:r.x,right:r.right,y:r.y+r.height/2,height:r.height,iconWidth:icon?.width}}));
        assert.ok(boxes.every(box=>box.x>=0&&box.right<=width&&box.height>=44&&box.iconWidth>=16));
        assert.ok(Math.max(...boxes.map(box=>box.y))-Math.min(...boxes.map(box=>box.y))<2,'All four icons share one horizontal row');
        const labels=await buttons.evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label')));
        assert.match(labels[0],/Save post/);assert.match(labels[1],/comments/);assert.equal(labels[2],'Share post');assert.match(labels[3],/^Book /);
        await card.getByRole('button',{name:'Share post',exact:true}).click();
        assert.match(await page.evaluate(()=>window.shares.at(-1).url),/#look-/);
        assert.match(await love.textContent(),/Love\s*0/);
        await love.click();await card.getByRole('button',{name:'Remove from Saved Post',exact:true}).waitFor();
        assert.match(await card.getByRole('button',{name:'Remove from Saved Post',exact:true}).textContent(),/Loved\s*1/);
        await card.getByRole('button',{name:'Remove from Saved Post',exact:true}).click();await love.waitFor();
        const eventCount=await page.evaluate(()=>window.events.length);
        await card.getByRole('button',{name:/^Read 4 comments/}).click();
        const dialog=page.getByRole('dialog',{name:'Comments'});await dialog.waitFor();
        await dialog.getByPlaceholder('Write a public comment...').fill('Beautiful nails!');
        await dialog.getByRole('button',{name:'Post comment',exact:true}).click();
        await dialog.getByText('Comment posted.',{exact:true}).waitFor();
        await dialog.getByText('Beautiful nails!',{exact:true}).waitFor();await dialog.getByRole('button',{name:'Close comments'}).click();
        await card.getByRole('button',{name:/^Read 5 comments/}).waitFor();
        await card.getByRole('button',{name:/^Book /}).click();
        const href=await page.evaluate(()=>window.bookings.at(-1));assert.match(href,/source=public_profile&inspiration=20000000/);
        assert.equal(await page.evaluate(()=>window.events.length),eventCount,'toolbar must not open photo');
      }
      const update=latest.locator('article').filter({has:page.getByText('Nail design 3',{exact:true})});
      await update.getByRole('button',{name:'Book Nail design 3'}).click();
      assert.match(await page.evaluate(()=>window.bookings.at(-1)),/startAt=2026-10-14T15%3A00%3A00Z/);
      await latest.locator('article').first().getByLabel('Post actions',{exact:true}).click();
      await page.getByRole('menuitem',{name:'Share post'}).click();assert.match(await page.evaluate(()=>window.events.at(-1)),/^share:/);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await latest.screenshot({path:`work/salon-photo-cards-review/${layout}-${width}-latest.png`});
      await more.screenshot({path:`work/salon-photo-cards-review/${layout}-${width}-more.png`});
    }
    const more=page.getByRole('region',{name:'More salon photos'});
    for(let i=0;i<5 && await more.getByRole('button',{name:'Load more photos'}).count();i++) {
      await more.getByRole('button',{name:'Load more photos'}).scrollIntoViewIfNeeded();await page.waitForTimeout(150);
    }
    await more.getByRole('status').waitFor();
    const customers=more.locator('article').filter({has:page.getByRole('button',{name:/^Open Customer photo/})});
    assert.equal(await customers.count(),2);assert.equal(await customers.getByText('3 booked').count(),2);
    await customers.first().getByRole('button',{name:'Save post',exact:true}).click();
    await customers.last().getByRole('button',{name:'Remove from Saved Post',exact:true}).waitFor();
    await customers.first().getByRole('button',{name:'Book King Nails Spa LLC'}).click();
    assert.match(await page.evaluate(()=>window.bookings.at(-1)),/beautyPostId=customer-photo/);
    await page.evaluate(()=>window.configure('balanced',true,false));
    await page.waitForFunction(()=>!document.querySelector('[data-count] button[aria-pressed]'));
    assert.equal(await page.locator('[data-count]').getByRole('button',{name:/comments|Save post|Saved/}).count(),0);
    await page.evaluate(()=>window.configure('balanced',false,true));
    await page.locator('[data-count] article').first().getByRole('button',{name:'Sign in to save post'}).click();
    await page.getByRole('dialog').waitFor();
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});
