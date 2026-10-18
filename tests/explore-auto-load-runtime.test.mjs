import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const executablePath = [process.env.TEST_BROWSER_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(file => file && fs.existsSync(file));

test('Explore automatically advances short pages, retains the search and pauses on errors', { skip: !executablePath, timeout: 30000 }, async () => {
  const client = fs.readFileSync('app/explore/explore-client.tsx', 'utf8');
  const searchComponent = client.slice(client.indexOf('function SearchContinuationFeed('), client.indexOf('\nfunction QuickActions('));
  const recommendationComponent = client.slice(client.indexOf('function SearchRecommendationSections('), client.indexOf('\nfunction SearchRefinementBar('));
  const bundle = await build({ stdin: { loader: 'tsx', resolveDir: process.cwd(), contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {ExploreFeed} from './app/explore/explore-feed';
    import {SearchContinuationFeed} from 'search-fixture';
    window.calls=[];
    const discovery={query:'Red nail',displayQuery:'Red nail',contentQuery:'red almond',queryKind:'style',locationPriority:true,locationOrigin:'manual',intent:'search',category:'Nails',location:'Milwaukee, WI',strictLocation:true,filters:{color:'Red',shape:'Almond'}};
    const search=new URLSearchParams(location.search).has('salons');
    const results=new URLSearchParams(location.search).has('duplicates')?[{id:'initial',name:'Already visible'}]:[];
    createRoot(document.getElementById('root')).render(search ?
      <SearchContinuationFeed response={{...discovery,results,page:1,pageSize:12,hasMore:true,nextCursor:{after:1},sort:'relevance'}} coordinates={null}/> :
      <ExploreFeed initialPage={{items:[],nextCursor:'page-1',hasMore:true,error:null}} discovery={discovery} viewer={{userId:null,isAuthenticated:false}} allowRestore={false}/>);
  ` }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', plugins: [{ name: 'fixtures', setup(builder) {
    builder.onResolve({ filter: /^(search-fixture|next\/|@\/(components|app)\/|@\/lib\/explore-(feed-client|search-client))/ }, args => args.path === '@/app/explore/explore-auto-load' ? undefined : { path: args.path, namespace: 'fixture' });
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: name }) => {
      let contents;
      if (name === 'search-fixture') contents = `
        import React,{useState,useRef,useEffect,useCallback} from 'react';
        import {ExploreAutoLoad} from './app/explore/explore-auto-load';
        import {fetchExploreSearchPage} from '@/lib/explore-search-client';
        import {exploreSearchOnwardLink,groupExploreSearchRecommendations,isExplorePrimarySearchResult} from './lib/explore-search-recommendations';
        import {ExploreSearchOnwardActions,ExploreSearchRecommendations} from './app/explore/explore-search-recommendations';
        const SalonLogoContent=()=>null, SalonCard=({salon})=><article data-salon-id={salon.id}><a href={'/explore/salons/'+salon.id}>{salon.name}</a></article>, formatSalonLocation=()=>'';
        const ResultSection=()=>null;
        const useExploreSearchMedia=({results})=>results;
        const classifyExploreSearchError=()=> 'network', exploreSearchErrorMessage=()=> 'Offline';
        ${recommendationComponent}
        ${searchComponent}
        export {SearchContinuationFeed};`;
      else if (name === 'next/link') contents = `export default function Link({children,prefetch,...props}){return <a {...props}>{children}</a>}`;
      else if (name.endsWith('explore-feed-client')) contents = `
        export const exploreFeedErrorMessage=()=> 'Offline'; export const requestExploreFeed=body=>fetchExploreFeedPage(body.cursor,body.discovery);
        export async function fetchExploreFeedPage(cursor,discovery,signal){
          window.calls.push({cursor,discovery});
          if(window.failOnce){window.failOnce=false;throw Error('Offline')}
          if(window.holdPage){window.holdPage=false;await new Promise(resolve=>window.releasePage=resolve)}
          const page=Number(cursor.split('-')[1]);
          return {items:[],error:null,hasMore:page<3,nextCursor:page<3?'page-'+(page+1):null};
        }`;
      else if (name.endsWith('explore-search-client')) contents = `
        export async function fetchExploreSearchPage(input,signal){
          window.calls.push(input);
          const rows={2:[{id:'initial',name:'Already visible'},{id:'match',name:'Same salon name',resultGroup:'best_match'}],3:[{id:'match',name:'Same salon name',resultGroup:'best_match'},{id:'reference-one',name:'Same salon name',resultGroup:'reference',isReferenceMatch:true}],4:[{id:'reference-one',name:'Same salon name',resultGroup:'reference',isReferenceMatch:true},{id:'reference-two',name:'Other salon',resultGroup:'reference',isReferenceMatch:true}]};
          const results=new URLSearchParams(location.search).has('duplicates')?rows[input.page]:[];
          return {...input,results,error:null,hasMore:input.page<4,nextCursor:input.page<4?{after:input.page}:null};
        }`;
      else contents = `const Empty=()=>null; export default Empty; export const usePostCaption=(target,caption)=>caption; export {Empty as NailIllustrationCredit, Empty as FeedLoadingSkeleton, Empty as PostIdentity, Empty as PostActions, Empty as useHiddenPosts, Empty as postIdentity, Empty as PostCommentThread, Empty as SavePostButton, Empty as BeforeAfterCompare, Empty as InspirationAvailability, Empty as ExploreBookButton, Empty as ExploreSalonLove, Empty as OwnerSponsoredPost, Empty as ExploreAdSlot, Empty as SalonTrustLine, Empty as SalonVerifiedBadge, Empty as ReylumiIcon, Empty as useRouter, Empty as ExploreSalonFollow, Empty as ExploreSalonMenu, Empty as ExploreSocialActions, Empty as useSalonSocial};`;
      return { contents, loader: 'tsx', resolveDir: process.cwd() };
    });
  } }] });
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-proxy-server'] });
  const errors = [];
  const scrollAndSettle = page => page.evaluate(async () => {
    for (let i = 0; i < 20; i++) document.dispatchEvent(new Event('scroll'));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  try {
    const origin = 'https://explore-autoload.test';
    const newPage = async options => {
      const page = await browser.newPage(options);
      await page.route(origin + '/**', route => {
        const script = new URL(route.request().url()).pathname === '/bundle.js';
        return route.fulfill({ contentType: script ? 'text/javascript' : 'text/html', body: script ? bundle.outputFiles[0].text : '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>' });
      });
      return page;
    };
    const page = await newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(5000);
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => { window.holdPage = true; window.IntersectionObserver = undefined; });
    await page.goto(origin);
    await page.waitForFunction(() => typeof window.releasePage === 'function', null, { timeout: 5000 }).catch(error => { assert.deepEqual(errors, [], 'The merged Explore fixture must mount without runtime errors'); throw error; });
    await scrollAndSettle(page);
    assert.equal(await page.evaluate(() => window.calls.length), 1, 'only one request while a page is in flight');
    await page.evaluate(() => window.releasePage());
    await page.waitForFunction(() => window.calls.length === 3 && document.querySelector('[data-testid="explore-continuous-feed"]').getAttribute('aria-busy') === 'false');
    const calls = await page.evaluate(() => window.calls);
    assert.deepEqual(calls.map(call => call.cursor), ['page-1', 'page-2', 'page-3']);
    assert.ok(calls.every(call => call.discovery.query === 'Red nail' && call.discovery.location === 'Milwaukee, WI' && call.discovery.strictLocation));
    await scrollAndSettle(page);
    assert.equal(await page.evaluate(() => window.calls.length), 3, 'exhausted pages do not restart');

    const retry = await newPage();
    retry.setDefaultTimeout(5000);
    retry.on('pageerror', error => errors.push(error.message));
    await retry.addInitScript(() => { window.failOnce = true; });
    await retry.goto(origin);
    await retry.getByRole('button', { name: 'Retry', exact: true }).waitFor();
    await scrollAndSettle(retry);
    assert.equal(await retry.evaluate(() => window.calls.length), 1, 'a network failure does not cause an automatic request loop');
    await retry.getByRole('button', { name: 'Retry', exact: true }).click();
    await retry.waitForFunction(() => window.calls.length === 4 && document.querySelector('[data-testid="explore-continuous-feed"]').getAttribute('aria-busy') === 'false');
    assert.deepEqual(await retry.evaluate(() => window.calls.map(call => call.cursor)), ['page-1', 'page-1', 'page-2', 'page-3']);

    const salons = await newPage({ viewport: { width: 390, height: 844 } });
    salons.setDefaultTimeout(5000);
    salons.on('pageerror', error => errors.push(error.message));
    await salons.goto(origin + '?salons');
    await salons.waitForFunction(() => window.calls.length === 3 && document.querySelector('[aria-live="polite"]').textContent.includes("You've explored these salons."));
    const searchCalls = await salons.evaluate(() => window.calls);
    assert.deepEqual(searchCalls.map(call => call.cursor.after), [1, 2, 3]);
    assert.ok(searchCalls.every(call => call.query === 'Red nail' && call.category === 'Nails' && call.location === 'Milwaukee, WI' && call.target === 'salons'));
    assert.ok(searchCalls.every(call => call.filters.color === 'Red' && call.filters.shape === 'Almond'), 'continuations preserve committed facets');
    assert.ok(searchCalls.every(call => call.displayQuery === 'Red nail' && call.contentQuery === 'red almond' && call.queryKind === 'style' && call.locationPriority === true && call.locationOrigin === 'manual' && call.intent === 'search'), 'every page carries the frozen canonical query metadata required by the session cursor');

    const duplicatePage = await newPage({ viewport: { width: 390, height: 844 } });
    duplicatePage.on('pageerror', error => errors.push(error.message));
    await duplicatePage.goto(origin + '?salons&duplicates');
    await duplicatePage.getByText("You've explored these salons.", { exact: true }).waitFor();
    assert.deepEqual(await duplicatePage.locator('[data-salon-id]').evaluateAll(nodes => nodes.map(node => node.dataset.salonId)), ['match', 'reference-one', 'reference-two'], 'salon IDs remain unique across the first page and every continuation, while same names are retained');
    assert.equal(await duplicatePage.getByRole('heading', { name: 'Suggestions', exact: true }).count(), 1, 'one simple suggestions heading covers every continuation page');
    assert.equal(await duplicatePage.getByText(/may not match your search|outside Milwaukee|suggested examples/).count(), 0, 'recommendations do not explain ranking rules to customers');
    await duplicatePage.getByRole('link',{name:'Browse nail salons',exact:true}).waitFor();
    assert.deepEqual(errors, []);
  } catch (error) { throw new Error(JSON.stringify({ errors, pages: await Promise.allSettled(browser.contexts().flatMap(context => context.pages()).map(page => page.evaluate(() => ({body: document.body.innerHTML, calls: window.calls})))) }), { cause: error }); }
  finally { await browser.close(); }
});
