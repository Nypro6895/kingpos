import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
test('compact shared calendar: leap month, day, week, month, statuses and mobile fit', {skip:!process.env.ESBUILD_MODULE_PATH,timeout:60000}, async()=>{
  const {build}=await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
  const result=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`import React from 'react';import{createRoot}from'react-dom/client';import{SchedulePicker}from'./components/booking-ui/schedule-picker';function App(){const [value,set]=React.useState({date:'2028-02-18',range:'day',status:''});return <SchedulePicker {...value} onChange={v=>{window.selection=v;set(v)}}/>}createRoot(document.getElementById('root')).render(<App/>);`},bundle:true,write:false,outdir:'fixture',jsx:'automatic'});
  const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH,headless:true});
  try {for(const width of [320,375,1280]){
    const page=await browser.newPage({viewport:{width,height:812}});
    await page.route('http://localhost/',r=>r.fulfill({contentType:'text/html',body:'<style>body{margin:0;padding:10px;font-family:Arial}*{box-sizing:border-box}'+result.outputFiles.find(f=>f.path.endsWith('.css')).text+'</style><div id="root"></div><script src="/app.js"></script>'}));
    await page.route('**/app.js',r=>r.fulfill({contentType:'text/javascript',body:result.outputFiles.find(f=>f.path.endsWith('.js')).text}));
    await page.goto('http://localhost/');
    await page.getByRole('button',{name:'2028-02-29',exact:true}).click();
    assert.equal((await page.evaluate(()=>window.selection)).date,'2028-02-29');
    await page.getByRole('button',{name:'1w',exact:true}).click();
    assert.equal((await page.evaluate(()=>window.selection)).range,'next7');
    await page.getByRole('button',{name:'Pending',exact:true}).click();
    assert.equal((await page.evaluate(()=>window.selection)).status,'pending');
    await page.getByRole('button',{name:'Next month',exact:true}).click();
    await page.getByRole('button',{name:'All appointments in this month',exact:true}).click();
    assert.deepEqual(await page.evaluate(()=>window.selection),{date:'2028-03-01',range:'all',status:'pending'});
    await page.getByRole('button',{name:'No-show',exact:true}).click();
    assert.equal((await page.evaluate(()=>window.selection)).status,'no_show');
    await page.getByRole('button',{name:'All',exact:true}).click();
    assert.equal((await page.evaluate(()=>window.selection)).status,'');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.ok(await page.locator('#root').evaluate(el=>el.getBoundingClientRect().height)<400);
    await page.close();
  }}finally{await browser.close();}
});
