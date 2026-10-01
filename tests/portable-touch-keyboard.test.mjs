import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
const require = createRequire(import.meta.url);
const { build } = require(process.env.ESBUILD_MODULE_PATH || 'esbuild');
const { chromium } = require('playwright-core');

test('Portable keyboard updates controlled fields, caret, search, notes, date, and respects disabled setting', async () => {
  const result = await build({ stdin: { contents: `
    import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{PortableTouchKeyboard}from'./app/pos/portable/touch-keyboard';
    function App(){const [value,setValue]=useState('');const [enabled,setEnabled]=useState(true);const [note,setNote]=useState('');const [date,setDate]=useState('2026-09-28T09:00');return <main data-portable-shell><label>Customer<input aria-label="Customer" value={value} onChange={e=>setValue(e.target.value)}/></label><output>{value}</output><textarea aria-label="Note" value={note} onChange={e=>setNote(e.target.value)}/><input aria-label="Appointment" type="datetime-local" value={date} onChange={e=>setDate(e.target.value)}/><button onClick={()=>setEnabled(!enabled)}>Toggle setting</button><PortableTouchKeyboard enabled={enabled}/></main>}createRoot(document.getElementById('root')).render(<App/>);`, resolveDir: process.cwd(), loader: 'tsx' }, bundle:true, write:false, outdir:'out', jsx:'automatic', loader:{'.css':'css'} });
  const js=result.outputFiles.find(f=>f.path.endsWith('.js')).text, css=result.outputFiles.find(f=>f.path.endsWith('.css')).text;
  const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':req.url==='/app.css'?'text/css':'text/html');res.end(req.url==='/app.js'?js:req.url==='/app.css'?css:'<link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>');});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH,headless:true});
  try {const page=await browser.newPage({viewport:{width:1024,height:768}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByLabel('Customer',{exact:true}).click();const keyboard=page.getByRole('group',{name:'Touch keyboard'});
    await keyboard.getByRole('button',{name:'a',exact:true}).click();await keyboard.getByRole('button',{name:'b',exact:true}).click();assert.equal(await page.locator('output').textContent(),'ab');
    await page.getByLabel('Customer',{exact:true}).evaluate(el=>el.setSelectionRange(1,1));await keyboard.getByRole('button',{name:'c',exact:true}).click();assert.equal(await page.locator('output').textContent(),'acb');
    await keyboard.getByRole('button',{name:'Backspace'}).click();assert.equal(await page.locator('output').textContent(),'ab');
    await page.getByLabel('Note',{exact:true}).click();await keyboard.getByRole('button',{name:'a',exact:true}).click();await keyboard.getByRole('button',{name:'New line'}).click();await keyboard.getByRole('button',{name:'b',exact:true}).click();assert.equal(await page.getByLabel('Note',{exact:true}).inputValue(),'a\nb');
    await page.getByLabel('Appointment',{exact:true}).click();await page.getByLabel('Touch time').selectOption('10:30');assert.equal(await page.getByLabel('Appointment',{exact:true}).inputValue(),'2026-09-28T10:30');
    await page.getByRole('button',{name:'Toggle setting'}).click();await page.getByLabel('Customer',{exact:true}).click();assert.equal(await keyboard.count(),0);await page.keyboard.type('x');assert.ok((await page.locator('output').textContent()).includes('x'));assert.deepEqual(errors,[]);
  } finally {await browser.close();await new Promise(r=>server.close(r));}
});
