import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright-core';

test('Salon Profile loads only missing pages, survives remount and network failure, and fences account changes', { timeout: 60_000 }, async () => {
  const bundle = await build({ banner: { js: 'window.auditClock=100000;Date.now=()=>window.auditClock;window.advance=ms=>window.auditClock+=ms;' }, stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React,{useState,useEffect}from'react';import{createRoot}from'react-dom/client';
    import{useSalonProfilePages}from'./lib/use-salon-profile-pages';
    import{experienceResourceCache}from'./lib/experience-resource-cache';
    window.scope='owner-one';window.calls=[];window.pending=[];
    window.fetch=(url,options)=>new Promise((resolve,reject)=>{
      window.calls.push(String(url));window.pending.push({resolve,reject,signal:options.signal});
    });
    const first={profile:{salonId:'salon'},feed:[{id:'first',contentType:'look',title:'Current first'}],looks:[],updates:[],contentPage:{nextPage:1}};
    function Probe({initial}){
      const resource=useSalonProfilePages(initial);window.more=resource.loadMore;
      return <><div data-posts>{resource.data.feed.map(item=><p key={item.id}>{item.id}:{item.title}</p>)}</div>
        <p data-error>{resource.error}</p><button disabled={resource.loading} onClick={()=>resource.loadMore()}>More</button></>;
    }
    function App(){const[visible,show]=useState(true);const[identity,change]=useState(window.scope);const[initial,setInitial]=useState(first);
      useEffect(()=>{window.ready=true;window.show=show;window.switch=()=>{experienceResourceCache.suspend();window.scope='owner-two';change(window.scope);experienceResourceCache.resume()};window.changeHead=()=>setInitial({...first,feed:[{id:'new',contentType:'look',title:'New first'}]})},[]);
      return visible?<Probe key={identity} initial={initial}/>:<p>Another page</p>;
    }createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', alias: { '@': process.cwd() }, plugins: [{ name: 'scope', setup(b) {
    b.onResolve({filter:/.*components[\\/]experience-scope$/},args=>({path:args.path,namespace:'scope'}));
    b.onLoad({filter:/.*/,namespace:'scope'},()=>({contents:"export const useExperienceScope=()=>({context:{scope:window.scope}})",loader:'js'}));
  } }] });
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/bundle.js' ? 'application/javascript' : 'text/html');
    response.end(request.url === '/bundle.js' ? bundle.outputFiles[0].text : '<div id="root"></div><script src="/bundle.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = process.env.TEST_BROWSER_ENGINE === 'webkit' ? await webkit.launch({ headless: true })
    : await chromium.launch({ channel: process.env.TEST_BROWSER_PATH ? undefined : 'chrome', executablePath: process.env.TEST_BROWSER_PATH, headless: true, args: ['--no-proxy-server'] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.ready);
    await page.evaluate(() => { void window.more(); void window.more(); });
    await page.waitForFunction(() => window.calls.length === 1);
    assert.match(await page.evaluate(() => window.calls[0]), /page=1/);
    await page.evaluate(() => window.pending[0].resolve(new Response(JSON.stringify({looks:[],updates:[],feed:[{id:'first',contentType:'look',title:'Old duplicate'},{id:'second',contentType:'look',title:'Second'}],contentPage:{nextPage:2}}),{headers:{'Content-Type':'application/json',ETag:'"page-one"'}})));
    await page.getByText('second:Second', { exact: true }).waitFor();
    assert.equal(await page.getByText('first:Current first', { exact: true }).count(), 1);
    await page.evaluate(() => { window.advance(29000); window.show(false); }); await page.getByText('Another page').waitFor();
    await page.evaluate(() => window.show(true)); await page.getByText('second:Second', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.calls.length), 1, 'fresh loaded pages survive eviction/remount without another pull');
    await page.evaluate(() => { window.advance(2000); window.show(false); }); await page.getByText('Another page').waitFor();
    await page.evaluate(() => window.show(true));
    await page.waitForFunction(() => window.calls.length === 2);
    assert.match(await page.evaluate(() => window.calls[1]), /page=1/);
    await page.evaluate(() => window.pending[1].resolve(new Response(null,{status:304})));
    await page.getByText('second:Second', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.calls.length), 2, 'showing cached content must not renew its freshness without validation');
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.waitForFunction(() => window.calls.length === 3);
    await page.evaluate(() => window.pending[2].resolve(new Response(null,{status:503})));
    await page.locator('[data-error]').filter({ hasText: 'could not load' }).waitFor();
    assert.equal(await page.getByText('second:Second', { exact: true }).count(), 1, 'weak network keeps loaded content');
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.waitForFunction(() => window.calls.length === 4);
    assert.match(await page.evaluate(() => window.calls[3]), /page=2/);
    await page.evaluate(() => window.switch());
    await page.waitForFunction(() => window.pending[3].signal.aborted);
    await page.evaluate(() => window.pending[3].resolve(new Response(JSON.stringify({looks:[],updates:[],feed:[{id:'late',contentType:'look',title:'Old account'}],contentPage:{nextPage:null}}),{headers:{'Content-Type':'application/json'}})));
    assert.equal(await page.getByText('late:Old account', { exact: true }).count(), 0);
    assert.equal(await page.getByText('second:Second', { exact: true }).count(), 0, 'new scope cannot restore another account tail');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
