import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import ts from 'typescript';

const executablePath = process.env.TEST_BROWSER_PATH ?? ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const options = { skip: !executablePath, timeout: 30_000 };
const root = resolve('.'), beautyPath = resolve('app/beauty/beauty-profile-client.tsx').replaceAll('\\', '/');
const language = 'export const WorkspaceText=({text})=>text;export const WorkspaceElement=({children})=>children;export const useWorkspaceTranslation=()=>text=>text;';
const next = path => path.endsWith('image') ? 'export default function Image(p){return <img {...p}/>;}' : 'export default function Link({children,prefetch,...p}){return <a {...p}>{children}</a>;}';
const workspace = { canManage: true, addOnLinks: [], staff: [], services: [{ id: 'service1', salon_id: 'salon1', name: 'Pedicure', category: 'Nails', base_price: 45, duration_minutes: 30, description: 'Foot care', is_active: true, online_booking_enabled: false, bookingStaffIds: [], addOnServiceIds: [], bookingAddOns: [], readiness: { bookingStaffCount: 0, eligibleBookingStaffCount: 0, needsSetup: false, ready: false, reasons: [] } }] };
const scope = 'v3:' + 'a'.repeat(64);
let browser, server, base;

function definition(name) {
  const file = 'lib/app-local-page-registry.tsx';
  const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const node = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name || ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText(ast) === name));
  assert.ok(node, 'production definition exists: ' + name); return node.getText(ast);
}

