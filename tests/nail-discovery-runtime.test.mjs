import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

const executablePath = [process.env.TEST_BROWSER_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(file => file && fs.existsSync(file));

test('discovery keeps stable salon-linked suggestions, excludes real photos and dedupes IDs while loading', { skip: !executablePath, timeout: 90000 }, async () => {
  const bundle = await build({ stdin: { loader: 'tsx', resolveDir: process.cwd(), contents: `
    import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
    import {ExploreDiscoveryFeed} from './app/explore/explore-discovery-feed';
    import {NAIL_LOOKS} from './lib/nail-inspiration-catalog';
    window.catalog = NAIL_LOOKS; window.favoriteBatches = []; window.salonCalls = 0; window.savedKey = 'look:nail-clean-soap-round';
    document.body.dataset.reylumiShellReady = 'true';
    window.finishFirstPaint = () => { document.querySelector('main').dataset.exploreFirstContentReady = 'true'; window.dispatchEvent(new Event('reylumi:first-content-ready')); };
    function App() {
      const [viewer, setViewer] = useState('alice'); window.switchViewer = setViewer;
      const [query, setQuery] = useState(''); window.searchIdeas = setQuery;
      return <main style={{maxWidth:960,margin:'32px auto',padding:16}}><h1 style={{fontSize:24,fontWeight:600,marginBottom:16}}>More to discover</h1>
        <ExploreDiscoveryFeed key={query} sessionKey={'test:'+query} discovery={{query,category:'Nails',location:'Milwaukee, WI'}} viewer={{userId:viewer,isAuthenticated:!!viewer}} />
      </main>;
    }
    createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', plugins: [{ name: 'fixtures', setup(builder) {
    builder.onResolve({ filter: /^(next\/(image|link)|@\/components\/explore-account-actions|@\/app\/explore\/(account-actions|explore-feed)|@\/lib\/explore-(search-client|feed-client))$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: name }) => {
      let contents;
      if (name === 'next/image') contents = `import React from 'react';export default function Image({fill,sizes,...props}){return <img {...props} style={fill?{position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'cover'}:undefined}/>}`;
      else if (name === 'next/link') contents = `import React from 'react';export default function Link({prefetch,...props}){return <a {...props}/>}`;
      else if (name.endsWith('explore-account-actions')) contents = `import React from 'react';export function ExploreBookButton(){return <button>Book</button>};export function ExploreReferenceLove({itemKey}){return <button aria-label="Save look" onClick={()=>window.dispatchEvent(new CustomEvent('reylumi:reference-favorite',{detail:{key:itemKey,active:true}}))}>♡</button>}`;
      else if (name.endsWith('account-actions')) contents = `export async function referenceLoveStatesAction(keys){window.favoriteBatches.push(keys);if(keys.length>40)throw Error('Oversized favorite batch');if(window.failFavorites)throw Error('Offline');return {keys:keys.filter(key=>key===window.savedKey),error:null}}`;
      else if (name.endsWith('explore-feed')) contents = `import React from 'react';export function ExploreFeed({supplementaryPosts,supplementaryFooter}){return <div style={{maxWidth:640,margin:'auto'}}>{supplementaryPosts}{supplementaryFooter}</div>};export function ExploreFeedSkeleton(){return <p>Loading</p>}`;
      else if (name.endsWith('explore-feed-client')) contents = `export const fetchExploreFeedPage=async()=>{if(window.holdFeed)await new Promise(resolve=>window.releaseFeed=resolve);return {sessionCursor:'test',items:[],hasMore:false,error:null}};export const requestExploreFeed=fetchExploreFeedPage;export const exploreFeedErrorMessage=()=> 'Unavailable';`;
      else contents = `export const fetchExploreSearchPage=async input=>{window.salonCalls++;window.lastSalonInput=input;return {error:null,results:[...Array.from({length:8},(_,index)=>({id:'10000000-0000-4000-8000-'+String(index+1).padStart(12,'0'),name:'Local Nails',city:'Milwaukee',state:'WI',phone:'4145550100',bookingEnabled:false,serviceCategories:['Nails'],serviceNames:[],coverImageUrl:index===7?'/real-salon-photo.webp':null})),{id:'10000000-0000-4000-8000-000000000001',name:'Local Nails',serviceCategories:['Nails'],serviceNames:[]}]}};`;
      return { contents, loader: 'tsx', resolveDir: process.cwd() };
    });
  } }] });
  const css = (await postcss([tailwind()]).process(fs.readFileSync('app/globals.css', 'utf8').replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source "./explore/nail-inspiration.tsx";\n@source "./explore/explore-discovery-feed.tsx";'), { from: path.resolve('app/globals.css') })).css;
  const server = createServer((req, res) => {
    if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); }
    else if (req.url === '/style.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); }
    else if (/^\/inspiration\/nails\/[a-z0-9-]+\.webp$/.test(req.url)) { res.setHeader('Content-Type', 'image/webp'); res.end(fs.readFileSync(`public${req.url}`)); }
    else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-proxy-server'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForTimeout(100);
    assert.deepEqual(await page.evaluate(() => window.favoriteBatches), [], 'optional favorite lookup waits for the first content paint');
    assert.equal(await page.evaluate(() => window.salonCalls), 0, 'secondary salon batch waits for the first content paint');
    await page.evaluate(() => window.finishFirstPaint());
    const cards = page.getByTestId('nail-inspiration-post');
    await cards.first().waitFor();
    assert.equal(await cards.count(), 6);
    assert.equal(await page.evaluate(()=>window.lastSalonInput.sort),'closest');
    assert.equal(await page.evaluate(()=>window.lastSalonInput.query),'');
    assert.match(await cards.first().getByRole('link').filter({hasText:'Local Nails'}).getAttribute('href'),/^\/explore\/salons\/10000000-0000-4000-8000-/);
    assert.equal(await cards.first().getByRole('button',{name:'Book',exact:true}).count(),1);
    assert.match(await cards.first().innerText(),/Local Nails/);
    assert.match(await cards.first().innerText(),/Not a photo of this salon’s work/);
    const snapshot = () => cards.evaluateAll(nodes => nodes.map(node => ({salon:node.dataset.salonId,look:node.dataset.nailLook})));
    const first = await snapshot();
    assert.equal(new Set(first.map(item=>item.salon)).size,6);
    assert.equal(await cards.first().getByRole('link',{name:'View Local Nails',exact:true}).getAttribute('href'),'/explore/salons/'+first[0].salon);
    assert.equal(await page.getByRole('combobox').count(),0);
    await page.getByTestId('nail-inspiration-load-more').scrollIntoViewIfNeeded();
    await page.waitForFunction(()=>document.querySelectorAll('[data-nail-look]').length===7);
    const all=await snapshot();
    assert.equal(new Set(all.map(item=>item.salon)).size,7,'one suggestion per salon identity');
    assert.ok(!all.some(item=>item.salon.endsWith('000000000008')),'real salon cover replaces its suggestion without a claim check');
    assert.equal(await page.getByTestId('nail-inspiration-load-more').count(),0,'stop at available salons, not catalog size');
    const bySalon=new Map(all.map(item=>[item.salon,item.look]));
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('reylumi:reference-favorite',{detail:{key:'look:nail-cherry-stiletto',active:true}})));
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
    for(const item of await snapshot())assert.equal(item.look,bySalon.get(item.salon),'taste may reorder but cannot relabel a salon with a different image');
    const batches=await page.evaluate(()=>window.favoriteBatches);
    assert.ok(batches.every(keys=>keys.length<=40));
    assert.equal(new Set(batches.flat()).size,await page.evaluate(()=>window.catalog.length));
    await page.setViewportSize({width:390,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    // The shipped staged discovery feed has no separate refinement panel;
    // structured refinements belong to the unified search result controls.
    assert.equal(await page.getByText('Refine looks',{exact:true}).count(),0);
    assert.ok(await cards.count()>0);
    for(const item of await snapshot())assert.equal(item.look,bySalon.get(item.salon),'mobile layout preserves the original salon/image association');
    if(process.env.NAIL_DISCOVERY_SCREENSHOTS){fs.mkdirSync(process.env.NAIL_DISCOVERY_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.NAIL_DISCOVERY_SCREENSHOTS,'mobile.png')});}
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
