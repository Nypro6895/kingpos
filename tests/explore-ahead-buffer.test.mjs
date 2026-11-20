import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const executablePath = [process.env.TEST_BROWSER_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(file => file && fs.existsSync(file));

test('Explore prepares a bounded continuation without scrolling and cancels stale or constrained reads', { skip: !executablePath, timeout: 30000 }, async () => {
  const source = fs.readFileSync('app/explore/explore-client.tsx', 'utf8');
  const search = source.slice(source.indexOf('function SearchContinuationFeed('), source.indexOf('\nfunction QuickActions('));
  const bundle = await build({ stdin: { loader: 'tsx', resolveDir: process.cwd(), contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {ExploreAutoLoad} from './app/explore/explore-auto-load';
    import {SearchContinuationFeed} from 'search-fixture';
    window.calls=[];window.aborted=[];window.release=[];window.withRows??=true;
    const root=createRoot(document.getElementById('root'));
    window.session=(overrides={})=>root.render(<SearchContinuationFeed response={{query:'red',category:'Nails',location:'Chicago',filters:{color:'Red'},results:[],page:1,pageSize:4,hasMore:true,nextCursor:{after:1},sort:'relevance',...overrides}} coordinates={null} viewerId={overrides.viewerId??'alice'}/>);
    window.session();
  ` }, jsx: 'automatic', bundle: true, write: false, platform: 'browser', plugins: [{ name: 'fixture', setup(builder) {
    builder.onResolve({ filter: /^search-fixture$/ }, () => ({ path: 'search', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'tsx', resolveDir: process.cwd(), contents: `
      import React,{useState,useEffect,useRef,useCallback} from 'react';
      import {ExploreAutoLoad} from './app/explore/explore-auto-load';
      import {isExploreAheadCancellation,watchExploreAheadAvailability} from './lib/explore-ahead-buffer';
      import {readPriorityScheduler} from './lib/read-priority-scheduler';
      const useExperienceScope=()=>null,useExploreSearchMedia=({results})=>results;
      const exploreSearchOnwardLink=()=>({}),SalonLogoContent=()=>null,SalonCard=({salon})=><p>{salon.name}</p>,formatSalonLocation=()=>'';
      const isExplorePrimarySearchResult=()=>true,SearchRecommendationSections=()=>null,ExploreSearchOnwardActions=()=>null;
      const classifyExploreSearchError=()=> 'network',exploreSearchErrorMessage=()=> 'Offline';
      async function fetchExploreSearchPage(input,signal){
        const call={query:input.query,location:input.location,page:input.page};window.calls.push(call);
        if(window.hold){await new Promise(resolve=>{window.release.push(resolve);signal.addEventListener('abort',()=>{window.aborted.push(call);resolve();},{once:true});});}
        if(window.rejectOnce){window.rejectOnce=false;throw Error('Offline');}
        return {...input,results:window.withRows?[{id:input.query+input.page,name:input.query+' '+input.location}]:[],hasMore:true,nextCursor:{after:input.page}};
      }
      ${search}
      export {SearchContinuationFeed};
    ` }));
  } }] });
  const browser = await chromium.launch({ executablePath, headless: true });
  const errors = [];
  const origin = 'https://explore-buffer.test';
  const open = async init => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(5000);page.on('pageerror', error => errors.push(error.message));
    if (init) await page.addInitScript(init);
    await page.route(origin + '/**', route => route.fulfill({ contentType: route.request().url().endsWith('/bundle.js') ? 'text/javascript' : 'text/html', body: route.request().url().endsWith('/bundle.js') ? bundle.outputFiles[0].text : '<!doctype html><div style="height:1800px">Initial Explore results</div><div id="root"></div><div style="height:4000px"></div><script src="/bundle.js"></script>' }));
    await page.goto(origin);return page;
  };
  try {
    const page = await open();
    await page.waitForFunction(() => window.calls.length === 3 && !document.querySelector('[aria-live="polite"]').textContent.includes('Loading'));
    assert.equal(await page.evaluate(() => scrollY), 0, 'continuations prepare without a scroll');
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => window.calls.length), 3, 'new cursors do not refill the shared budget');
    assert.deepEqual(await page.evaluate(() => window.calls.map(call => call.page)), [2,3,4]);
    await page.evaluate(() => scrollTo(0,900));
    await page.waitForFunction(() => window.calls.length === 6);
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => window.calls.length), 6, 'forward scrolling grants only one further bounded window');

    const paused = await open(() => { window.hold=true; });
    await paused.waitForFunction(() => window.calls.length === 1);
    await paused.evaluate(() => { Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange')); });
    await paused.waitForFunction(() => window.aborted.length === 1);
    await paused.waitForTimeout(150);
    assert.equal(await paused.evaluate(() => window.calls.length), 1, 'hidden pages stop speculative continuation');
    await paused.evaluate(() => { window.hold=false;Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange')); });
    await paused.waitForFunction(() => window.calls.length === 3);

    for (const constraint of ['offline','saveData','2g']) {
      const constrained = await open(new Function(`if(${JSON.stringify(constraint)}==='offline')Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});else Object.defineProperty(navigator,'connection',{configurable:true,value:Object.assign(new EventTarget(),{saveData:${constraint === 'saveData'},effectiveType:${JSON.stringify(constraint === '2g' ? '2g' : '4g')}})});`));
      await constrained.waitForTimeout(150);
      assert.equal(await constrained.evaluate(() => window.calls.length), 0, constraint + ' yields the ahead buffer');
    }

    const switched = await open(() => { window.hold=true;window.withRows=true; });
    await switched.waitForFunction(() => window.calls.length === 1);
    await switched.evaluate(() => { window.hold=false;window.session({query:'blue',location:'Austin',viewerId:'bob',nextCursor:{after:20}}); });
    await switched.waitForFunction(() => window.aborted.length === 1 && window.calls.length >= 2);
    await switched.waitForTimeout(150);
    assert.equal(await switched.getByText('red Chicago',{exact:true}).count(), 0, 'late old account/query/area replies never render');
    assert.ok((await switched.evaluate(() => window.calls.slice(1))).every(call => call.query === 'blue' && call.location === 'Austin'));

    const failure = await open(() => { window.rejectOnce=true; });
    await failure.getByText('Offline',{exact:true}).waitFor();
    await failure.waitForTimeout(150);
    assert.equal(await failure.evaluate(() => window.calls.length), 1, 'a failure waits for an explicit retry');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('the real discovery feed cancels old cursors on account, query or area changes', { skip: !executablePath, timeout: 20000 }, async () => {
  const bundle = await build({ stdin: { loader: 'tsx', resolveDir: process.cwd(), contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {ExploreFeed} from './app/explore/explore-feed';
    const root=createRoot(document.getElementById('root'));window.calls=[];window.aborted=[];window.hold=true;
    const seed={items:[],nextCursor:'page-1',hasMore:true,error:null};
    window.session=(viewerId='alice',query='red',area='Chicago')=>root.render(<ExploreFeed initialPage={seed} discovery={{query,location:area}} sessionKey="shared" viewer={{userId:viewerId,isAuthenticated:true}} allowRestore={false}/>);
    window.session();
  ` }, jsx: 'automatic', bundle: true, write: false, platform: 'browser', plugins: [{ name: 'feed-fixtures', setup(builder) {
    builder.onResolve({ filter: /^(next\/|@\/(components|app)\/|@\/lib\/explore-feed-client)/ }, args => args.path === '@/app/explore/explore-auto-load' ? undefined : { path: args.path, namespace: 'fixture' });
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => {
      const contents = path.endsWith('explore-feed-client') ? `
        export const exploreFeedErrorMessage=()=> 'Offline';export const fetchExploreFeedPage=()=>{};
        export async function requestExploreFeed(body,signal){
          const call={query:body.discovery.query,area:body.discovery.location,cursor:body.cursor};window.calls.push(call);
          if(window.hold)await new Promise(resolve=>signal.addEventListener('abort',()=>{window.aborted.push(call);resolve();},{once:true}));
          const number=Number(body.cursor.split('-')[1]);return {items:[],hasMore:true,nextCursor:'page-'+(number+1)};
        }` : path === 'next/link' ? `export default function Link({children,prefetch,...props}){return <a {...props}>{children}</a>;}` : `
        const Empty=()=>null;export default Empty;export const useExperienceScope=()=>null,usePostCaption=(target,caption)=>caption;
        export {Empty as NailIllustrationCredit,Empty as FeedLoadingSkeleton,Empty as PostIdentity,Empty as PostActions,Empty as useHiddenPosts,Empty as postIdentity,Empty as PostCommentThread,Empty as SavePostButton,Empty as BeforeAfterCompare,Empty as InspirationAvailability,Empty as ExploreBookButton,Empty as ExploreSalonLove,Empty as ExploreAdSlot,Empty as SalonTrustLine,Empty as SalonVerifiedBadge,Empty as ReylumiIcon,Empty as useRouter,Empty as ExploreSalonFollow,Empty as ExploreSalonMenu,Empty as ExploreSocialActions,Empty as useSalonSocial};`;
      return { contents, loader: 'tsx', resolveDir: process.cwd() };
    });
  } }] });
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(5000);
    await page.route('https://explore-feed-buffer.test/**', route => route.fulfill({ contentType: route.request().url().endsWith('/bundle.js') ? 'text/javascript' : 'text/html', body: route.request().url().endsWith('/bundle.js') ? bundle.outputFiles[0].text : '<!doctype html><div style="height:1800px">Initial content</div><div id="root"></div><script src="/bundle.js"></script>' }));
    await page.goto('https://explore-feed-buffer.test');
    await page.waitForFunction(()=>window.calls.length===1);
    await page.evaluate(()=>window.session('alice','blue','Chicago'));
    await page.waitForFunction(()=>window.aborted.length===1&&window.calls.length===2);
    await page.evaluate(()=>window.session('alice','blue','Austin'));
    await page.waitForFunction(()=>window.aborted.length===2&&window.calls.length===3);
    await page.evaluate(()=>{window.hold=false;window.session('bob','blue','Austin');});
    await page.waitForFunction(()=>window.aborted.length===3&&window.calls.length===6);
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(()=>window.calls.length),6,'the final account receives only three automatic continuations');
    assert.ok((await page.evaluate(()=>window.calls.slice(3))).every(call=>call.query==='blue'&&call.area==='Austin'));
    assert.equal(await page.getByRole('button',{name:'Retry',exact:true}).count(),0,'cancellation does not present a network error');
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
});