async function beautyBundle() {
  const ast = ts.createSourceFile(beautyPath, readFileSync(beautyPath, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const mocks = new Map();
  for (const node of ast.statements) {
    if (!ts.isImportDeclaration(node) || !node.importClause || node.importClause.isTypeOnly) continue;
    const name = node.moduleSpecifier.text;
    if (['react', 'react-dom', './beauty-library', '@/components/post-safety', '@/components/post-change-state'].includes(name)) continue;
    const bindings = node.importClause.namedBindings;
    const names = bindings && ts.isNamedImports(bindings) ? bindings.elements.filter(n => !n.isTypeOnly).map(n => n.propertyName?.text ?? n.name.text) : [];
    let code = node.importClause.name ? 'export default function Stub(){return null;}\n' : '';
    for (const name of names) {
      if (name === 'getAccountSavedPostStatesAction') code += `export async function ${name}(targets){h.savedReads.push(targets);return{savedKeys:[],saveCountsByKey:{}};}\n`;
      else if (name === 'loadBeautyTimelineAction') code += `export async function ${name}(){h.timelineReads++;return{items:[{...h.post,id:'post2',media:[{...h.post.media[0],id:'media2'}]}],hasMore:false,nextCursor:null,error:null};}\n`;
      else if (/ALLOWED_IMAGE_TYPES$/.test(name)) code += `export const ${name}=['image/png'];\n`;
      else if (/IMAGE_LIMIT$/.test(name)) code += `export const ${name}=1000000;\n`;
      else if (name === 'SavePostButton') code += `export const ${name}=()=> <button>Love</button>;\n`;
      else code += `export function ${name}(){return null;}\n`;
    }
    mocks.set(name, code);
  }
  return build({ bundle: true, write: false, outdir: 'fixture', jsx: 'automatic', stdin: { loader: 'tsx', resolveDir: root, contents: `
    import React from 'react';import{createRoot}from'react-dom/client';import{BeautyProfileClient}from'./app/beauty/beauty-profile-client';
    const h=window.h={savedReads:[],hiddenReads:0,timelineReads:0,writes:[],post:{id:'post1',profileId:'profile1',type:'regular',visibility:'public',caption:'Synthetic photo',commentCount:0,createdAt:'2026-11-01T12:00:00Z',updatedAt:'2026-11-01T12:00:00Z',editedAt:null,author:{profileId:'profile1',displayName:'Synthetic QA',avatarUrl:null},attribution:null,bookingAction:null,reward:null,salonPublication:null,verification:null,media:[{id:'media1',role:'image',url:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',width:1,height:1,mimeType:'image/gif',objectPath:'fixture'}]}};
    const app=createRoot(document.getElementById('root'));let revision=0;
    window.show=(props={})=>app.render(<BeautyProfileClient key={++revision} libraryPage initialSection='library' {...props} profile={{id:'profile1',isSelf:true,displayName:'Synthetic QA',initials:'Q',visibility:'public',avatarUrl:null,coverImageUrl:null}} initialTimeline={{items:[h.post],nextCursor:{id:'post1',createdAt:h.post.createdAt},hasMore:true,error:null}} commentViewer={{isAuthenticated:true,userId:'viewer1'}} visitCandidates={[]}/>);
    window.show(new URLSearchParams(location.search).has('profile')?{libraryPage:false,initialSection:'overview'}:{});window.ready=true;
  ` }, plugins: [{ name: 'library-read-boundaries', setup(b) {
    b.onResolve({ filter: /^next\/(link|image)$/ }, a => ({ path: a.path, namespace: 'next' }));
    b.onLoad({ filter: /.*/, namespace: 'next' }, a => ({ contents: next(a.path), loader: 'tsx', resolveDir: root }));
    b.onResolve({ filter: /workspace-language$/ }, () => ({ path: 'language', namespace: 'special' }));
    b.onResolve({ filter: /post-moderation\/actions$/ }, () => ({ path: 'moderation', namespace: 'special' }));
    b.onLoad({ filter: /.*/, namespace: 'special' }, a => ({ loader: 'tsx', contents: a.path === 'language' ? language : 'export async function loadHiddenPostIdentitiesAction(){h.hiddenReads++;return[];}export async function postModerationAction(){h.writes.push("moderation");throw Error("No real writes");}' }));
    b.onResolve({ filter: /.*/ }, a => a.importer.replaceAll('\\', '/') === beautyPath && mocks.has(a.path) ? { path: a.path, namespace: 'beauty-stub' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'beauty-stub' }, a => ({ contents: mocks.get(a.path), loader: 'tsx', resolveDir: root }));
  } }] });
}

async function servicesBundle() {
  return build({ bundle: true, write: false, outdir: 'fixture', jsx: 'automatic', stdin: { loader: 'tsx', resolveDir: root, contents: `
    import React from 'react';import{createRoot}from'react-dom/client';import{ServicesManager}from'./app/services/services-manager';
    import{useAppLocalResource,peekAppLocalResource}from'./lib/app-local-resource';
    window.__reylumiAppLocalContext={generation:'generation-0000000001',scopeEpoch:1,nonce:'fixture'};
    const h=window.h={workspace:${JSON.stringify(workspace)},reads:[],contexts:0,commands:[],hold:false,waitForAcceptedInvalidation:false,pending:[]};
    window.router={refresh(){h.contexts++;},replace(){}};
    window.host={isNative:true,cache:async()=>null,read:async(name,args,options)=>{h.reads.push({name,args,scope:options.scope});if(h.hold)await new Promise(resolve=>h.pending.push(resolve));return{schemaVersion:1,status:200,scope:options.scope,etag:'services-'+h.reads.length,updatedAt:Date.now(),data:{data:structuredClone(h.workspace)}};}};
    window.release=()=>{h.hold=false;for(const resolve of h.pending.splice(0))resolve();};
    window.acceptedName=()=>peekAppLocalResource('${scope}','page.services',{})?.data?.data.services[0].name;
    ${['urlFor', 'ServicesDefaultPage'].map(definition).join('\n')}
    createRoot(document.getElementById('root')).render(<ServicesDefaultPage context={{context:{scope:'${scope}',salonId:'salon1',authenticated:true},access:{ownerWorkspace:true}}} path='/services?service=service1' navigate={()=>{}}/>);window.ready=true;
  ` }, plugins: [{ name: 'services-command-boundaries', setup(b) {
    b.onResolve({ filter: /app-local-host$|experience-persistent-cache$/ }, a => ({ path: a.path, namespace: 'native' }));
    b.onLoad({ filter: /.*/, namespace: 'native' }, a => ({ loader: 'js', contents: a.path.endsWith('app-local-host') ? 'export const getAppLocalHost=()=>window.host;' : 'export const getExperienceOfflineGrant=()=>null;export const isExperienceSnapshotAuthorized=()=>false;export const readExperienceSnapshot=async()=>null;export const writeExperienceSnapshot=async()=>{};export const removeExperienceSnapshot=async()=>{};' }));
    b.onResolve({ filter: /^next\/navigation$|^next\/link$|workspace-language$|^@\/app\/services\/actions$|services-catalog-runtime$|delete-unused-button$/ }, a => ({ path: a.path, namespace: 'service-stub' }));
    b.onLoad({ filter: /.*/, namespace: 'service-stub' }, a => ({ loader: 'tsx', resolveDir: root, contents: a.path.endsWith('workspace-language') ? language
      : a.path === 'next/navigation' ? 'export const useRouter=()=>window.router;export const usePathname=()=>"/services";export const useSearchParams=()=>new URLSearchParams();'
      : a.path === 'next/link' ? next(a.path)
      : a.path.endsWith('delete-unused-button') ? 'export const DeleteUnusedButton=()=>null;'
      : a.path.endsWith('services-catalog-runtime') ? 'export async function invalidateServicesCatalogForMutation(){if(h.waitForAcceptedInvalidation){while(window.acceptedName()!==h.workspace.services[0].name)await new Promise(resolve=>setTimeout(resolve,0));}}'
      : `export async function createServiceAction(){throw Error('No creation in this fixture');}export async function saveServiceConfigsAction(configs,salonId){h.commands.push({configs,salonId});for(const config of configs){Object.assign(h.workspace.services.find(row=>row.id===config.serviceId),{name:config.name,base_price:config.basePrice});}window.dispatchEvent(new CustomEvent('reylumi:app-local-command-complete',{detail:{scope:'${scope}',source:'app/services/actions.ts'}}));return{ok:true,message:'Services saved',serviceIds:configs.map(c=>c.serviceId)};}` }));
  } }] });
}

before(async () => {
  if (!executablePath) return;
  const bundles = { beauty: await beautyBundle(), services: await servicesBundle() };
  server = createServer((req, res) => {
    const kind = req.url.startsWith('/services') ? 'services' : 'beauty', files = bundles[kind].outputFiles;
    const js = files.find(f => f.path.endsWith('.js')).text, css = files.find(f => f.path.endsWith('.css'))?.text ?? '';
    res.setHeader('Content-Type', 'text/html');res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:15px Arial}.sr-only{position:absolute;clip:rect(0,0,0,0)}' + css + '</style><div id="root"></div><script>' + js.replaceAll('</script', '<\\/script') + '</script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));base = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ executablePath, headless: true });
});
after(async () => { await browser?.close();if (server) await new Promise(resolve => server.close(resolve)); });
async function pageFor(t, kind) {
  const page = await browser.newPage();const errors = [];page.on('pageerror', e => errors.push(e.message));
  t.after(async () => { try { assert.deepEqual(errors, []); } finally { await page.close(); } });
  if (kind.startsWith('beauty')) await page.addInitScript(() => { window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} }; });
  await page.goto(base + '/' + kind);await page.waitForFunction(() => window.ready);return page;
}

