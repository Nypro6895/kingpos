import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium, webkit, devices } from 'playwright-core';

test('search keeps keystrokes, spaces, selection and IME while live results update on desktop and iPhone WebKit', { timeout: 60000 }, async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React,{useState} from 'react';import{createRoot}from'react-dom/client';
      import{ExploreSearchToolbar}from'./app/explore/explore-search-toolbar';
      window.searches=[];window.drafts=0;
      function App(){
        const[query,setQuery]=useState(''),[pending,setPending]=useState(false),[areaOpen,setAreaOpen]=useState(false);
        window.externalQuery=setQuery;
        const search=value=>{window.searches.push(value);setQuery(value);setPending(true);setTimeout(()=>setPending(false),150)};
        return <ExploreSearchToolbar query={query} category="All" location="" locationSource="none" scopePolicy="expandable"
          locating={false} pending={pending} message={null} areaOpen={areaOpen} onAreaOpenChange={setAreaOpen}
          onSearch={search} onDraftChange={()=>window.drafts++} onSuggestionSelect={option=>setQuery(option.query)}
          onAreaApply={()=>{}} onCurrentLocation={()=>{}}/>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', alias: { '@': process.cwd() },
    plugins: [{ name: 'typing-fixture', setup(builder) {
      builder.onResolve({ filter: /^@\/components\/workspace-language$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'tsx', contents: 'export const WorkspaceText=({text})=>text;' }));
    } }],
  });
  const server = createServer((req, res) => {
    if (req.url.startsWith('/api/explore/suggestions')) { res.setHeader('Content-Type', 'application/json'); res.end('{"suggestions":[]}'); return; }
    res.setHeader('Content-Type', req.url === '/bundle.js' ? 'application/javascript' : 'text/html');
    res.end(req.url === '/bundle.js' ? bundle.outputFiles[0].text : '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><header data-explore-header-search></header><div id="root"></div><script src="/bundle.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    for (const [name, engine, options] of [
      ['desktop', chromium, { viewport: { width: 1440, height: 1000 } }],
      ['iPhone WebKit', webkit, devices['iPhone 13']],
    ]) {
      const browser = await engine.launch({ headless: true, ...(engine === chromium ? { channel: 'chrome' } : {}) });
      try {
        const page = await browser.newPage(options), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'load' });
        const input = page.locator('#explore-search-query');
        await input.pressSequentially('nail ', { delay: 50 });
        assert.equal(await input.inputValue(), 'nail ', `${name}: every keystroke reaches the draft`);
        await page.waitForFunction(() => window.searches.length === 1);
        assert.equal(await input.inputValue(), 'nail ', `${name}: live query trimming cannot erase the trailing space`);
        await input.pressSequentially('art', { delay: 50 });
        assert.equal(await input.inputValue(), 'nail art', `${name}: a pause between words preserves the separator`);
        await page.waitForFunction(() => window.searches.at(-1) === 'nail art');
        await input.evaluate(el => el.setSelectionRange(2, 6));
        await page.waitForTimeout(200);
        assert.deepEqual(await input.evaluate(el => [el.selectionStart, el.selectionEnd, el === document.activeElement]), [2, 6, true]);
        await input.fill('');
        await input.dispatchEvent('compositionstart');
        await input.fill('tóc');
        const beforeComposition = await page.evaluate(() => window.searches.length);
        await page.waitForTimeout(600);
        assert.equal(await input.inputValue(), 'tóc');
        assert.equal(await page.evaluate(() => window.searches.length), beforeComposition, `${name}: IME does not submit an unfinished word`);
        await input.dispatchEvent('compositionend', { data: 'tóc' });
        await page.waitForFunction(() => window.searches.at(-1) === 'tóc');
        assert.equal(await input.inputValue(), 'tóc');
        await input.fill('red ombre ');
        await page.waitForFunction(() => window.searches.at(-1) === 'red ombre');
        await input.evaluate(el => el.setSelectionRange(2, 5));
        await page.setViewportSize(name === 'desktop' ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
        await page.waitForFunction(desktop => !!document.querySelector('[data-explore-header-search] input') === desktop, name !== 'desktop');
        assert.deepEqual(await input.evaluate(el => [el.value, el.selectionStart, el.selectionEnd, el === document.activeElement]), ['red ombre ', 2, 5, true], `${name}: moving the toolbar retains the current draft and caret`);
        await page.evaluate(() => window.externalQuery('haircuts'));
        await page.waitForFunction(() => document.querySelector('#explore-search-query').value === 'haircuts');
        assert.deepEqual(errors, []);
      } finally { await browser.close(); }
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});
