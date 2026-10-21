import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';

// Deliberately separate a successful preload from the rendered image lifecycle.
// The real component and Next Image receive delayed/failed DOM images over localhost.
async function fixture() {
  const mock=`export const prepareAdImage=async()=>true;
    export async function adRequest(url,init){const body=init?.body?JSON.parse(init.body):{};
      window.claims??=[];if(body.kind==='view'||body.kind==='click'){window.claims.push({...body,at:performance.now()});return {ok:true}};
      return ['delayed','broken','ready'].map(ticket=>({ticket,title:ticket,caption:'Fixture',image:'/'+ticket+'.svg',href:'#'}));}`;
  const built=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{OwnerSponsoredPost}from'./components/owner-sponsored-post';
    document.addEventListener('load',event=>{if(event.target.tagName==='IMG'){window.imageLoads??={};window.imageLoads[new URL(event.target.src).pathname]=performance.now()}},true);
    createRoot(document.getElementById('root')).render(<OwnerSponsoredPost location="Milwaukee"/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,outfile:'fixture.js',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"','process.env':'{}'},alias:{'@':process.cwd()},plugins:[{name:'local-only',setup(b){
    b.onResolve({filter:/^@\/lib\/advertising-client$/},()=>({path:'mock',namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:mock,loader:'js'}));
  }}]});
  const js=built.outputFiles.find(x=>x.path.endsWith('.js')).text,css=built.outputFiles.find(x=>x.path.endsWith('.css')).text;
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#ddd"/></svg>';
  let releaseImage;
  const released=new Promise(resolve=>{releaseImage=resolve});
  const server=createServer((req,res)=>{
    const send=(type,body)=>{res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(body)};
    if(req.url==='/fixture.js')return send('text/javascript',js);
    if(req.url==='/delayed.svg'){void released.then(()=>{if(!res.destroyed)send('image/svg+xml',svg)});return}
    if(req.url==='/broken.svg'){res.writeHead(404);res.end();return}
    if(req.url==='/ready.svg')return send('image/svg+xml',svg);
    if(req.url!=='/'){res.writeHead(404);res.end();return}
    send('text/html',`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self'; connect-src 'none'"><style>${css}</style><div id="root"></div><script src="/fixture.js"></script>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {url:`http://127.0.0.1:${server.address().port}`,releaseImage,close:()=>new Promise(resolve=>{releaseImage();server.closeAllConnections();server.close(resolve)})};
}

test('rendered image failure removes only its card; delayed DOM load earns one view after a fresh dwell',async()=>{
  const local=await fixture();
  const browser=await chromium.launch({headless:true,executablePath:process.env.TEST_BROWSER_PATH});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1200}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(local.url,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.claims?.some(x=>x.ticket==='ready'&&x.kind==='view'));
    assert.deepEqual(await page.locator('h3').allTextContents(),['delayed','ready'],'failed DOM image removes only its selected slot');
    assert.equal(await page.evaluate(()=>window.claims.filter(x=>x.ticket==='delayed'||x.ticket==='broken').length),0,'pending and failed DOM images cannot earn views');
    local.releaseImage();
    await page.waitForFunction(()=>window.imageLoads?.['/delayed.svg']);
    await page.waitForTimeout(600);
    assert.equal(await page.evaluate(()=>window.claims.filter(x=>x.ticket==='delayed').length),0,'a load does not immediately create a view');
    await page.waitForFunction(()=>window.claims.some(x=>x.ticket==='delayed'&&x.kind==='view'));
    assert.ok(await page.evaluate(()=>window.claims.find(x=>x.ticket==='delayed').at-window.imageLoads['/delayed.svg']>=950),'the visible dwell starts after the DOM image load');
    await page.evaluate(()=>{document.dispatchEvent(new Event('visibilitychange'));document.dispatchEvent(new Event('visibilitychange'));});
    await page.waitForTimeout(1100);
    assert.deepEqual(await page.evaluate(()=>window.claims.map(x=>[x.ticket,x.kind])),[['ready','view'],['delayed','view']],'load/visibility events do not duplicate a ticket claim');
    assert.deepEqual(errors,[]);
  } finally {await browser.close();await local.close();}
});
