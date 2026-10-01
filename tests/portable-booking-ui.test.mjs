import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

test('Booking toolbar, list, day schedule, filters, details, responsive layout and creation', {
  skip: !process.env.ESBUILD_MODULE_PATH || !process.env.TEST_BROWSER_PATH, timeout: 60000,
}, async () => {
  const { build } = await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
  const root = resolve('.').replaceAll('\\', '/');
  const bundle = await build({ stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {PortableBookWorkspace} from '${root}/app/pos/portable/book/portable-book-workspace';
    const appointment=(id,name,staff,start,end,status='confirmed')=>({id,customerName:name,customerPhone:'555-0100',staffName:staff,serviceNames:['Manicure'],startAt:'2026-09-24T'+start+':00-05:00',endAt:'2026-09-24T'+end+':00-05:00',status});
    const data={date:'2026-09-24',timezone:'America/Chicago',salonName:'Test Salon',canCreate:true,canCancel:false,setupMessage:null,
      services:[{id:'service',name:'Manicure',duration_minutes:30}],staff:[{id:'alice',display_name:'Alice'},{id:'bob',display_name:'Bob'}],
      appointments:[appointment('a','Maya','Alice','09:00','10:00'),appointment('b','Linh','Alice','09:30','10:15','pending'),appointment('c','Sam','Bob','10:00','10:30','checked_in'),appointment('d','Alex',null,'11:00','11:30')]};
    const customers=[{id:'customer-a',name:'Maya Nguyen',phone:'312-555-0101',email:'maya@example.test'},{id:'customer-b',name:'Sam Tran',phone:'312-555-0202',email:null}];
    window.customerSearches=[];
    const search=async query=>{
      window.customerSearches.push(query);
      if(query==='slow'){await new Promise(r=>setTimeout(r,900));return [customers[0]];}
      if(query==='failure')throw new Error('Unavailable');
      return customers.filter(c=>(c.name+' '+c.phone).toLowerCase().includes(query.toLowerCase()));
    };
    createRoot(document.getElementById('root')).render(<PortableBookWorkspace data={data} searchCustomersAction={search} action={async input=>{window.created=input;return {ok:true,data:{...data.appointments[0],id:'new',customerName:input.customerName,startAt:input.startAt,endAt:new Date(Date.parse(input.startAt)+1800000).toISOString()}};}}/>);
  ` }, bundle: true, write: false, outdir: 'fixture', jsx: 'automatic', platform: 'browser',
    plugins: [{ name: 'workspace-fixture', setup(b) {
      b.onResolve({ filter: /portable-workspace-state$/ }, () => ({ path: 'workspace', namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const usePortableWorkspaceState=()=>null;' }));
    } }],
  });
  const js = bundle.outputFiles.find(f => f.path.endsWith('.js')).text;
  const css = bundle.outputFiles.find(f => f.path.endsWith('.css')).text;
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/bundle.js' ? 'text/javascript' : req.url === '/style.css' ? 'text/css' : 'text/html');
    res.end(req.url === '/bundle.js' ? js : req.url === '/style.css' ? css : '<style>*{box-sizing:border-box}body{margin:0;font-family:Arial}button,input,select{font:inherit}button{background:white}table{border-spacing:0}h2,p,dd{margin:0}</style><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/bundle.js"></script>');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: process.env.TEST_BROWSER_PATH, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, timezoneId: 'Asia/Tokyo' });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.clock.setFixedTime(new Date('2026-09-24T14:45:00Z'));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    assert.equal(await page.getByRole('row').count(), 5);
    assert.deepEqual(await page.getByRole('columnheader').allTextContents(), ['Time / Status','Professional','Services','Customer','Total','Actions']);
    assert.equal(await page.getByRole('heading').count(), 0);
    const toolbar = await page.getByLabel('Booking toolbar').boundingBox();
    const table = await page.getByRole('table').boundingBox();
    assert.ok(Math.abs(table.y - (toolbar.y + toolbar.height)) <= 1);
    const create = await page.getByRole('button', { name: '+ New appointment', exact: true }).boundingBox();
    assert.ok(create.y < toolbar.y + 20, 'Create stays on the toolbar row');
    await page.getByLabel('Search appointments').fill('Maya');
    assert.equal(await page.getByRole('row').count(), 2);
    await page.getByLabel('Search appointments').fill('');
    await page.locator('summary').click();
    await page.getByLabel('Status', { exact: true }).selectOption('pending');
    assert.equal(await page.getByRole('row').count(), 2);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('details').getAttribute('open'), null);
    await page.locator('summary').click();
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await page.keyboard.press('Escape');
    if (process.env.BOOKING_QA_DIR) await page.screenshot({ path: resolve(process.env.BOOKING_QA_DIR, 'booking-list.png') });
    await page.getByRole('button', { name: 'Calendar', exact: true }).click();
    const a = page.getByRole('button', { name: /9:00 AM, Maya/ });
    const b = page.getByRole('button', { name: /9:30 AM, Linh/ });
    const boxA = await a.boundingBox(), boxB = await b.boundingBox();
    assert.ok(boxA.x + boxA.width <= boxB.x);
    assert.equal(Math.round(boxB.y - boxA.y), 56);
    assert.equal(Math.round(boxA.height), 112);
    assert.equal(await page.getByLabel('Current time 9:45 AM').count(), 1);
    await a.click(); await page.getByRole('dialog').waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(), 0);
    if (process.env.BOOKING_QA_DIR) await page.screenshot({ path: resolve(process.env.BOOKING_QA_DIR, 'booking-calendar.png') });
    await page.getByRole('button', { name: 'Next day', exact: true }).click();
    assert.equal(await page.getByLabel('Selected date').inputValue(), '2026-09-25');
    assert.equal(await page.getByLabel('Day schedule').getByRole('button').count(), 1);
    await page.getByRole('button', { name: 'Today', exact: true }).click();
    assert.equal(await page.getByLabel('Selected date').inputValue(), '2026-09-24');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.locator('summary').click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Open filter fits on mobile');
    await page.keyboard.press('Escape');
    if (process.env.BOOKING_QA_DIR) await page.screenshot({ path: resolve(process.env.BOOKING_QA_DIR, 'booking-mobile.png') });
    await page.setViewportSize({ width: 1440, height: 900 });
    // Customers without a current appointment still appear; click opens an autofilled form.
    await page.getByLabel('Search appointments').fill('Maya');
    await page.getByRole('option', { name: /Maya Nguyen/ }).click();
    await page.getByRole('region',{name:'New appointment',exact:true}).getByRole('button',{name:/Maya Nguyen/}).click();
    assert.equal(await page.getByLabel('Customer name', { exact: true }).inputValue(), 'Maya Nguyen');
    assert.equal(await page.getByLabel('Phone', { exact: true }).inputValue(), '312-555-0101');
    assert.equal(await page.getByLabel('Email', { exact: true }).inputValue(), 'maya@example.test');
    assert.equal(await page.evaluate(() => window.created), undefined, 'Selecting a customer never creates a booking');
    // Name and phone fields both search. A new selection clears absent contact fields.
    await page.getByLabel('Phone', { exact: true }).fill('0202');
    await page.getByRole('option', { name: /Sam Tran/ }).waitFor();
    await page.getByLabel('Phone', { exact: true }).press('ArrowDown');
    await page.getByLabel('Phone', { exact: true }).press('Enter');
    await page.getByRole('region',{name:'New appointment',exact:true}).getByRole('button',{name:/Sam Tran/}).click();
    assert.equal(await page.getByLabel('Customer name', { exact: true }).inputValue(), 'Sam Tran');
    assert.equal(await page.getByLabel('Email', { exact: true }).inputValue(), '');
    await page.getByLabel('Customer name', { exact: true }).fill('slow');
    await page.waitForFunction(() => window.customerSearches.includes('slow'));
    await page.getByLabel('Customer name', { exact: true }).fill('Sam');
    await page.getByRole('option', { name: /Sam Tran/ }).waitFor();
    await page.waitForTimeout(1000);
    assert.equal(await page.getByRole('option', { name: /Maya Nguyen/ }).count(), 0, 'Late responses cannot replace newer results');
    await page.getByLabel('Customer name', { exact: true }).press('Escape');
    assert.equal(await page.getByRole('listbox').count(), 0);
    await page.getByLabel('Customer name', { exact: true }).fill('unknown');
    await page.getByText('No matching customers in this salon.', { exact: false }).waitFor();
    await page.getByLabel('Customer name', { exact: true }).fill('failure');
    await page.getByText('Unable to search customers.', { exact: false }).waitFor();
    await page.context().setOffline(true);
    await page.getByLabel('Customer name', { exact: true }).fill('Offline customer');
    await page.getByText('Customer search needs an internet connection.', { exact: false }).waitFor();
    await page.context().setOffline(false);
    await page.getByRole('button',{name:'Close appointment editor'}).click();
    await page.getByRole('button',{name:'Discard changes',exact:true}).click();
    await page.getByRole('button', { name: '+ New appointment', exact: true }).click();
    await page.getByLabel('Customer name', { exact: true }).fill('New customer');
    await page.getByRole('button',{name:'Done',exact:true}).click();
    await page.getByRole('button',{name:'Add service',exact:false}).click();
    await page.locator('[aria-label="Quick edit"]').getByRole('button',{name:/, .* min/}).first().click();
    await page.getByRole('button',{name:'Done',exact:true}).click();
    await page.getByRole('region',{name:'New appointment',exact:true}).getByRole('button',{name:/Sep 25/}).click();
    assert.equal(await page.getByLabel('Date and time', { exact: true }).inputValue(), '2026-09-25T09:00');
    await page.getByLabel('Date and time', { exact: true }).fill('2026-09-24T09:00');
    await page.getByRole('button',{name:'Done',exact:true}).click();
    await page.getByRole('button', { name: 'Create appointment', exact: true }).click();
    await page.getByText('Choose a future appointment time. Past times cannot be booked.', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.created), undefined);
    await page.getByRole('region',{name:'New appointment',exact:true}).getByRole('button',{name:/Sep 24/}).click();
    await page.getByLabel('Date and time', { exact: true }).fill('2026-09-24T16:00');
    await page.getByRole('button',{name:'Done',exact:true}).click();
    await page.getByRole('button', { name: 'Create appointment', exact: true }).click();
    await page.getByText('Same-day booking is disabled. Choose tomorrow or a later date.', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.created), undefined);
    await page.getByRole('region',{name:'New appointment',exact:true}).getByRole('button',{name:/Sep 24/}).click();
    await page.getByLabel('Date and time', { exact: true }).fill('2026-09-25T09:00');
    await page.getByRole('button',{name:'Done',exact:true}).click();
    await page.getByRole('button', { name: 'Create appointment', exact: true }).click();
    await page.waitForFunction(() => window.created?.customerName === 'New customer');
    assert.equal(await page.evaluate(() => window.created.startAt), '2026-09-25T14:00:00.000Z');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await new Promise(r => server.close(r)); }
});