test('dedicated Library uses accepted photos and loads more without hidden Love/moderation reads', options, async t => {
  const page = await pageFor(t, 'beauty');await page.getByRole('heading', { name: 'Your photo library' }).waitFor();await page.waitForTimeout(100);
  assert.equal(await page.locator('.beauty-library a').count(), 1);
  assert.deepEqual(await page.evaluate(() => ({ saved: h.savedReads.length, hidden: h.hiddenReads, timeline: h.timelineReads })), { saved: 0, hidden: 0, timeline: 0 });
  assert.equal(await page.locator('section[aria-label="Beauty timeline"]').count(), 0, 'dedicated Library must not mount invisible post cards');
  await page.getByRole('button', { name: 'Load more photos', exact: true }).click();await page.waitForFunction(() => document.querySelectorAll('.beauty-library a').length === 2);
  assert.deepEqual(await page.evaluate(() => ({ saved: h.savedReads.length, hidden: h.hiddenReads, timeline: h.timelineReads, writes: h.writes.length })), { saved: 0, hidden: 0, timeline: 1, writes: 0 });
});

test('ordinary profile Overview and Posts retain their required Love and moderation reads', options, async t => {
  const page = await pageFor(t, 'beauty?profile=1');
  await page.getByRole('heading', { name: 'Latest post', exact: true }).waitFor();await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => h.savedReads.length), 1); // Ordinary profile semantics stay intact.
  assert.equal(await page.evaluate(() => h.hiddenReads), 1);
  await page.getByRole('button', { name: 'My posts', exact: true }).click();await page.getByRole('heading', { name: 'Moments & Transformations' }).waitFor();
  assert.equal(await page.locator('.beauty-post').count(), 1);
  assert.equal(await page.evaluate(() => h.savedReads.length), 1);
  assert.equal(await page.evaluate(() => h.writes.length), 0);
});

for (const completed of [false, true]) test('Services accepted save refreshes only its original named read when invalidation is ' + (completed ? 'already complete' : 'still pending'), options, async t => {
  const page = await pageFor(t, 'services');const name = page.getByLabel('Name:', { exact: true });await name.waitFor();
  await name.fill('Synthetic updated Pedicure');
  await page.evaluate(completed => { h.hold=!completed;h.waitForAcceptedInvalidation=completed; }, completed);
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.waitForFunction(() => h.commands.length === 1 && h.reads.length >= 2);
  if (!completed) { await page.waitForFunction(() => h.pending.length === 1);await page.evaluate(() => window.release()); }
  await page.waitForFunction(() => !document.querySelector('.services-save-bar'));
  await page.waitForTimeout(80);
  assert.equal(await page.evaluate(() => h.contexts), 0, 'a service-list refresh must not re-run native account admission');
  assert.equal(await page.evaluate(() => h.reads.filter(row => row.name === 'page.services').length), 2, 'initial read plus one accepted-command invalidation, with no duplicate follow-up');
  assert.equal(await name.inputValue(), 'Synthetic updated Pedicure');
  assert.deepEqual(await page.evaluate(() => h.commands.map(c => c.salonId)), ['salon1']);
});
