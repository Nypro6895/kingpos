import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

test('bulk merge forms keep conflicts visible and submit the intended selection on mobile and desktop', async () => {
  const browserPath=process.env.TEST_BROWSER_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
  assert.ok(browserPath,'A local browser is required');
  const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
    import {createRoot} from 'react-dom/client';
    import {DuplicateMergeForms} from './app/customers/duplicate-merge-forms';
    const candidates=[{id:'safe',name:'Nene',mergeBlockedReason:null},{id:'conflict',name:'Nene linked profile',mergeBlockedReason:'Linked to a different personal account'}];
    createRoot(document.getElementById('root')).render(<><section aria-label="Mixed suggestions"><DuplicateMergeForms customerId="target" candidates={candidates}/></section><section aria-label="Blocked suggestions"><DuplicateMergeForms customerId="blocked-target" candidates={candidates.slice(1)}/></section></>);
  `},bundle:true,write:false,format:'iife',jsx:'automatic',plugins:[{name:'fixture',setup(b){
    b.onResolve({filter:/^\.\/actions$/},args=>args.importer.replaceAll('\\','/').includes('/app/customers/')?{path:'actions',namespace:'fixture'}:null);
    b.onResolve({filter:/^@\/components\/workspace-language$/},()=>({path:'translation',namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'tsx',contents:args.path==='actions'
      ? 'export async function mergeDuplicateCustomers(data){window.calls??=[];window.calls.push([...data.entries()]);}'
      : 'export const useWorkspaceTranslation=()=>text=>text;export const WorkspaceText=({text})=>text;'}));
  }}]});
  const html=`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:16px Arial;margin:16px}section{max-width:360px;border:1px solid #ccc;padding:12px;margin-bottom:16px}label{display:flex;gap:8px;margin:12px 0}span{overflow-wrap:anywhere}button{padding:12px;max-width:100%}button:disabled{opacity:.5}</style><div id="root"></div><script>${bundle.outputFiles[0].text}</script>`;
  const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(html);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser=await chromium.launch({executablePath:browserPath,headless:true});
    for (const width of [390,1280]) {
      const page=await browser.newPage({viewport:{width,height:844}});
      const errors=[]; page.on('pageerror',error=>errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      const mixed=page.getByRole('region',{name:'Mixed suggestions'});
      const blocked=page.getByRole('region',{name:'Blocked suggestions'});
      await mixed.getByRole('button',{name:'Merge all (1)',exact:true}).waitFor();
      assert.equal(await mixed.getByText('Linked to a different personal account').isVisible(),true);
      assert.equal(await mixed.locator('input[value="conflict"][type="checkbox"]').isDisabled(),true);
      assert.equal(await blocked.getByRole('button',{name:'Merge all (0)',exact:true}).isDisabled(),true);
      assert.equal(await blocked.getByRole('button',{name:'Merge selected',exact:true}).isDisabled(),true);
      const all=mixed.locator('form').first();
      await all.getByRole('checkbox').check();
      await all.getByRole('button').click();
      await page.waitForFunction(()=>window.calls?.length===1);
      let payload=await page.evaluate(()=>window.calls[0]);
      assert.deepEqual(payload.filter(([key])=>key==='source_customer_id').map(([,value])=>value),['safe','conflict']);
      assert.ok(payload.some(([key,value])=>key==='merge_mode'&&value==='all'));
      const selected=mixed.locator('form').last();
      await selected.locator('input[value="safe"]').check();
      await selected.getByRole('checkbox').last().check();
      await selected.getByRole('button').click();
      await page.waitForFunction(()=>window.calls.length===2);
      await page.waitForFunction(()=>!document.querySelector('[aria-label="Mixed suggestions"] form:last-child button').disabled);
      payload=await page.evaluate(()=>window.calls[1]);
      assert.deepEqual(payload.filter(([key])=>key==='source_customer_id').map(([,value])=>value),['safe']);
      assert.equal(payload.some(([key])=>key==='merge_mode'),false);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      assert.deepEqual(errors,[]);
      mkdirSync('artifacts/customer-merge-all-20261025',{recursive:true});
      await page.screenshot({path:`artifacts/customer-merge-all-20261025/merge-${width}.png`,fullPage:true});
      await page.close();
    }
  } finally { if(browser) await browser.close(); await new Promise(resolve=>server.close(resolve)); }
});
