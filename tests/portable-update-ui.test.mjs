import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
test('report zeros are replaced on entry; update reminder supports Later and now without scheduling', {
  skip: !process.env.ESBUILD_MODULE_PATH || !process.env.TEST_BROWSER_PATH, timeout: 45000,
}, async () => {
  const { build } = await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
  const repo = resolve('.').replaceAll('\\', '/');
  const result = await build({ stdin: { contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {DesktopUpdate} from '${repo}/app/pos/portable/desktop-update';
    import {PortableReportClosingForm} from '${repo}/app/pos/portable/report/portable-report-closing-form';
    let state={phase:'ready',version:'0.3.0',scheduledAt:null,message:''};
    window.kingposDesktop={updates:{state:async()=>state,later:async()=>({...state,scheduledAt:null}),schedule:async at=>(state={...state,scheduledAt:at}),now:async()=>{window.installed=true;return state;}}};
    createRoot(document.getElementById('root')).render(<><DesktopUpdate/><PortableReportClosingForm data={{closingInputs:{cashAmount:0,creditCardAmount:0,otherAmount:0},lock:{isLocked:false},totals:{expectedTotal:0},reportDate:'2026-09-23'}}/></>);
  `, loader: 'tsx', resolveDir: repo }, jsx: 'automatic', bundle: true, write: false, platform: 'browser', plugins: [{ name: 'fixture', setup(b) {
    b.onResolve({ filter: /portable-workspace-state|portable\/actions$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export const usePortableWorkspaceState=()=>null; export const savePortableReportClosing=async()=>({ok:false,error:'Test save'});` }));
  } }] });
  const server = createServer((req, res) => { if (req.url === '/bundle.js') { res.setHeader('Content-Type','text/javascript'); res.end(result.outputFiles[0].text); } else { res.setHeader('Content-Type','text/html'); res.end('<div id="root"></div><script src="/bundle.js"></script>'); } });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: process.env.TEST_BROWSER_PATH, headless: true });
  try {
    const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}`);
    const cash = page.getByLabel('Cash', { exact: true });
    assert.equal(await cash.inputValue(), ''); await cash.click(); await cash.pressSequentially('2024'); assert.equal(await cash.inputValue(),'2024');
    await cash.fill('0.00'); await page.getByLabel('Other',{exact:true}).click(); await cash.click(); assert.equal(await cash.inputValue(),''); await cash.pressSequentially('75.25'); assert.equal(await cash.inputValue(),'75.25');
    await page.getByRole('button',{name:'Update available'}).click(); await page.getByRole('button',{name:'Later',exact:true}).click();
    await page.getByRole('button',{name:'Update available'}).click();
    assert.equal(await page.getByRole('button',{name:'Schedule',exact:true}).count(),0);
    await page.getByRole('button',{name:'Update now',exact:true}).click(); await page.waitForFunction(()=>window.installed===true);
  } finally { await browser.close(); await new Promise(r=>server.close(r)); }
});
