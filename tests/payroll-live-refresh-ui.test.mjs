import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

test('payroll coalesces related changes, defers refresh until edits settle, and isolates hidden/salon scopes', {timeout:30000}, async()=>{
  const output=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import React,{Activity,useState}from'react';import{createRoot}from'react-dom/client';
import{PayrollEditBoundary,usePayrollEdits}from'./app/payroll/payroll-edit-boundary';
import{PayrollLiveRefresh,PayrollRefreshProvider}from'./app/payroll/payroll-live-refresh';
window.reads=[];window.listeners=new Map();window.emit=(salon,change)=>{for(const f of window.listeners.get(salon)??[])f(change)};
function Fields(){const{update}=usePayrollEdits();return <><input aria-label='Bonus' onChange={()=>update('a',true)}/><button onClick={()=>update('a',false)}>Saved</button></>}
function App(){const[salon,setSalon]=useState('salon-a'),[visible,setVisible]=useState(true);window.switchSalon=setSalon;window.show=setVisible;
return <Activity mode={visible?'visible':'hidden'}><PayrollRefreshProvider refresh={async()=>{window.reads.push(salon);if(window.hold)await new Promise(resolve=>window.finish=resolve)}}><PayrollEditBoundary key={salon}><PayrollLiveRefresh salonId={salon}/><Fields/></PayrollEditBoundary></PayrollRefreshProvider></Activity>}
createRoot(document.getElementById('root')).render(<App/>);
`},bundle:true,write:false,platform:'browser',jsx:'automatic',alias:{'@':process.cwd()},plugins:[{name:'payroll-sync-fixture',setup(b){
  const modules={
    'next/navigation':`export const useRouter=()=>({refresh(){throw Error('Installed refresh must use its resource, not only refresh context')}});`,
    'workspace-language':`export const WorkspaceText=({text})=>text;export const useWorkspaceTranslation=()=>x=>x;`,
    'pos-workspace-sync':`export function subscribePosChanges(salon,fn){let list=window.listeners.get(salon);if(!list)window.listeners.set(salon,list=new Set());list.add(fn);return()=>list.delete(fn)}`,
  };
  b.onResolve({filter:/.*/},a=>{const k=Object.keys(modules).find(k=>a.path===k||a.path.endsWith('/'+k));return k?{path:k,namespace:'fixture'}:undefined});
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:modules[a.path],loader:'tsx'}));
  }}]});
  const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?output.outputFiles[0].text:'<div id="root"></div><script src="/app.js"></script>')});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true}),page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
    await page.goto('http://127.0.0.1:'+server.address().port);await page.getByLabel('Bonus').fill('52.75');
    await page.evaluate(()=>{for(const resource of ['tickets','report','staff'])window.emit('salon-a',{resource})});await page.waitForTimeout(200);
    assert.deepEqual(await page.evaluate(()=>window.reads),[]);assert.equal(await page.getByLabel('Bonus').inputValue(),'52.75');
    await page.getByRole('button',{name:'Saved'}).click();await page.waitForFunction(()=>window.reads.length===1);
    await page.evaluate(()=>{window.hold=true;for(const resource of ['tickets','report','settings'])window.emit('salon-a',{resource})});await page.waitForFunction(()=>window.reads.length===2);
    await page.evaluate(()=>{window.emit('salon-a',{resource:'tickets'});window.emit('salon-a',{resource:'report'});window.hold=false;window.finish()});await page.waitForFunction(()=>window.reads.length===3);
    await page.evaluate(()=>window.show(false));await page.getByLabel('Bonus').waitFor({state:'hidden'});
    await page.evaluate(()=>window.emit('salon-a',{resource:'tickets'}));await page.waitForTimeout(200);assert.equal(await page.evaluate(()=>window.reads.length),3);
    await page.evaluate(()=>{window.show(true);window.switchSalon('salon-b')});await page.getByLabel('Bonus').waitFor();
    await page.evaluate(()=>{window.emit('salon-a',{resource:'tickets'});window.emit('salon-b',{resource:'tickets'})});await page.waitForFunction(()=>window.reads.length===4);
    assert.deepEqual(await page.evaluate(()=>window.reads),['salon-a','salon-a','salon-a','salon-b']);assert.equal(await page.getByLabel('Bonus').inputValue(),'');
  }finally{await browser.close();await new Promise(r=>server.close(r));assert.deepEqual(errors,[])}
});
