import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {chromium} from 'playwright-core';

const evidence=resolve('artifacts/iphone-keyboard-nav-fix-20261117');
let browser, server, address;
before(async()=>{
  mkdirSync(evidence,{recursive:true});
  const entry=`
    import React,{Activity,StrictMode,useState}from'react';
    import{flushSync}from'react-dom';import{createRoot}from'react-dom/client';
    import{CustomerFormActions}from'./app/customers/customer-form-actions';
    window.keyboard=(height,scale=1)=>{if(!visualViewport)return;Object.defineProperty(visualViewport,'height',{configurable:true,get:()=>height});Object.defineProperty(visualViewport,'scale',{configurable:true,get:()=>scale});visualViewport.dispatchEvent(new Event('resize'))};
    function App(){const[view,setView]=useState('A'),[mounted,setMounted]=useState(true);
      window.changeView=value=>flushSync(()=>setView(value));window.removeForms=()=>flushSync(()=>setMounted(false));
      return <><h1>{view==='other'?'Customers':'Customer form'}</h1>{mounted?['A','B'].map(id=><Activity key={id} mode={view===id||view==='both'?'visible':'hidden'}><form data-form={id}><label>Name {id}<input aria-label={'Name '+id} defaultValue=""/></label><CustomerFormActions><a href="#customers" onClick={event=>{event.preventDefault();setView('other')}}>Cancel {id}</a><button type="button">Save {id}</button></CustomerFormActions></form></Activity>):null}<nav className="workspace-mobile-nav">Today · Bookings · More</nav></>;
    }createRoot(document.getElementById('root')).render(location.search.includes('strict')?<StrictMode><App/></StrictMode>:<App/>);
  `;
  const result=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic'});
  const css=readFileSync('app/customers/customer-form.css','utf8');
  const html='<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'body{margin:16px;font:16px system-ui}input{display:block;min-height:46px;margin:12px 0}form{padding:20px;margin:20px 0 100px}.workspace-mobile-nav{position:fixed;bottom:0;left:0;right:0;min-height:54px;background:white;border-top:1px solid #aaa}</style><div id="root"></div><script>'+result.outputFiles[0].text.replaceAll('</script','<\\/script')+'</script>';
  server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(html)});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));address='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
});
after(async()=>{await browser?.close();if(server)await new Promise(r=>server.close(r))});

const footer=(page,id)=>page.locator(`[data-form=${id}] .customer-form-actions`);
const navVisible=page=>page.waitForFunction(()=>getComputedStyle(document.querySelector('nav')).visibility==='visible');

test('Cancel while keyboard stays open restores nav and preserves the retained draft',async()=>{
  const page=await browser.newPage({viewport:{width:428,height:926}});
  try{
    await page.goto(address);await page.getByRole('textbox',{name:'Name A'}).fill('Unsaved QA draft');
    await page.evaluate(()=>keyboard(460));await page.waitForFunction(()=>document.querySelector('[data-form=A] .customer-form-actions').dataset.keyboardOpen==='true');
    await page.screenshot({path:evidence+'/keyboard-before-cancel.png'});
    await page.getByRole('link',{name:'Cancel A'}).click();await page.getByRole('heading',{name:'Customers'}).waitFor();
    // Deliberately no resize: Activity cleanup must release the global CSS state.
    await navVisible(page);assert.equal(await footer(page,'A').getAttribute('data-keyboard-open'),null);
    assert.equal(await footer(page,'A').evaluate(e=>e.style.getPropertyValue('--customer-keyboard-inset')),'');
    assert.equal(await page.locator('[data-form=A] input').evaluate(e=>e.isConnected&&e.value),'Unsaved QA draft');
    await page.evaluate(()=>{keyboard(926);visualViewport.dispatchEvent(new Event('scroll'))});
    await page.screenshot({path:evidence+'/keyboard-after-cancel.png'});
    await page.evaluate(()=>changeView('A'));await page.getByRole('textbox',{name:'Name A'}).waitFor();
    assert.equal(await page.getByRole('textbox',{name:'Name A'}).inputValue(),'Unsaved QA draft');await navVisible(page);
  }finally{await page.close()}
});

test('A pending frame cannot restore keyboard state after Activity hides; StrictMode and unmount clean up',async()=>{
  const page=await browser.newPage({viewport:{width:428,height:926}});
  try{
    await page.goto(address+'/?strict');await page.getByRole('textbox',{name:'Name A'}).focus();
    await page.evaluate(()=>keyboard(460));await page.waitForFunction(()=>document.querySelector('[data-form=A] .customer-form-actions').dataset.keyboardOpen==='true');
    await page.evaluate(()=>{keyboard(430);changeView('other')});await navVisible(page);
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    assert.equal(await footer(page,'A').getAttribute('data-keyboard-open'),null);
    await page.evaluate(()=>changeView('A'));await page.waitForFunction(()=>document.querySelector('[data-form=A] .customer-form-actions').dataset.keyboardOpen==='true');
    await page.evaluate(()=>removeForms());await navVisible(page);
    assert.equal(await page.locator('.customer-form-actions').count(),0);
  }finally{await page.close()}
});

test('Cleanup belongs to one form and does not clear another visible form keyboard state',async()=>{
  const page=await browser.newPage({viewport:{width:428,height:926}});
  try{
    await page.goto(address);await page.evaluate(()=>changeView('both'));await page.getByRole('textbox',{name:'Name B'}).focus();
    await page.evaluate(()=>keyboard(460));await page.waitForFunction(()=>Array.from(document.querySelectorAll('.customer-form-actions')).every(e=>e.dataset.keyboardOpen==='true'));
    await page.evaluate(()=>changeView('B'));
    assert.equal(await footer(page,'A').getAttribute('data-keyboard-open'),null);
    assert.equal(await footer(page,'B').getAttribute('data-keyboard-open'),'true');
    assert.equal(await page.locator('nav').evaluate(e=>getComputedStyle(e).visibility),'hidden');
    await page.evaluate(()=>changeView('other'));await navVisible(page);
  }finally{await page.close()}
});

test('No visualViewport and pinch zoom leave navigation available',async()=>{
  const page=await browser.newPage({viewport:{width:428,height:926}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
    await page.goto(address);await page.getByRole('textbox',{name:'Name A'}).focus();await page.evaluate(()=>keyboard(460,1.5));await navVisible(page);
    assert.notEqual(await footer(page,'A').getAttribute('data-keyboard-open'),'true');
    await page.addInitScript(()=>Object.defineProperty(window,'visualViewport',{configurable:true,get:()=>undefined}));await page.reload();
    await page.getByRole('textbox',{name:'Name A'}).focus();await page.getByRole('link',{name:'Cancel A'}).click();await navVisible(page);assert.deepEqual(errors,[]);
  }finally{await page.close()}
});
