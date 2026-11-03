import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import ts from 'typescript';

const browserPath = [process.env.TEST_BROWSER_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(existsSync);
const options = {skip: !browserPath, timeout: 30_000};
let browser, server, base;

before(async () => {
  if (!browserPath) return;
  const clientPath = process.cwd().replaceAll('\\', '/') + '/app/beauty/beauty-profile-client.tsx';
  const original = readFileSync(clientPath, 'utf8');
  const ast = ts.createSourceFile(clientPath, original, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'BeautyProfileClient');
  const returned = component.body.statements.findLast(node => ts.isReturnStatement(node));
  // Run the original component's hooks and event callbacks, projecting only
  // its final view so fixture posts do not need unrelated media/card models.
  const expose = 'window.qa={loadMorePosts,publishPost,setCaption,state:{posts:posts.map(post=>post.id),cursor,hasMore,loadingMore,caption,composerError,timelineError}};';
  const instrumented = original.slice(0, returned.getStart(ast)) + expose + 'return <output id="mounted">ready</output>;' + original.slice(returned.end);
  const modules = new Map();
  for (const node of ast.statements) {
    if (!ts.isImportDeclaration(node) || !node.importClause || node.importClause.isTypeOnly) continue;
    const path = node.moduleSpecifier.text;
    if (path === 'react' || path === 'react-dom') continue;
    const bindings = node.importClause.namedBindings;
    const names = bindings && ts.isNamedImports(bindings) ? bindings.elements.filter(item => !item.isTypeOnly).map(item => item.propertyName?.text ?? item.name.text) : [];
    let code = "import React from 'react';\n";
    if (node.importClause.name) code += 'export default function Stub(){return null;}\n';
    for (const name of names) {
      if (name === 'POST_CHANGED_EVENT') code += `export const ${name}='fixture-post-change';\n`;
      else if (/ALLOWED_IMAGE_TYPES$/.test(name)) code += `export const ${name}=['image/jpeg'];\n`;
      else if (/IMAGE_LIMIT$/.test(name)) code += `export const ${name}=1000000;\n`;
      else if (name === 'loadBeautyTimelineAction') code += `export function ${name}(profile,cursor){return new Promise((resolve,reject)=>window.h.reads.push({profile,cursor,resolve,reject}));}\n`;
      else if (name === 'createBeautyPostAction') code += `export function ${name}(input){return new Promise(resolve=>window.h.publishes.push({input,resolve}));}\n`;
      else code += `export function ${name}(){return null;}\n`;
    }
    modules.set(path, code);
  }
  const bundle = await build({bundle: true, write: false, outdir: 'fixture', format: 'iife', jsx: 'automatic', stdin: {loader: 'tsx', resolveDir: process.cwd(), contents: `
import React from 'react';import{createRoot}from'react-dom/client';import{BeautyProfileClient}from'./app/beauty/beauty-profile-client';
window.h={reads:[],publishes:[]};
createRoot(document.getElementById('root')).render(<BeautyProfileClient home={false} profile={{id:'self-profile',isSelf:true,displayName:'Me',initials:'M',visibility:'public',bio:null,avatarUrl:null,coverImageUrl:null}} initialTimeline={{items:[{id:'post-2'},{id:'post-1'}],nextCursor:{id:'post-1',createdAt:'2026-11-01'},hasMore:true,error:null}} commentViewer={{userId:'same-viewer',isAuthenticated:true}} visitCandidates={[]}/>);`}, plugins: [{name: 'actual-beauty-hooks', setup(b) {
    b.onResolve({filter: /.*/}, args => args.importer.replaceAll('\\', '/') === clientPath && modules.has(args.path) ? {path: args.path, namespace: 'projection-stub'} : undefined);
    b.onLoad({filter: /.*/, namespace: 'projection-stub'}, args => ({contents: modules.get(args.path), loader: 'tsx', resolveDir: process.cwd()}));
    b.onLoad({filter: /beauty-profile-client\.tsx$/}, args => args.path.replaceAll('\\', '/') === clientPath ? {contents: instrumented, loader: 'tsx', resolveDir: process.cwd() + '/app/beauty'} : undefined);
  }}]});
  const js = bundle.outputFiles.find(file => file.path.endsWith('.js'))?.text ?? bundle.outputFiles[0].text;
  server = createServer((_, response) => {response.setHeader('Content-Type', 'text/html'); response.end('<div id="root"></div><script>' + js + '</script>');});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({executablePath: browserPath, headless: true});
});
after(async () => {await browser?.close(); if (server) await new Promise(resolve => server.close(resolve));});

async function fixture(t) {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(async () => {await page.close(); assert.deepEqual(errors, []);});
  await page.goto(base); await page.locator('#mounted').waitFor();
  await page.evaluate(() => window.qa.setCaption('My new post'));
  await page.waitForFunction(() => window.qa.state.caption === 'My new post');
  return page;
}

test('own publish retires the old page and its finalizer without skipping posts or releasing a newer read', options, async t => {
  const p = await fixture(t);
  await p.evaluate(() => {void qa.loadMorePosts(); qa.publishPost(); qa.publishPost();});
  await p.waitForFunction(() => h.reads.length === 1 && h.publishes.length === 1);
  await p.evaluate(() => h.publishes[0].resolve({error: null, timeline: {items: [{id: 'post-3'}, {id: 'post-2'}], nextCursor: {id: 'post-2'}, hasMore: true, error: null}}));
  await p.waitForFunction(() => qa.state.posts[0] === 'post-3');
  assert.equal((await p.evaluate(() => qa.state)).loadingMore, false);
  await p.evaluate(() => {void qa.loadMorePosts();});
  await p.waitForFunction(() => h.reads.length === 2);
  assert.equal(await p.evaluate(() => h.reads[1].cursor.id), 'post-2');
  await p.evaluate(() => h.reads[0].resolve({items: [{id: 'post-0'}], nextCursor: {id: 'post-0'}, hasMore: false, error: null}));
  await p.waitForTimeout(30);
  assert.deepEqual(await p.evaluate(() => qa.state.posts), ['post-3', 'post-2']);
  assert.equal(await p.evaluate(() => qa.state.cursor.id), 'post-2');
  assert.equal(await p.evaluate(() => qa.state.loadingMore), true);
  await p.evaluate(() => {void qa.loadMorePosts();});
  assert.equal(await p.evaluate(() => h.reads.length), 2, 'old finally must not unlock the newer pending page');
  await p.evaluate(() => h.reads[1].resolve({items: [{id: 'post-1'}, {id: 'post-0'}], nextCursor: null, hasMore: false, error: null}));
  await p.waitForFunction(() => !qa.state.loadingMore);
  assert.deepEqual(await p.evaluate(() => qa.state.posts), ['post-3', 'post-2', 'post-1', 'post-0']);
  assert.equal(await p.evaluate(() => h.publishes.length), 1);
});

test('a rejected publish keeps the draft and admits its still-current pagination response', options, async t => {
  const p = await fixture(t);
  await p.evaluate(() => {void qa.loadMorePosts(); qa.publishPost();});
  await p.waitForFunction(() => h.reads.length === 1 && h.publishes.length === 1);
  await p.evaluate(() => h.publishes[0].resolve({error: 'Fixture publish rejected'}));
  await p.waitForFunction(() => qa.state.composerError === 'Fixture publish rejected');
  await p.evaluate(() => h.reads[0].resolve({items: [{id: 'post-0'}], nextCursor: null, hasMore: false, error: null}));
  await p.waitForFunction(() => !qa.state.loadingMore);
  assert.deepEqual(await p.evaluate(() => qa.state.posts), ['post-2', 'post-1', 'post-0']);
  assert.equal(await p.evaluate(() => qa.state.caption), 'My new post');
  assert.equal(await p.evaluate(() => qa.state.cursor), null);
  assert.equal(await p.evaluate(() => qa.state.hasMore), false);
  assert.deepEqual(await p.evaluate(() => [h.reads.length, h.publishes.length]), [1, 1]);
});

test('a retired pagination failure cannot reject after a successful publish replaced its timeline', options, async t => {
  const p = await fixture(t);
  await p.evaluate(() => {void qa.loadMorePosts().catch(error => {window.oldPageError = error.message;}); qa.publishPost();});
  await p.waitForFunction(() => h.reads.length === 1 && h.publishes.length === 1);
  await p.evaluate(() => h.publishes[0].resolve({error: null, timeline: {items: [{id: 'post-3'}, {id: 'post-2'}], nextCursor: {id: 'post-2'}, hasMore: true, error: null}}));
  await p.waitForFunction(() => qa.state.posts[0] === 'post-3');
  await p.evaluate(() => h.reads[0].reject(new Error('Retired page failed')));
  await p.waitForTimeout(30);
  assert.equal(await p.evaluate(() => window.oldPageError), undefined);
  assert.deepEqual(await p.evaluate(() => qa.state.posts), ['post-3', 'post-2']);
  assert.equal(await p.evaluate(() => qa.state.cursor.id), 'post-2');
  assert.equal(await p.evaluate(() => qa.state.timelineError), '');
});
