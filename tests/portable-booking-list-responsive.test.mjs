import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

test('booking list fits narrow windows, wraps long content and retains row actions', {
  skip: !process.env.ESBUILD_MODULE_PATH || !process.env.TEST_BROWSER_PATH,
  timeout: 60000,
}, async () => {
  const { build } = await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
  const built = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {BookingViews} from './app/pos/portable/book/booking-views';
    import styles from './app/pos/portable/book/booking.module.css';
    const base={id:'booking',customerName:'Tram',customerPhone:'+14143566624',serviceNames:['Full-Set'],staffName:'David',startAt:'2026-09-24T14:00:00Z',endAt:'2026-09-24T14:45:00Z',status:'confirmed',total:55};
    const long={...base,id:'long',customerName:'Alexandria Montgomery-Wellington',customerPhone:'+123456789012345',staffName:'Christopher Alexander, Elizabeth Rose',serviceNames:['Deluxe manicure with detailed nail art','Pedicure and extended massage'],total:1234567.89};
    const appointments=[base,long,...['pending','checked_in','in_service','completed','cancelled','no_show'].map((status,i)=>({...base,id:'status-'+i,customerName:'Customer '+i,status,ticketId:status==='completed'?'ticket':null})),...Array.from({length:15},(_,i)=>({...base,id:'extra-'+i,customerName:'Customer '+(i+10)}))];
    window.actions=[];
    createRoot(document.getElementById('root')).render(<main className={styles.workspace}><section className={styles.panel}><div className={styles.bookingBody} data-editing="false"><div className={styles.bookingContent}>
      <BookingViews appointments={appointments} data={{timezone:'America/Chicago',staff:[]}} date="2026-09-24" view="list" showDates={true} actions={{ticket:item=>window.actions.push(['ticket',item.id]),status:item=>window.actions.push(['status',item.id]),edit:(item,field)=>window.actions.push(['edit',item.id,field?.kind])}} />
    </div></div></section></main>);
  ` }, bundle: true, write: false, outdir: 'fixture', jsx: 'automatic' });
  const js = built.outputFiles.find(f => f.path.endsWith('.js')).text;
  const css = built.outputFiles.find(f => f.path.endsWith('.css')).text;
  const server = createServer((req, res) => {
    res.setHeader('Content-Type',req.url === '/app.js' ? 'text/javascript' : req.url === '/app.css' ? 'text/css' : 'text/html');
    res.end(req.url === '/app.js' ? js : req.url === '/app.css' ? css : '<style>*{box-sizing:border-box}body{margin:0;font-family:Arial}button{font:inherit}#root{height:100dvh}</style><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>');
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const browser = await chromium.launch({ executablePath: process.env.TEST_BROWSER_PATH, headless: true });
  try {
    const page = await browser.newPage({viewport:{width:900,height:620},hasTouch:true});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const table=page.getByRole('table',{name:'Appointments'});await table.waitFor();
    for (const width of [1440,1100,900,884,768,600,390]) {
      await page.setViewportSize({width,height:620});
      const overflow=await table.evaluate(el=>[el,...el.querySelectorAll('td'),el.parentElement,el.parentElement.parentElement,document.querySelector('main')].filter(el=>el.scrollWidth>el.clientWidth+1).map(el=>({tag:el.tagName,width:el.clientWidth,scroll:el.scrollWidth})));
      assert.deepEqual(overflow,[],`No horizontal scrolling or clipped cells at ${width}px`);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      for (const name of ['Create ticket for Tram','Edit appointment for Tram','Change status for Tram']) {
        const box=await page.getByRole('button',{name,exact:true}).boundingBox();
        assert.ok(box.x>=0 && box.x+box.width<=width,`${name} fits at ${width}px`);
        assert.ok(box.height>=40,'Controls remain touchable');
      }
    }
    await page.setViewportSize({width:900,height:620});
    await page.getByRole('button',{name:'Create ticket for Tram',exact:true}).tap();
    await page.getByRole('button',{name:'Change status for Tram',exact:true}).tap();
    await page.getByRole('button',{name:'Edit appointment for Tram',exact:true}).tap();
    assert.deepEqual(await page.evaluate(()=>window.actions),[['ticket','booking'],['status','booking'],['edit','booking',undefined]]);
    assert.equal(await page.getByRole('button',{name:'Create ticket for Customer 0',exact:true}).count(),0,'Pending appointment cannot create a ticket');
    assert.equal(await page.getByRole('button',{name:'Create ticket for Customer 3',exact:true}).count(),0,'Existing ticket cannot be created twice');
    assert.equal(await page.getByLabel('Ticket created',{exact:true}).count(),1);
    await page.getByRole('button',{name:'Create ticket for Customer 24',exact:true}).scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(()=>document.querySelector('main').scrollTop>0),'Long lists scroll vertically');
    await page.evaluate(()=>document.querySelector('main').scrollTop=0);
    if(process.env.BOOKING_QA_DIR){await mkdir(process.env.BOOKING_QA_DIR,{recursive:true});await page.screenshot({path:join(process.env.BOOKING_QA_DIR,'booking-list-minimum.png')});}
    await page.setViewportSize({width:1100,height:620});
    await page.locator('[data-editing]').evaluate(el=>{el.dataset.editing='true';const aside=document.createElement('aside');aside.textContent='Appointment editor';el.appendChild(aside);});
    const pane=table.locator('..');
    assert.ok(await pane.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'List fits beside editor');
    assert.equal(await table.locator('tbody tr').first().evaluate(el=>getComputedStyle(el).display),'grid','Narrow editor pane uses cards');
    assert.deepEqual(errors,[]);
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
});
