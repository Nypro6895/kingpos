import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const chrome = process.env.TEST_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
test('owner reviews the current staff account explicitly, sees pending confirmation, and can revoke only the returned approval', { skip: !existsSync(chrome), timeout: 60000 }, async () => {
  const root = process.cwd().replaceAll('\\', '/');
  const js = await build({ stdin: { resolveDir: root, loader: 'tsx', contents: `
import React from'react';import{createRoot}from'react-dom/client';import{StaffOfflineBindingControl}from'${root}/app/staff/staff-offline-binding-control';
window.canManage=true;window.calls=[];
createRoot(document.getElementById('root')).render(<><h1>Connected account: Synthetic staff</h1><StaffOfflineBindingControl staffId="11111111-1111-4111-8111-111111111111" viewerId="22222222-2222-4222-8222-222222222222" scope="fresh-owner" initialRevision={null}/></>);
` }, bundle: true, write: false, jsx: 'automatic', plugins: [{ name: 'no-live-actions', setup(builder) {
    builder.onResolve({ filter: /(?:current-context|experience-context|permissions|supabase\/server|workspace-language)$|^next\/cache$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents: args.path.endsWith('workspace-language') ? 'export const WorkspaceText=({text})=>text;export const useWorkspaceTranslation=()=>s=>s;' : `
export async function getCurrentBusinessContext(){return{user:{id:'owner'},currentSalon:{id:'salon'},manage:true}}export const isSalonManageContext=c=>c.manage;
export const getExperienceContext=()=>({scope:'fresh-owner'});export const hasPermission=async()=>window.canManage;export const revalidatePath=()=>{};
export async function createAuthenticatedSupabaseServerClient(){return{from(){const q={select(){return q},eq(){return q},maybeSingle:async()=>({data:{id:'staff'},error:null})};return q},rpc(name,args){return new Promise(resolve=>window.calls.push({name,args,reply:(data,error=null)=>resolve({data,error})}))}}}` }));
  } }] });
  const server = createServer((request, response) => { if (request.url === '/fixture.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(js.outputFiles[0].text); } else { response.setHeader('Content-Type', 'text/html'); response.end('<div id="root"></div><script src="/fixture.js"></script>'); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--no-proxy-server'] });
  const page = await browser.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  try {
    await page.goto(origin);
    await page.getByRole('button', { name: 'Confirm account', exact: true }).click();
    assert.equal(await page.evaluate(() => window.calls.length), 0);
    await page.getByText(/previously loaded work and pay.*24 hours/).waitFor();
    await page.getByRole('checkbox', { name: 'I confirm this account belongs to this staff member.' }).check();
    await page.getByRole('button', { name: 'Confirm account', exact: true }).click();
    await page.waitForFunction(() => window.calls.length === 1);
    assert.equal(await page.getByRole('button', { name: 'Updating…', exact: true }).isDisabled(), true);
    assert.equal(await page.evaluate(() => window.calls[0].args.p_expected_viewer_id), '22222222-2222-4222-8222-222222222222');
    await page.evaluate(() => window.calls[0].reply('44444444-4444-4444-8444-444444444444'));
    await page.getByRole('button', { name: 'Remove device access', exact: true }).waitFor();
    await page.getByText('Staff account confirmed.', { exact: true }).waitFor();
    await page.evaluate(() => { window.canManage = false; });
    await page.getByRole('button', { name: 'Remove device access', exact: true }).click();
    await page.getByRole('alert').waitFor(); assert.equal(await page.evaluate(() => window.calls.length), 1, 'hidden controls cannot substitute for fresh permission');
    await page.evaluate(() => { window.canManage = true; });
    await page.getByRole('button', { name: 'Remove device access', exact: true }).click();
    await page.waitForFunction(() => window.calls.length === 2);
    assert.equal(await page.evaluate(() => window.calls[1].args.p_expected_revision), '44444444-4444-4444-8444-444444444444');
    await page.evaluate(() => window.calls[1].reply(null));
    await page.getByRole('button', { name: 'Confirm account', exact: true }).waitFor();
    await page.getByRole('checkbox').waitFor();
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
