import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

test('Notification bell: confirm, duplicate protection, stale refresh, errors, keyboard, empty and offline', { timeout: 90000 }, async () => {
  const { build } = await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
  const built = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {PortableBookingNotifications} from './app/pos/portable/portable-booking-notifications';
    window.rows=[{id:'a',customerName:'Maya',serviceNames:['Manicure'],status:'pending',startAt:'2026-10-28T14:00:00Z',updatedAt:'2026-09-25T10:00:00Z'},{id:'b',customerName:'Linh',serviceNames:['Pedicure'],status:'scheduled',startAt:'2026-09-28T16:00:00Z'}];
    window.rows[0].staffName='David';
    window.rows[1].lines=[{staffName:'David'},{staffName:'Tracy'},{staffName:'David'}];
    window.calls=[]; window.fail=false; window.delay=false;
    const root=createRoot(document.getElementById('root'));
    window.render=(canConfirm=true)=>root.render(<><PortableBookingNotifications salonId='salon' timezone='America/Chicago' canConfirm={canConfirm}/><button>Outside</button></>);
    window.render();
  ` }, bundle: true, write: false, outdir: 'fixture', jsx: 'automatic', plugins: [{ name: 'stubs', setup(b) {
    b.onResolve({ filter: /^\.\/actions$/ }, () => ({ path: 'actions', namespace: 'stub' }));
    b.onResolve({ filter: /pos-workspace-sync$/ }, () => ({ path: 'sync', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ resolveDir: process.cwd(), contents: args.path === 'actions' ? `
      export async function portableBookingNotifications(){if(window.loadFail)throw Error('failed');const rows=[...window.rows];if(window.delay)await new Promise(r=>window.finishRefresh=r);return rows;}
      export async function portableManageBooking(input){window.calls.push(input);await new Promise(r=>window.finishConfirm=r);if(window.fail)return{ok:false,error:'Appointment changed on another device.'};if(window.noShowWarning&&!input.payload?.acknowledgeNoShow)return{ok:true,data:{requiresNoShowReview:true,noShowHistory:[{id:'old',startAt:'2026-08-31T14:00:00Z',timezone:'America/Chicago',services:['Manicure'],note:null}]}};const item=window.rows.find(x=>x.id===input.bookingId);window.rows=window.rows.filter(x=>x.id!==input.bookingId);return{ok:true,data:{...item,status:'confirmed'}};}
    ` : `import {useEffect} from 'react';export function usePosResourceRefresh(s,r,refresh){window.refresh=refresh;useEffect(()=>{void refresh()},[refresh]);}` }));
  } }] });
  const js = built.outputFiles.find(f => f.path.endsWith('.js')).text;
  const css = built.outputFiles.find(f => f.path.endsWith('.css')).text;
  const server = createServer((req,res) => { res.setHeader('Content-Type', req.url === '/app.js' ? 'text/javascript' : req.url === '/app.css' ? 'text/css' : 'text/html'); res.end(req.url === '/app.js' ? js : req.url === '/app.css' ? css : '<style>body{font-family:Arial;padding:30px}#root{display:flex;justify-content:flex-end}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}</style><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>'); });
  await new Promise(r => server.listen(0,'127.0.0.1',r));
  const browser = await chromium.launch({ executablePath: process.env.TEST_BROWSER_PATH, headless: true });
  try {
    const page = await browser.newPage({viewport:{width:1100,height:800}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:'+server.address().port);
    const bell = page.getByRole('button',{name:/Appointment notifications,/});
    await page.getByRole('button',{name:'Appointment notifications, 2 pending'}).waitFor();
    await bell.focus();await page.keyboard.press('Enter');
    const panel=page.getByRole('region',{name:'New appointments'});
    await panel.waitFor(); assert.match(await panel.textContent(),/Oct 28, 2026/);
    assert.match(await panel.textContent(),/9:00 AM/);
    assert.match(await panel.textContent(),/Staff: David/);
    assert.match(await panel.textContent(),/Staff: David, Tracy/);
    if (process.env.NOTIFICATION_SCREENSHOT) await page.screenshot({path:process.env.NOTIFICATION_SCREENSHOT});
    await page.setViewportSize({width:375,height:700});
    const bounds=await panel.boundingBox();assert.ok(bounds.x>=0 && bounds.x+bounds.width<=375);
    await page.setViewportSize({width:1100,height:800});
    assert.equal(await page.getByRole('button',{name:'Close appointment notifications'}).evaluate(e=>e===document.activeElement),true);
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.getByRole('button',{name:'Confirm appointment for Maya'}).evaluate(e=>e===document.activeElement),true);
    await page.evaluate(()=>{window.delay=true;void window.refresh()});
    await page.keyboard.press('Enter');await page.keyboard.press('Enter');
    await page.waitForFunction(()=>window.calls.length===1);
    assert.equal(await page.getByRole('button',{name:'Confirm appointment for Linh'}).isDisabled(),true);
    await page.evaluate(()=>window.finishConfirm());
    await page.getByRole('button',{name:'Appointment notifications, 1 pending'}).waitFor();
    await panel.getByText('Confirmed',{exact:true}).waitFor();
    await page.evaluate(()=>{window.delay=false;window.finishRefresh()});
    assert.equal(await bell.getAttribute('aria-label'),'Appointment notifications, 1 pending');
    assert.equal((await page.evaluate(()=>window.calls))[0].payload.updatedAt,'2026-09-25T10:00:00Z');
    await page.evaluate(()=>window.fail=true);
    await page.getByRole('button',{name:'Confirm appointment for Linh'}).click();
    await page.waitForFunction(()=>window.calls.length===2);await page.evaluate(()=>window.finishConfirm());
    await page.getByRole('alert').waitFor();assert.equal(await bell.getAttribute('aria-label'),'Appointment notifications, 1 pending');
    await page.context().setOffline(true);await panel.getByText(/Offline\./).waitFor();
    assert.equal(await page.getByRole('button',{name:'Confirm appointment for Linh'}).isDisabled(),true);
    await page.context().setOffline(false);
    await page.evaluate(()=>window.fail=false);
    await page.getByRole('button',{name:'Confirm appointment for Linh'}).click();
    await page.waitForFunction(()=>window.calls.length===3);await page.evaluate(()=>window.finishConfirm());
    await page.getByRole('button',{name:'Appointment notifications, 0 pending'}).waitFor();
    assert.equal(await panel.getByText(/No new appointments/).count(),0);
    assert.equal(await bell.getAttribute('aria-label'),'Appointment notifications, 0 pending');
    await page.keyboard.press('Escape');assert.equal(await panel.count(),0);
    assert.equal(await bell.evaluate(e=>e===document.activeElement),true);
    await bell.click();await panel.getByText(/No new appointments/).waitFor();await page.getByRole('button',{name:'Outside',exact:true}).click();assert.equal(await panel.count(),0);
    await page.evaluate(()=>{window.rows=[{id:'c',customerName:'Sam',serviceNames:['Haircut'],status:'pending',startAt:'2026-10-01T12:00:00Z'}];window.render(false);return window.refresh()});
    await bell.click();assert.equal(await page.getByRole('button',{name:'Confirm appointment for Sam'}).isDisabled(),true);
    assert.match(await panel.textContent(),/Staff: Unassigned/);
    await page.keyboard.press('Tab');assert.equal(await panel.count(),0);
    await page.evaluate(()=>{window.loadFail=true;return window.refresh()});await bell.click();await page.getByRole('alert').waitFor();
    await page.evaluate(()=>{window.loadFail=false;window.noShowWarning=true;window.render(true);return window.refresh()});
    await page.getByRole('button',{name:'Confirm appointment for Sam'}).click();
    await page.waitForFunction(()=>window.calls.length===4);await page.evaluate(()=>window.finishConfirm());
    await page.getByRole('dialog',{name:'Previous no-shows'}).waitFor();
    await page.getByRole('button',{name:'Go back',exact:true}).click();
    await panel.waitFor();assert.equal(await bell.getAttribute('aria-label'),'Appointment notifications, 1 pending');
    await page.getByRole('button',{name:'Confirm appointment for Sam'}).click();
    await page.waitForFunction(()=>window.calls.length===5);await page.evaluate(()=>window.finishConfirm());
    await page.getByRole('button',{name:'Confirm anyway',exact:true}).click();
    await page.waitForFunction(()=>window.calls.length===6);await page.evaluate(()=>window.finishConfirm());
    await page.getByRole('button',{name:'Appointment notifications, 0 pending'}).waitFor();
    assert.equal(await page.evaluate(()=>window.calls[5].payload.acknowledgeNoShow),true);
    assert.deepEqual(errors,[]);
  } finally {await browser.close();await new Promise(r=>server.close(r));}
});
