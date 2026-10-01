import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

test('saved and queued tickets survive browser restart; feedback is readable', {
  skip: !process.env.ESBUILD_MODULE_PATH || !process.env.TEST_BROWSER_PATH, timeout: 60000,
}, async () => {
  const { build } = await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
  const repo = resolve('.').replaceAll('\\', '/');
  const bundle = await build({ stdin: { contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {PortableDraftControls} from '${repo}/app/pos/portable/portable-draft-controls';
    import {usePortableCloseGuard} from '${repo}/app/pos/portable/use-portable-close-guard';
    import {PortableCustomerAction} from '${repo}/app/pos/portable/portable-customer-action';
    import * as ops from '${repo}/lib/portable-operations';
    import * as messages from '${repo}/lib/pos-user-messages';
    window.ops=ops;window.messages=messages;
    function App(){const [active,setActive]=React.useState(false);const [amount,setAmount]=React.useState(50);usePortableCloseGuard(active);
      return <><button onClick={()=>setActive(true)}>Start ticket</button><output>{active?'Open '+amount:'Empty'}</output>
        <PortableDraftControls scope="fixture:key" active={active} activity={String(amount)} value={{amount}} label={'Maya · $'+amount.toFixed(2)} reset={async()=>setActive(false)} restore={v=>{setAmount(v.amount);setActive(true);return true;}} />
        <PortableCustomerAction action="left" name="Maya" onClick={()=>{}} /></>;
    }createRoot(document.getElementById('root')).render(<App/>);`, loader: 'tsx', resolveDir: repo }, jsx: 'automatic', bundle: true, write: false, platform: 'browser' });
  const server = createServer((req,res) => {
    if (req.url === '/bundle.js') { res.setHeader('Content-Type','text/javascript'); res.end(bundle.outputFiles[0].text); }
    else if (req.url.startsWith('/api/')) { res.statusCode=503;res.end('{}'); }
    else { res.setHeader('Content-Type','text/html');res.end('<div id="root"></div><script src="/bundle.js"></script>'); }
  });
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  const profile = mkdtempSync(join(tmpdir(),'kingpos-feedback-'));
  let context;
  const launch = () => chromium.launchPersistentContext(profile,{executablePath:process.env.TEST_BROWSER_PATH,headless:true});
  try {
    context=await launch();let page=await context.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
    assert.equal(await page.evaluate(()=>window.messages.isPosConnectionError('TypeError: fetch failed')),true);
    assert.doesNotMatch(await page.evaluate(()=>window.messages.posUserMessage('violates check constraint receipt_status')),/constraint/);
    assert.match(await page.evaluate(()=>window.messages.posUserMessage('Add at least one service amount before submit.')),/service amount/);
    await page.getByRole('button',{name:'Start ticket'}).click();
    const unload=page.waitForEvent('dialog');
    const reload=page.reload({timeout:2000}).catch(()=>null);
    const warning=await unload;assert.equal(warning.type(),'beforeunload');await warning.dismiss();await reload;
    await context.setOffline(true);
    const op=await page.evaluate(()=>window.ops.savePortableOperation('fixture:key','receipt',{total:50}));
    await page.getByRole('button',{name:'Start ticket'}).click();
    await page.getByRole('button',{name:'Save for later',exact:true}).click();
    await page.getByRole('button',{name:'Saved tickets (1)'}).waitFor();
    await context.close();context=await launch();page=await context.newPage();await page.clock.install();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const rows=await page.evaluate(()=>window.ops.listPortableOperations('fixture:key'));
    assert.equal(rows.length,1);assert.equal(rows[0].id,op.id);assert.equal(rows[0].state,'pending');
    await page.getByRole('button',{name:'Saved tickets (1)'}).click();
    const list=page.getByRole('dialog',{name:'Saved tickets'});
    assert.equal(await list.getByRole('listitem').count(),1);
    await list.getByRole('button',{name:/^Maya/}).click();
    await page.getByText('Open 50',{exact:true}).waitFor();
    await page.clock.fastForward(180100);
    const prompt=page.getByRole('dialog',{name:'Unfinished ticket'});
    await prompt.waitFor();
    assert.match(await prompt.getByRole('button',{name:'Save for later'}).getAttribute('class'),/hover:bg-teal-800/);
    assert.match(await prompt.getByRole('button',{name:'Continue'}).getAttribute('class'),/active:scale/);
    await prompt.getByRole('button',{name:'Continue'}).click();
    await prompt.waitFor({state:'hidden'});
    assert.match(await page.getByRole('button',{name:'Maya left'}).innerText(),/Left salon/);
  } finally {
    await context?.close();await new Promise(done=>server.close(done));
    if (!resolve(profile).startsWith(resolve(tmpdir())+sep+'kingpos-feedback-')) throw Error('Unexpected test directory');
    rmSync(profile,{recursive:true,force:true});
  }
});
