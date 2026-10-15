import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const executablePath = [process.env.TEST_BROWSER_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(file => file && fs.existsSync(file));

test('Explore automatically advances short pages, retains the search and pauses on errors', { skip: !executablePath, timeout: 30000 }, async () => {
  const client = fs.readFileSync('app/explore/explore-client.tsx', 'utf8');
  const searchComponent = client.slice(client.indexOf('function SearchContinuationFeed('), client.indexOf('\nfunction QuickActions('));
  const bundle = await build({ stdin: { loader: 'tsx', resolveDir: process.cwd(), contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {ExploreFeed} from './app/explore/explore-feed';
    import {SearchContinuationFeed} from 'search-fixture';
    window.calls=[];
    const discovery={query:'Red nail',category:'Nails',location:'Milwaukee, WI',strictLocation:true};
    const search=new URLSearchParams(location.search).has('salons');
    createRoot(document.getElementById('root')).render(search ?
      <SearchContinuationFeed response={{...discovery,results:[],page:1,pageSize:12,hasMore:true,nextCursor:{after:1},sort:'relevance'}} coordinates={null} continuation={()=><div data-testid="related-continuation"/>}/> :
      <ExploreFeed initialPage={{items:[],nextCursor:'page-1',hasMore:true,error:null}} discovery={discovery} viewer={{userId:null,isAuthenticated:false}} allowRestore={false}/>);
  ` }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', plugins: [{ name: 'fixtures', setup(builder) {
    builder.onResolve({ filter: /^(search-fixture|next\/|@\/(components|app)\/|@\/lib\/explore-(feed-client|search-client))/ }, args => args.path === '@/app/explore/explore-auto-load' ? undefined : { path: args.path, namespace: 'fixture' });
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: name }) => {
      let contents;
      if (name === 'search-fixture') contents = `
        import React,{useState,useRef,useEffect,useCallback} from 'react';
        import {ExploreAutoLoad} from './app/explore/explore-auto-load';
        import {fetchExploreSearchPage} from '@/lib/explore-search-client';
        const SalonLogoContent=()=>null, SalonCard=()=>null, formatSalonLocation=()=>'';
        const classifyExploreSearchError=()=> 'network', exploreSearchErrorMessage=()=> 'Offline';
        ${searchComponent}
        export {SearchContinuationFeed};`;
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
          return {...input,results:[],error:null,hasMore:input.page<4,nextCursor:input.page<4?{after:input.page}:null};
        }`;
      else contents = `const Empty=()=>null; export default Empty; export {Empty as NailIllustrationCredit, Empty as ExploreSalonFollow, Empty as ExploreSalonMenu, Empty as ExploreSocialActions, Empty as useSalonSocial, Empty as FeedLoadingSkeleton, Empty as PostIdentity, Empty as PostActions, Empty as useHiddenPosts, Empty as postIdentity, Empty as PostCommentThread, Empty as SavePostButton, Empty as BeforeAfterCompare, Empty as InspirationAvailability, Empty as ExploreBookButton, Empty as ExploreSalonLove, Empty as OwnerSponsoredPost, Empty as ExploreAdSlot, Empty as SalonTrustLine, Empty as SalonVerifiedBadge, Empty as ReylumiIcon, Empty as useRouter};`;
      return { contents, loader: 'tsx', resolveDir: process.cwd() };
    });
  } }] });
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/bundle.js' ? 'text/javascript' : 'text/html');
    res.end(req.url === '/bundle.js' ? bundle.outputFiles[0].text : '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-proxy-server'] });
  const errors = [];
  const scrollAndSettle = page => page.evaluate(async () => {
    for (let i = 0; i < 20; i++) document.dispatchEvent(new Event('scroll'));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(5000);
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => { window.holdPage = true; window.IntersectionObserver = undefined; });
    await page.goto(origin);
    await page.waitForFunction(() => typeof window.releasePage === 'function');
    await scrollAndSettle(page);
    assert.equal(await page.evaluate(() => window.calls.length), 1, 'only one request while a page is in flight');
    await page.evaluate(() => window.releasePage());
    await page.waitForFunction(() => window.calls.length === 3 && document.querySelector('[data-testid="explore-continuous-feed"]').getAttribute('aria-busy') === 'false');
    const calls = await page.evaluate(() => window.calls);
    assert.deepEqual(calls.map(call => call.cursor), ['page-1', 'page-2', 'page-3']);
    assert.ok(calls.every(call => call.discovery.query === 'Red nail' && call.discovery.location === 'Milwaukee, WI' && call.discovery.strictLocation));
    await scrollAndSettle(page);
    assert.equal(await page.evaluate(() => window.calls.length), 3, 'exhausted pages do not restart');

    const retry = await browser.newPage();
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

    const salons = await browser.newPage({ viewport: { width: 390, height: 844 } });
    salons.setDefaultTimeout(5000);
    salons.on('pageerror', error => errors.push(error.message));
    await salons.goto(origin + '?salons');
    await salons.waitForFunction(() => window.calls.length === 3 && document.querySelector('[data-testid="related-continuation"]'));
    const searchCalls = await salons.evaluate(() => window.calls);
    assert.deepEqual(searchCalls.map(call => call.cursor.after), [1, 2, 3]);
    assert.ok(searchCalls.every(call => call.query === 'Red nail' && call.category === 'Nails' && call.location === 'Milwaukee, WI' && call.target === 'salons'));
    assert.deepEqual(errors, []);
  } catch (error) { throw new Error(JSON.stringify({ errors, pages: await Promise.all(browser.contexts().flatMap(context => context.pages()).map(page => page.evaluate(() => ({body: document.body.innerHTML, calls: window.calls})))) }), { cause: error }); }
  finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
