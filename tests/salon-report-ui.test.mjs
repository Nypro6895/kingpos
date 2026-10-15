import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

test("report salon opens in place from Explore and profile, submits once, and supports retry and keyboard dismissal", { timeout: 120000 }, async () => {
  const feed = readFileSync("app/explore/explore-feed.tsx", "utf8");
  const card = feed.slice(feed.indexOf("function ExploreFeedCard("), feed.indexOf("export function ExploreFeedSkeleton"));
  const target = feed.slice(feed.indexOf("function exploreCommentTarget("), feed.indexOf("function FeedHeroIntro("));
  const { css } = await postcss([tailwind()]).process('@import "tailwindcss" source(none); @source "./components/salon-report-dialog.tsx"; @source "./app/salon-profile/post-actions.tsx";', { from: "salon-report-fixture.css" });
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
    import Link from 'next/link';
    import {PostActions} from './app/salon-profile/post-actions';
    import {SalonReportDialog} from './components/salon-report-dialog';
    import {SalonWebsiteHeader} from './app/salon-profile/salon-website-header';
    import {OverlayDismissal} from './components/overlay-dismissal';
    import {useHiddenPosts,postIdentity} from '@/components/post-safety';
    import {COLLAPSED_COMMENTS} from './lib/explore-comment-presentation';
    import {explorePostIdentity} from './lib/explore-post-presentation';
    const serviceLabel=()=>null,displayName=(name,fallback)=>name||fallback,timeAgo=()=>'',itemContextLabel=item=>item.author.name;
    const Empty=()=>null, FeedHeroIntro=Empty,FeedAvatar=Empty,FeedSalonIdentityLine=Empty,FeedMediaFrame=Empty,FeedDecisionMeta=Empty,InspirationAvailability=Empty,ExploreBookButton=Empty,FeedShareButton=Empty,CommentActionIcon=Empty,SavePostButton=Empty,ExploreSalonLove=Empty,PostCommentThread=Empty;
    const useSalonSocial=()=>({state:{hidden:false}}),ExploreSalonFollow=Empty,ExploreSocialActions=Empty,ExploreSalonMenu=({salon,target})=><PostActions salon={salon} target={target}/>;
    const ActionTooltip=({children})=>children,FeedHeaderTitle=({item})=><span>{item.author.name}</span>;
    ${target}
    ${card}
    const salon={id:'00000000-0000-4000-8000-000000000010',name:'King Nails'};
    const post={feedKey:'post:1',sourceType:'salon',contentType:'look',author:{name:'King Nails'},salon,destination:{href:'/explore/salons/'+salon.id},saveTarget:{sourceId:'00000000-0000-4000-8000-000000000030',sourceType:'salon_profile_look'},commentCount:0};
    const viewer={userId:null,isAuthenticated:false}; window.calls=[]; window.permissions=[]; window.response='ok';
    function App(){const [report,setReport]=useState(false);return <>
      <OverlayDismissal/>
      <section aria-label="Explore post"><ExploreFeedCard item={post} viewer={viewer} onCommentCountChange={()=>{}}/></section>
      <section aria-label="Explore salon recommendation"><ExploreFeedCard item={{...post,feedKey:'salon:1',contentType:'salon_recommendation',saveTarget:null}} viewer={viewer} onCommentCountChange={()=>{}}/></section>
      <section aria-label="Personal post"><ExploreFeedCard item={{...post,feedKey:'personal:1',sourceType:'personal',salon:null}} viewer={viewer} onCommentCountChange={()=>{}}/></section>
      <section aria-label="Compact salon" style={{transform:'translateY(-2px)',overflow:'hidden'}}><PostActions salon={salon}/></section>
      <SalonWebsiteHeader profile={{salonId:salon.id,name:salon.name,city:'Milwaukee',state:'WI'}} layout="balanced" tabs={[]} extraTabs={[]} selectedTab="discover" onTab={()=>{}} onTabKeyDown={()=>{}} canBook={false} onBook={()=>{}} canFollow={false} following={false} followPending={false} onFollow={()=>{}} onHours={()=>{}} canShare={false} onShare={()=>{}} onReport={()=>setReport(true)}/>
      {report?<SalonReportDialog salon={salon} onClose={()=>setReport(false)}/>:null}
    </>};createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle: true, write: false, outdir: "fixture", jsx: "automatic", plugins: [{ name: "report-fixture", setup(builder) {
    const mocks = {
      "next/link": "export default function Link({prefetch,children,...props}){return <a {...props}>{children}</a>}",
      "next/navigation": "export function usePathname(){return '/explore'}",
      "@/components/workspace-language": "export const WorkspaceText=({text})=>text; export const useWorkspaceTranslation=()=>text=>text;",
      "@/app/salon-profile/report-actions": "export async function reportSalonAction(input){window.calls.push(input); await new Promise(resolve=>setTimeout(resolve,80)); if(window.response==='error')return {ok:false,error:'Please try again.'}; if(window.response==='throw')throw new Error('offline'); return {ok:true,supportHref:window.response==='account'?'/support/report-1':null}}",
      "@/app/post-moderation/actions": "export async function postModerationAction(target,action){window.permissions.push({target,action});return {data:{}}}",
      "@/components/post-safety": "export const useHiddenPosts=()=>[]; export const postIdentity=target=>target.sourceId; export function PostSafetyDialog(){return <div role='dialog'>Report post form</div>}",
    };
    builder.onResolve({ filter: /.*/ }, args => args.path in mocks ? { path: args.path, namespace: "fixture" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: mocks[args.path], loader: "tsx", resolveDir: process.cwd() }));
  } }] });
  const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("https://report.test/", route => route.fulfill({ contentType: "text/html", body: `<style>${css}body{font:15px Arial;margin:16px}section{margin:16px 0}button{cursor:pointer}${result.outputFiles.find(file => file.path.endsWith('.css')).text}</style><div id="root"></div><script src="/app.js"></script>` }));
    await page.route("**/app.js", route => route.fulfill({ contentType: "text/javascript", body: result.outputFiles.find(file => file.path.endsWith('.js')).text }));
    await page.goto("https://report.test/");
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.deepEqual(errors, [], "the current Explore card fixture mounts without missing dependencies");
    mkdirSync("work/salon-report-qa", { recursive: true });
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const trigger = page.getByRole("region", { name: "Explore salon recommendation", exact: true }).getByLabel("Salon actions");
      await trigger.click();
      assert.equal(await page.getByRole("menuitem", { name: "Report post", exact: true }).count(), 0);
      await page.getByRole("menuitem", { name: "Report salon", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Report salon", exact: true });
      await dialog.waitFor();
      assert.equal(page.url(), "https://report.test/");
      assert.equal(await page.getByRole("button", { name: "Send report", exact: true }).isDisabled(), true);
      await page.getByRole("menu").waitFor({ state: "hidden" });
      assert.equal(await page.getByRole("menu").count(), 0);
      await page.getByRole("radio", { name: "Incorrect salon information", exact: true }).check();
      await page.getByRole("textbox").fill("The listed address is incorrect.");
      const bounds = await dialog.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
      await page.screenshot({ path: `work/salon-report-qa/report-${width}.png` });
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      assert.equal(await trigger.evaluate(node => document.activeElement === node), true);
    }
    await page.getByRole("region", { name: "Explore post", exact: true }).getByLabel("Post actions").click();
    await page.getByRole("menuitem", { name: "Report post", exact: true }).waitFor();
    assert.equal(await page.getByRole("menuitem", { name: "Report post", exact: true }).count(), 1);
    await page.getByRole("menuitem", { name: "Report salon", exact: true }).click();
    await page.getByRole("radio", { name: "Scam, fraud or impersonation", exact: true }).check();
    await page.getByRole("textbox").fill("Suspicious deposit request");
    await page.evaluate(() => { window.response = "error"; });
    await page.getByRole("button", { name: "Send report", exact: true }).click();
    await page.getByRole("alert").waitFor();
    assert.equal(await page.getByRole("textbox").inputValue(), "Suspicious deposit request");
    await page.evaluate(() => { window.response = "account"; });
    await page.getByRole("button", { name: "Send report", exact: true }).dblclick();
    await page.getByRole("status").waitFor();
    const calls = await page.evaluate(() => window.calls);
    assert.equal(calls.length, 2, "double click sends only one retry");
    assert.equal(calls[0].requestId, calls[1].requestId);
    assert.equal(calls[1].salonId, "00000000-0000-4000-8000-000000000010");
    assert.equal(calls[1].reason, "scam");
    assert.equal(await page.getByRole("link", { name: "View report & conversation" }).getAttribute("href"), "/support/report-1");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByLabel("More profile sections and actions").click();
    await page.getByRole("button", { name: "Report salon", exact: true }).click();
    await page.getByRole("dialog", { name: "Report salon" }).waitFor();
    assert.equal(await page.getByRole("radio", { checked: true }).count(), 0);
    await page.getByRole("radio", { name: "Duplicate salon profile", exact: true }).check();
    await page.evaluate(() => { window.response = "ok"; });
    await page.getByRole("button", { name: "Send report", exact: true }).click();
    await page.getByRole("status").waitFor();
    assert.equal(await page.getByRole("link", { name: "View report & conversation" }).count(), 0);
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("region", { name: "Personal post", exact: true }).getByLabel("Post actions").click();
    await page.getByRole("menuitem", { name: "Report post", exact: true }).waitFor();
    assert.equal(await page.getByRole("menuitem", { name: "Report salon", exact: true }).count(), 0);
    await page.keyboard.press("Escape");
    await page.getByRole("menu").waitFor({ state: "hidden" });
    await page.getByRole("region", { name: "Compact salon", exact: true }).getByLabel("Salon actions").click();
    const menu = await page.getByRole("menu").boundingBox();
    assert.ok(menu.x >= 0 && menu.x + menu.width <= 1440);
    await page.getByRole("menuitem", { name: "Report salon", exact: true }).click();
    await page.getByRole("dialog", { name: "Report salon" }).waitFor();
    await page.evaluate(() => document.dispatchEvent(new Event("reylumi:overlay-navigation")));
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
