import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {chromium} from 'playwright-core';

function source(file, name) {
  const ast=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  return ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name).getText(ast);
}

test('Book held reads keep date controls, never reuse rows or another scope reference, and withdraw on denial', {timeout:30000}, async()=>{
  const entry=`
    import React,{useState,useEffect,useLayoutEffect,useRef} from 'react';
    import{createRoot}from'react-dom/client';
    import{ownerLocalReadName,ownerLocalReadArgs}from'./lib/owner-local-workspace';
    const WorkspaceText=({text})=>text;
    const CalendarIcon=()=>null,ChevronIcon=()=>null,SettingsIcon=()=>null,ContextualSupport=()=>null;
    const SchedulePicker=({onChange})=><button onClick={()=>onChange({date:'2026-11-20',range:'next7',status:'confirmed'})}>Choose test range</button>;
    const usePosResourceRefresh=()=>{},invalidateAppLocalResource=async()=>{};
    const useAppLocalResource=()=>window.qa.resource;
    const useOwnerLocalWorkspace=()=>window.qa.workspace;
    const OwnerLocalPanelBody=()=> <p>OLD APPOINTMENT</p>;
    ${source('app/bookings/booking-workspace-client.tsx','buildUrl')}
    ${source('app/bookings/booking-workspace-client.tsx','BookingWorkspacePending')}
    ${source('app/pos/owner-local-panels.tsx','OwnerPanel')}
    window.qa={resource:{data:{view:'bookings'},updatedAt:1,refresh:async()=>{},loading:false},workspace:{scope:'A',businessDate:'2026-11-15',reference:{salonId:'salon-A',today:'2026-11-15'}}};
    function App(){const[href,setHref]=useState('/pos/book?date=2026-11-15&q=keep&staff=s1&bookingId=old');const[n,setN]=useState(0);
      window.change=(resource,workspace)=>{Object.assign(qa.resource,resource);if(workspace)qa.workspace=workspace;setN(n=>n+1)};
      return <OwnerPanel href={href} active scope="A" salonId="salon-A" navigate={value=>{window.target=value;setHref(value)}}/>;
    }createRoot(document.getElementById('root')).render(<App/>);
  `;
  const bundle=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic'});
  const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<div id="root"></div><script>'+bundle.outputFiles[0].text.replaceAll('</script','<\\/script')+'</script>')});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try{
    const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto('http://127.0.0.1:'+server.address().port);
    await page.getByText('OLD APPOINTMENT').waitFor();
    await page.evaluate(()=>change({data:undefined,loading:true}));
    await page.getByTestId('booking-owner-pending').waitFor();
    assert.equal(await page.getByText('OLD APPOINTMENT').count(),0);
    assert.equal(await page.getByRole('button',{name:'Today',exact:true}).isEnabled(),true);
    await page.getByRole('button',{name:'Next day',exact:true}).click();
    let query=new URL(await page.evaluate(()=>target),'https://reylumi.com').searchParams;
    assert.equal(query.get('date'),'2026-11-16');assert.equal(query.get('q'),'keep');assert.equal(query.get('staff'),'s1');assert.equal(query.has('bookingId'),false);assert.equal(query.get('view'),'day');
    await page.locator('summary').filter({hasText:'Calendar'}).click();
    await page.getByRole('button',{name:'Choose test range'}).click();
    query=new URL(await page.evaluate(()=>target),'https://reylumi.com').searchParams;
    assert.equal(query.get('date'),'2026-11-20');assert.equal(query.get('range'),'next7');assert.equal(query.get('status'),'confirmed');assert.equal(query.get('view'),'list');
    await page.evaluate(()=>change({}, {scope:'B',businessDate:'2026-12-01',reference:{salonId:'salon-A',today:'2026-12-01'}}));
    await page.waitForFunction(()=>document.querySelector('nav button').disabled);
    assert.equal(await page.getByRole('button',{name:'Today',exact:true}).isDisabled(),true);
    assert.equal(await page.getByRole('button',{name:'Today',exact:true}).getAttribute('aria-current'),null);
    assert.equal(await page.getByRole('button',{name:'Next day',exact:true}).getAttribute('aria-current'),null);
    await page.evaluate(()=>change({accessDenied:true,error:'Access denied',loading:false}));
    await page.waitForFunction(()=>!document.querySelector('[data-testid="booking-owner-pending"]'));
    assert.equal(await page.getByRole('button',{name:'Today',exact:true}).count(),0);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
