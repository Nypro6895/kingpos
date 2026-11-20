import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';

test('Read-only gift artwork scrolls from image, text and logo while designer elements still drag',async()=>{
 const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
  import React,{useState} from 'react';
  import {createRoot} from 'react-dom/client';
  import {CustomerGiftCards} from './components/gift-card/customer-gift-cards';
  import {CardArtwork} from './components/gift-card/card-design';
  import {defaultGiftDesign} from './types/gift-card';
  const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
  const initial={...defaultGiftDesign('Synthetic wallet scroll salon',image),image};
  const cards=Array.from({length:5},(_,i)=>({id:'qa-card-'+i,salonId:'qa-salon',salonName:'Synthetic wallet scroll salon',balance:10000,last4:'AA91',status:'active',design:initial,generation:1}));
  window.calls=[];
  const transport=async op=>{window.calls.push(op);if(op!=='list')throw Error('Unexpected wallet mutation: '+op);return {cards};};
  function Designer(){const [design,setDesign]=useState(initial);window.design=design;return <main className="gc gc-shell"><CardArtwork design={design} onChange={setDesign}/><div style={{height:1500}}/></main>;}
  createRoot(document.getElementById('root')).render(location.search==='?designer'?<Designer/>:<CustomerGiftCards transport={transport}/>);
 `},bundle:true,write:false,format:'iife',outfile:'fixture.js',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},logLevel:'error'});
 const js=bundle.outputFiles.find(file=>file.path.endsWith('.js')).text;
 const css=bundle.outputFiles.find(file=>file.path.endsWith('.css')).text;
 const server=createServer((req,res)=>{
  res.setHeader('Content-Type',req.url==='/fixture.js'?'text/javascript':req.url==='/fixture.css'?'text/css':'text/html');
  res.end(req.url==='/fixture.js'?js:req.url==='/fixture.css'?css:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}</style><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch(process.env.TEST_BROWSER_PATH?{executablePath:process.env.TEST_BROWSER_PATH,headless:true}:{channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:393,height:852},hasTouch:true,isMobile:true});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const cdp=await page.context().newCDPSession(page);
  async function gesture(x,y,dx,dy){
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
   for(let step=1;step<=10;step++){
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*step/10,y:y+dy*step/10}]});
    await new Promise(resolve=>setTimeout(resolve,20));
   }
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  }
  await page.goto(origin);await page.locator('.gc-card').first().waitFor();
  const artwork=page.locator('.gc-card').first();
  const targets=[
   ['background image',artwork.locator(':scope > img'),box=>({x:box.x+box.width*.1,y:box.y+box.height*.85})],
   ['card text',artwork.locator('.gc-element').filter({hasText:'Synthetic wallet scroll salon'}),box=>({x:box.x+box.width/2,y:box.y+box.height/2})],
   ['salon logo',artwork.locator('.gc-element img'),box=>({x:box.x+box.width/2,y:box.y+box.height/2})],
  ];
  for(const [name,target,point] of targets){
   await page.evaluate(()=>scrollTo(0,0));await page.waitForFunction(()=>scrollY===0);
   const start=point(await target.boundingBox());
   await gesture(start.x,start.y,0,-180);
   await page.waitForFunction(()=>scrollY>100,{},{timeout:2000}).catch(()=>assert.fail(name+' must allow native vertical scrolling'));
  }
  assert.deepEqual(await page.evaluate(()=>window.calls),['list'],'scrolling must not mutate gift state');
  await page.goto(origin+'/?designer');await page.locator('.gc-card').waitFor();
  for(const [id,target] of [
   ['name',page.locator('.gc-element').filter({hasText:'Synthetic wallet scroll salon'})],
   ['logo',page.locator('.gc-element img')],
  ]){
   const before=await page.evaluate(()=>structuredClone(window.design.elements));
   const box=await target.boundingBox();await gesture(box.x+box.width/2,box.y+box.height/2,40,30);
   const after=await page.evaluate(()=>window.design.elements);
   const previous=before.find(element=>element.id===id),next=after.find(element=>element.id===id);
   assert.ok(next.x>previous.x&&next.y>previous.y,id+' must retain touch dragging');
   assert.deepEqual(after.filter(element=>element.id!==id),before.filter(element=>element.id!==id),'dragging must not move other elements');
   assert.equal(await page.evaluate(()=>scrollY),0,'designer drag must not scroll the page');
  }
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
