import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';

test('real booking ModalFrame follows retained Activity lifetime and restores body scroll',async()=>{
  const executablePath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
  assert.ok(executablePath,'A browser is required for the portal/Activity regression');
  const relative='app/bookings/booking-workspace-client.tsx';
  const source=process.env.BOOKING_MODAL_SOURCE_BASELINE?execFileSync('git',['show',`${process.env.BOOKING_MODAL_SOURCE_BASELINE}:${relative}`],{encoding:'utf8'}):fs.readFileSync(relative,'utf8');
  const ast=ts.createSourceFile(relative,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const functions=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&['ModalFrame','getFocusable','useBookingModalPortalHost'].includes(n.name?.text)).map(n=>n.getText(ast)).join('\n');
  assert.ok(functions.includes('function ModalFrame'));
  const result=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
    import React,{Activity,useState,useEffect,useRef}from'react';import{createRoot}from'react-dom/client';import{createPortal}from'react-dom';
    import{useCloseOnNavigation,useOverlayPortalHost}from'./components/overlay-dismissal';
    const useWorkspaceTranslation=()=>x=>x;const classNames=(...xs)=>xs.filter(Boolean).join(' ');
    ${functions}
    function App(){const[active,setActive]=useState('base');window.active=active;window.showBase=()=>setActive('base');return <>
      <button id="open" onClick={()=>setActive('detail')}>Open Manage</button>
      <Activity mode={active==='base'?'visible':'hidden'}><div>Agenda</div></Activity>
      <Activity mode={active==='detail'?'visible':'hidden'}><div hidden={active!=='detail'}>
        <ModalFrame label="Manage booking" onClose={()=>setActive('base')}><button id="close" onClick={()=>setActive('base')}>x</button></ModalFrame>
      </div></Activity></>};const root=createRoot(document.getElementById('root'));root.render(<App/>);window.unmount=()=>root.unmount();
  `},bundle:true,write:false,jsx:'automatic',plugins:[{name:'next-navigation-fixture',setup(b){b.onResolve({filter:/^next\/navigation$/},()=>({path:'navigation',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const usePathname=()=>"/pos/book";',loader:'js'}));}}]});
  const browser=await chromium.launch({executablePath,headless:true});
  try{
    const page=await browser.newPage();
    await page.setContent('<div id="root"></div><style>.booking-modal-layer{position:fixed;inset:0;background:#eee;z-index:30}.booking-modal-panel{width:100px;height:100px}</style>');
    await page.addScriptTag({content:result.outputFiles[0].text});await page.waitForSelector('#open');
    assert.equal(await page.getByRole('dialog').isVisible(),false,'An initially hidden retained panel must not expose its portal');
    for(const dismiss of ['close','close','escape','outside','navigation']){
      await page.click('#open');await page.getByRole('dialog').waitFor({state:'visible'});
      assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden');
      if(dismiss==='close')await page.click('#close');
      else if(dismiss==='escape')await page.keyboard.press('Escape');
      else if(dismiss==='outside')await page.getByRole('dialog').click({position:{x:300,y:300}});
      else await page.evaluate(()=>window.showBase());
      await page.waitForFunction(()=>window.active==='base'&&![...document.querySelectorAll('[role=dialog]')].some(n=>n.getClientRects().length));
      assert.equal(await page.evaluate(()=>document.body.style.overflow),'');
      assert.equal(await page.locator('[data-booking-modal-host]').count(),0,'Activity cleanup removes modal host');
    }
    await page.click('#open');await page.getByRole('dialog').waitFor({state:'visible'});await page.evaluate(()=>window.unmount());
    assert.equal(await page.getByRole('dialog').isVisible(),false);assert.equal(await page.locator('[data-booking-modal-host]').count(),0);assert.equal(await page.evaluate(()=>document.body.style.overflow),'');
  }finally{await browser.close();}
});
