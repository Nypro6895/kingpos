import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const browserPath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const options = { skip: !browserPath, timeout: 15_000 };
let browser, server, base;
before(async () => {
  if (!browserPath) return;
  const bundle = await build({ stdin: { loader: 'tsx', resolveDir: process.cwd(), contents: `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{OwnerLocalPanels}from'./app/pos/owner-local-panels';
window.__reylumiAppLocalContext={generation:'generation-0000000001',scopeEpoch:1,nonce:'fixture'};
const h=window.h={reads:[],saved:[],name:'Before',holdPatch:false};
window.publishRemote=(resource='staff',ids)=>{const channel=new BroadcastChannel('kingpos:workspace:fixture-salon');channel.postMessage({salonId:'fixture-salon',resource,ids});setTimeout(()=>channel.close(),100);};
window.host={isNative:true,cache:async()=>null,read:async(name,args,options)=>{
 h.reads.push({name,args});const data=name==='owner.check-in'?{view:'check-in',props:{data:{salonId:'fixture-salon',today:'2026-11-03',timezone:'America/Chicago',staff:[{id:'00000000-0000-4000-8000-000000000001',displayName:h.name}]}}}:{view:'reports',props:{marker:'Reports'}};
 if(args.ids&&h.holdPatch)await new Promise(resolve=>window.releasePatch=()=>{h.holdPatch=false;resolve();});
 return{schemaVersion:1,status:200,scope:options.scope,etag:'fixture-'+h.reads.length,updatedAt:Date.now(),data};
}};
function App(){const[href,set]=useState('/pos/check-in');window.navigate=set;return <OwnerLocalPanels scope={'v3:'+'a'.repeat(64)} salonId="fixture-salon" activeHref={href} navigate={set}/>;}
createRoot(document.getElementById('root')).render(<App/>);
` }, bundle: true, write: false, outfile: 'owner-panel-fixture.js', platform: 'browser', jsx: 'automatic', plugins: [{ name: 'owner-panel-boundaries', setup(b) {
    const names = /app-local-host$|experience-persistent-cache$|supabase\/browser$|owner-live-booking-workspace$|owner-live-tickets$|owner-live-reports$|portable-check-in-client$|owner-check-in-actions$|workspace-language$|lumi-loading-status$|^\.\/owner-local-workspace$/;
    b.onResolve({ filter: names }, ({ path }) => ({ path, namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ loader: 'tsx', resolveDir: process.cwd(), contents:
      path.endsWith('app-local-host') ? 'export const getAppLocalHost=()=>window.host;' :
      path.endsWith('experience-persistent-cache') ? 'export const getExperienceOfflineGrant=()=>null;export const isExperienceSnapshotAuthorized=()=>false;export const readExperienceSnapshot=async()=>null;export const writeExperienceSnapshot=async()=>{};export const removeExperienceSnapshot=async()=>{};' :
      path.endsWith('supabase/browser') ? 'export const createSupabaseBrowserClient=()=>null;' :
      path.endsWith('owner-local-workspace') ? 'export const useOwnerLocalWorkspace=()=>null;export const saveOwnerLocalSnapshot=async(...args)=>window.h.saved.push(args);' :
      path.endsWith('portable-check-in-client') ? 'export function PortableCheckInClient(props){window.settleAttendance=props.onAttendanceSettled;return <output data-testid="staff">{props.data.staff[0]?.displayName}</output>;}' :
      path.endsWith('owner-check-in-actions') ? 'export async function ownerSubmitAttendance(){throw Error("No live write allowed");}' :
      path.endsWith('workspace-language') ? 'export const WorkspaceText=({text})=><span>{text}</span>;' :
      path.endsWith('lumi-loading-status') ? 'export const LumiLoadingStatus=()=>null;' :
      'export const OwnerLiveReports=()=> <output>Reports</output>;export const OwnerLiveTickets=()=>null;export const OwnerLiveBookingWorkspace=()=>null;'
    }));
  } }] });
  server = createServer((req, res) => {
    if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(bundle.outputFiles[0].text); }
    else res.end('<div id="root"></div><script src="/bundle.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ executablePath: browserPath, headless: true });
});
after(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); });
async function fixture(t) {
  const page = await browser.newPage(); t.after(() => page.close());
  const errors = []; page.on('pageerror', error => errors.push(error.message)); t.after(() => assert.deepEqual(errors, []));
  await page.goto(base); await page.getByTestId('staff').filter({ hasText: 'Before' }).waitFor(); await page.waitForTimeout(150);
  return page;
}

test('hidden Check In retains its view but defers remote and pending-settlement reads until return', options, async t => {
  const page = await fixture(t);
  await page.evaluate(() => window.navigate('/pos/report')); await page.getByText('Reports', { exact: true }).waitFor(); await page.waitForTimeout(100);
  await page.evaluate(() => { h.name = 'After'; window.publishRemote(); window.settleAttendance(); }); await page.waitForTimeout(350);
  assert.equal(await page.evaluate(() => h.reads.filter(r => r.name === 'owner.check-in').length), 1);
  assert.equal(await page.getByTestId('staff').count(), 1, 'retained attendance view stays mounted');
  await page.evaluate(() => window.navigate('/pos/check-in')); await page.getByTestId('staff').filter({ hasText: 'After' }).waitFor();
  assert.equal(await page.evaluate(() => h.reads.filter(r => r.name === 'owner.check-in').length), 2);
});

test('a partial attendance reply cannot commit after Check In becomes hidden', options, async t => {
  const page = await fixture(t);
  await page.evaluate(() => { h.name = 'Late'; h.holdPatch = true; window.publishRemote('staff', ['00000000-0000-4000-8000-000000000001']); });
  await page.waitForFunction(() => typeof window.releasePatch === 'function');
  await page.evaluate(() => window.navigate('/pos/report')); await page.getByText('Reports', { exact: true }).waitFor();
  await page.evaluate(() => window.releasePatch()); await page.waitForTimeout(150);
  assert.equal(await page.getByTestId('staff').textContent(), 'Before');
  assert.deepEqual(await page.evaluate(() => h.saved), [], 'hidden partial reply cannot persist a stale roster');
  await page.evaluate(() => { h.name = 'Current'; window.navigate('/pos/check-in'); }); await page.getByTestId('staff').filter({ hasText: 'Current' }).waitFor();
});
