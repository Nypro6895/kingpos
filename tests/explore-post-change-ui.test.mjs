import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { build } from "esbuild";
import { chromium, webkit } from "playwright-core";

test("Explore synchronizes edited captions across feed, inspiration and preview without losing drafts", { timeout: 120000 }, async () => {
  const feed = readFileSync("app/explore/explore-feed.tsx", "utf8");
  const card = feed.slice(feed.indexOf("function ExploreFeedCard("), feed.indexOf("export function ExploreFeedSkeleton"));
  const target = feed.slice(feed.indexOf("function exploreCommentTarget("), feed.indexOf("function FeedHeroIntro("));
  const bundle = await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import Link from 'next/link';
    import {ExploreInspirationPost} from './app/explore/explore-inspiration-post';
    import {SalonPostPreview} from './components/salon-post-preview';
    import {usePostCaption,announcePostChange} from './components/post-change-state';
    import {useHiddenPosts,postIdentity} from '@/components/post-safety';
    import {COLLAPSED_COMMENTS} from './lib/explore-comment-presentation';
    import {explorePostIdentity} from './lib/explore-post-presentation';
    import {ExploreSalonMenu,ExploreSalonFollow,ExploreSocialActions,useSalonSocial} from '@/components/explore-social';
    import {PostCommentThread} from '@/app/post-comments/post-comment-thread';
    const PostActions=()=>null,FeedAvatar=()=>null,FeedMediaFrame=()=>null;
    const displayName=(value,fallback)=>value||fallback,itemContextLabel=()=> 'Post title',timeAgo=()=> 'Today';
    ${target}
    ${card}
    const sourceId='10000000-0000-4000-8000-000000000001',salonId='20000000-0000-4000-8000-000000000001';
    const original='Original caption excerpt';
    const salon={id:salonId,name:'King Nails',href:'/salon',city:'Milwaukee',state:'WI'};
    const base={salonId,salonName:salon.name,salonCity:'Milwaukee',salonState:'WI',salonLogoImageUrl:null,imageUrl:'/photo.svg',commentCount:0,
      contentId:sourceId,contentType:'look',serviceName:'Full service name',bookingEnabled:false,bookingHref:null,phoneHref:null,trust:{},operatingStatus:{isOpen:true},saveTarget:null};
    const post={author:{name:'Artist'},salon,sourceType:'salon',salonAuthorName:'Artist',contentType:'look',contentId:sourceId,feedKey:'look:'+sourceId,
      destination:{href:'/post'},saveTarget:{sourceType:'salon_profile_look',sourceId},commentCount:0,booking:null};
    window.change=(caption,viewerId='viewer-1',id=sourceId)=>announcePostChange({target:{sourceType:'salon_profile_look',sourceId:id},action:'edit',caption},viewerId);
    function App(){const [userId,setUserId]=useState('viewer-1'),[caption,setCaption]=useState(original);window.selectUser=setUserId;window.serverCaption=setCaption;
      const viewer={userId,isAuthenticated:true,canModerate:false,canReplyAsSalon:false},item={...base,captionExcerpt:caption};
      return <><section aria-label='Feed'><ExploreFeedCard item={{...post,caption}} viewer={viewer} commentPresentation={{preview:false,composer:true}} onCommentCountChange={()=>{}}/></section>
        <section aria-label='Inspiration'><ExploreInspirationPost item={item} viewer={viewer} onOpen={value=>window.opened=value}/></section>
        <section aria-label='Preview'><SalonPostPreview item={item} viewer={viewer} onClose={()=>{}} location={null} service='Full service name' price={null} duration={null} href='/post'/></section>
        <div style={{height:2000}}/></>;
    }createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle: true, write: false, outdir: "fixture", jsx: "automatic", plugins: [{ name: "boundaries", setup(builder) {
    const mocks = {
      "next/link": "export default function Link({prefetch,children,...props}){return <a {...props}>{children}</a>}",
      "next/image": "export default function Image({fill,sizes,priority,...props}){return <img {...props}/>}",
      "@/components/explore-social": "export const useSalonSocial=()=>({state:{hidden:false}});export const ExploreSalonFollow=()=>null,ExploreSalonMenu=()=>null,ExploreSocialActions=()=>null;",
      "@/components/post-safety": "export const useHiddenPosts=()=>[];export const postIdentity=target=>target.sourceType+':'+target.sourceId;",
      "@/components/content-viewer": "export const ContentViewer=({children,open=true})=>open?<div>{children}</div>:null;",
      "@/components/workspace-language": "export const WorkspaceText=({text})=>text;export const useWorkspaceTranslation=()=>text=>text;",
      "@/components/salon-trust-line": "export const SalonTrustLine=()=>null,SalonVerifiedBadge=()=>null;",
      "@/components/salon-operating-status-badge": "export const SalonOperatingStatusBadge=()=>null;",
      "@/components/reylumi-icons": "export const ReylumiIcon=()=>null;",
      "@/app/post-comments/post-comment-thread": "export const PostCommentThread=()=> <textarea aria-label='Comment draft'/>;",
    };
    builder.onResolve({ filter: /.*/ }, args => args.path in mocks ? { path: args.path, namespace: "mock" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: mocks[args.path], loader: "tsx", resolveDir: process.cwd() }));
  } }] });
  const browsers = [{ name: "Chrome", type: chromium, options: { executablePath: process.env.TEST_BROWSER_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe" } }];
  const webkitPath = [webkit.executablePath(), "C:/Users/giuse/AppData/Local/ms-playwright/webkit-2311/Playwright.exe"].find(existsSync);
  if (webkitPath) browsers.push({ name: "WebKit", type: webkit, options: { executablePath: webkitPath } });
  for (const { name, type, options } of browsers) {
    const browser = await type.launch({ ...options, headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.route("https://post-change.test/**", route => {
        const path = new URL(route.request().url()).pathname;
        if (path === "/app.js") return route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles.find(file => file.path.endsWith(".js")).text });
        if (path === "/photo.svg") return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="20"/>' });
        return route.fulfill({ contentType: "text/html", body: '<div id="root"></div><script src="/app.js"></script>' });
      });
      await page.goto("https://post-change.test/");
      const copies = page.getByText("Original caption excerpt", { exact: true });
      await copies.first().waitFor({ timeout: 5000 }).catch(error => { assert.deepEqual(errors, [], "The merged Explore fixture must mount without runtime errors"); throw error; });
      assert.equal(await copies.count(), 3, name);
      const draft = page.getByRole("region", { name: "Feed", exact: true }).getByRole("textbox");
      await draft.fill("Unfinished comment");
      await page.evaluate(() => { window.cardNode = document.querySelector('[data-testid="explore-feed-card"]'); window.scrollTo(0, 150); });
      const scroll = await page.evaluate(() => window.scrollY);
      await page.evaluate(() => window.change("Other account caption", "viewer-2"));
      await page.waitForTimeout(30);
      assert.equal(await copies.count(), 3, "other account events cannot patch the current account");
      await page.evaluate(() => window.change("Other post caption", "viewer-1", "30000000-0000-4000-8000-000000000001"));
      await page.waitForTimeout(30);
      assert.equal(await copies.count(), 3, "other post events cannot patch this post");
      await page.evaluate(() => window.change("Full newly edited caption"));
      await page.getByText("Full newly edited caption", { exact: true }).first().waitFor();
      assert.equal(await page.getByText("Full newly edited caption", { exact: true }).count(), 3, name);
      assert.equal(await draft.inputValue(), "Unfinished comment");
      assert.equal(await page.evaluate(() => window.cardNode === document.querySelector('[data-testid="explore-feed-card"]')), true);
      assert.equal(await page.evaluate(() => window.scrollY), scroll);
      await page.getByRole("button", { name: "Open King Nails post" }).click();
      assert.equal(await page.evaluate(() => window.opened.captionExcerpt), "Full newly edited caption");
      assert.equal(await page.evaluate(() => window.opened.serviceName), "Full service name");
      await page.evaluate(() => window.change(null));
      await page.waitForFunction(() => !document.body.textContent.includes("Full newly edited caption"));
      assert.equal(await page.getByText("Original caption excerpt", { exact: true }).count(), 0, "clearing a caption must not restore old excerpt/title");
      await page.evaluate(() => window.serverCaption("Fresh server caption"));
      await page.getByText("Fresh server caption", { exact: true }).first().waitFor();
      assert.equal(await page.getByText("Fresh server caption", { exact: true }).count(), 3);
      await page.evaluate(() => window.change("Private local patch"));
      await page.getByText("Private local patch", { exact: true }).first().waitFor();
      await page.evaluate(() => window.selectUser("viewer-2"));
      await page.getByText("Fresh server caption", { exact: true }).first().waitFor();
      assert.equal(await page.getByText("Private local patch", { exact: true }).count(), 0);
      assert.deepEqual(errors, [], name);
    } finally { await browser.close(); }
  }
});
