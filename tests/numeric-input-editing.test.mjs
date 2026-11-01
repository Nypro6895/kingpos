import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

let browser, server, url;
before(async () => {
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React,{StrictMode,useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {NumericInputBehavior} from './components/numeric-input-behavior';
    import {PortableTouchKeyboard} from './app/pos/portable/touch-keyboard';
    import {ShopMoneyWorkspace} from './app/payroll/shop-money-workspace';
    import {StaffIncomeAutosaveInputs} from './app/payroll/staff-income-autosave-inputs';
    window.changes=[];window.saves=[];
    function Editor({id,type='text',mode,initial='0.00',controlled=false,readOnly=false,disabled=false}) {
      const [value,setValue]=useState(initial);
      return <label>{id}<input aria-label={id} name={id} type={type} inputMode={mode} step="0.01"
        readOnly={readOnly} disabled={disabled} {...(controlled?{value}:{defaultValue:initial})}
        onChange={e=>{setValue(e.target.value);window.changes.push([id,e.target.value]);}}/></label>;
    }
    const data={salonId:'salon',today:'2026-11-01',timezone:'America/Chicago',days:[],expenses:[],history:[],collections:[],settings:null,opening:null,cardTransactions:0,giftOpening:0};
    function App(){const [keyboard,setKeyboard]=useState(false),[visible,setVisible]=useState(false);
      return <><NumericInputBehavior/><button onClick={()=>setKeyboard(!keyboard)}>Toggle keyboard</button>
      <main data-portable-shell>
      <Editor id="controlled-number" type="number" controlled/>
      <Editor id="uncontrolled-number" type="number"/>
      <Editor id="controlled-decimal" mode="decimal" controlled/>
      <Editor id="uncontrolled-decimal" mode="decimal"/>
      <Editor id="integer-zero" type="number" initial="0" controlled/>
      <Editor id="nonzero" mode="decimal" initial="12.50" controlled/>
      <Editor id="empty" mode="decimal" initial="" controlled/>
      <Editor id="code" mode="numeric" initial="0000" controlled/>
      <Editor id="phone" type="tel" initial="0000" controlled/>
      <Editor id="check" initial="0000" controlled/>
      <Editor id="read-only" type="number" readOnly/>
      <Editor id="disabled" type="number" disabled/>
      <form id="validated"><label>Validated<input aria-label="validated" name="amount" type="number" defaultValue="0.00" min="0.01" max="100" step="0.01" required/></label></form>
      <button onClick={()=>setVisible(!visible)}>Toggle editor</button>{visible&&<Editor id="dynamic" mode="decimal" controlled/>}
      <ShopMoneyWorkspace salonId="salon" start="2026-11-01" end="2026-11-01" view="expenses" initialData={data}/>
      <StaffIncomeAutosaveInputs bonusAmount={0} bonusPayoutMethod="check" canManage checkNumber="0000" cycleType="weekly" note={null} periodStart="2026-11-01" periodEnd="2026-11-07" staffId="staff" taxBonus={false}/>
      </main><PortableTouchKeyboard enabled={keyboard}/></>;
    }
    createRoot(document.getElementById('root')).render(<StrictMode><App/></StrictMode>);
  ` }, bundle: true, write: false, outdir: 'out', jsx: 'automatic', loader: { '.css': 'css' }, plugins: [{
    name: 'isolated-services', setup(b) {
      b.onResolve({filter:/^(next\/navigation|next\/link|@\/components\/workspace-language|\.\/inline-financial-history|\.\/use-payroll-refresh-batch|@\/app\/payroll\/actions)$/}, a=>({path:a.path,namespace:'fixture'}));
      b.onLoad({filter:/.*/,namespace:'fixture'}, a=>({loader:'tsx',resolveDir:process.cwd(),contents:
        a.path==='next/navigation'?'export const useRouter=()=>({refresh(){}});':
        a.path==='next/link'?'export default function Link({children,...p}){return <a {...p}>{children}</a>}':
        a.path.includes('workspace-language')?'export const WorkspaceText=({text})=><>{text}</>;export const useWorkspaceTranslation=()=>text=>text;':
        a.path.includes('inline-financial-history')?'export const InlineFinancialHistory=()=>null;':
        a.path.includes('use-payroll-refresh-batch')?'export const usePayrollRefreshBatch=()=>{};':
        `export async function autosavePayrollPeriodStaffInputAction(previous,form){window.saves.push(Object.fromEntries(form));return {status:'saved',message:null,savedAt:new Date().toISOString()};}`
      }));
    }
  }] });
  const js=result.outputFiles.find(f=>f.path.endsWith('.js')).text;
  const css=result.outputFiles.find(f=>f.path.endsWith('.css'))?.text??'';
  server=createServer(async(req,res)=>{
    if(req.url==='/api/shop-money'&&req.method==='POST') {
      let body='';for await(const chunk of req)body+=chunk;
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true}));return;
    }
    res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':req.url==='/app.css'?'text/css':'text/html');
    res.end(req.url==='/app.js'?js:req.url==='/app.css'?css:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>');
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  url=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH||'/usr/bin/chromium',headless:true});
});
after(async()=>{await browser?.close();if(server)await new Promise(r=>server.close(r));});

async function withPage(run) {
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try {await page.goto(url);await page.getByLabel('controlled-number',{exact:true}).waitFor();await run(page);assert.deepEqual(errors,[]);}
  finally {await page.close();}
}

test('typing 55 replaces zero in controlled/uncontrolled number and decimal inputs',()=>withPage(async page=>{
  for(const id of ['controlled-number','uncontrolled-number','controlled-decimal','uncontrolled-decimal','integer-zero']) {
    const input=page.getByLabel(id,{exact:true});await input.click();await page.keyboard.press('End');await page.keyboard.type('55');
    assert.equal(await input.inputValue(),'55',id);
    assert.deepEqual(await page.evaluate(id=>window.changes.filter(([key])=>key===id).map(([,v])=>v),id),['5','55']);
  }
}));

test('fractional amounts retain zeroes, decimal points and deletion while typing',()=>withPage(async page=>{
  for(const id of ['controlled-number','controlled-decimal']) {
    const input=page.getByLabel(id,{exact:true});
    for(const value of ['0.55','0.05','0.0055','.55','55.50']) {
      await input.fill('0.00');await page.getByLabel('check',{exact:true}).click();await input.click();await page.keyboard.press('End');await page.keyboard.type(value);
      assert.equal(Number(await input.inputValue()),Number(value),`${id}: ${value}`);
    }
    await input.fill('0.00');await page.keyboard.press('ControlOrMeta+A');await page.keyboard.press('Backspace');
    assert.equal(await input.inputValue(),'');await page.keyboard.type('0.05');assert.equal(await input.inputValue(),'0.05');
  }
}));

test('focus alone preserves values and validity; nonzero edits and identifiers keep their normal caret behavior',()=>withPage(async page=>{
  const zero=page.getByLabel('controlled-number',{exact:true});await zero.click();await page.getByLabel('check',{exact:true}).click();
  assert.equal(await zero.inputValue(),'0.00');assert.deepEqual(await page.evaluate(()=>window.changes),[]);
  const nonzero=page.getByLabel('nonzero',{exact:true});await nonzero.click();await page.keyboard.press('End');await page.keyboard.type('5');assert.equal(await nonzero.inputValue(),'12.505');
  for(const id of ['phone','code','check']) {const input=page.getByLabel(id,{exact:true});await input.click();await page.keyboard.press('End');await page.keyboard.type('55');assert.equal(await input.inputValue(),'000055');}
  assert.equal(await page.getByLabel('read-only',{exact:true}).inputValue(),'0.00');assert.equal(await page.getByLabel('disabled',{exact:true}).inputValue(),'0.00');
  const valid=page.getByLabel('validated',{exact:true});await valid.click();await page.keyboard.type('55');
  assert.equal(await valid.evaluate(e=>e.checkValidity()),true);
  assert.equal(await valid.evaluate(e=>new FormData(e.form).get('amount')),'55');
  await valid.fill('100.01');assert.equal(await valid.evaluate(e=>e.validity.rangeOverflow),true);
  await valid.fill('0.005');assert.equal(await valid.evaluate(e=>e.validity.stepMismatch),true);
}));

test('paste replaces zero and dynamically opened editors use the same behavior',()=>withPage(async page=>{
  await page.context().grantPermissions(['clipboard-read','clipboard-write']);
  await page.evaluate(()=>navigator.clipboard.writeText('55.25'));
  for(const id of ['controlled-number','controlled-decimal']) {const input=page.getByLabel(id,{exact:true});await input.click();await page.keyboard.press('End');await page.keyboard.press('ControlOrMeta+V');assert.equal(await input.inputValue(),'55.25');}
  for(let i=0;i<2;i++){await page.getByRole('button',{name:'Toggle editor',exact:true}).click();const input=page.getByLabel('dynamic',{exact:true});await input.click();await page.keyboard.type('55');assert.equal(await input.inputValue(),'55');await page.getByRole('button',{name:'Toggle editor',exact:true}).click();}
}));

test('supplemental touch keyboard replaces zero, including decimal fields with native keyboard suppressed',()=>withPage(async page=>{
  await page.getByRole('button',{name:'Toggle keyboard',exact:true}).click();
  for(const id of ['controlled-number','controlled-decimal']) {
    const input=page.getByLabel(id,{exact:true});await input.click();
    const keyboard=page.getByRole('group',{name:'Touch keyboard'});await keyboard.waitFor();
    await keyboard.getByRole('button',{name:'5',exact:true}).click();await keyboard.getByRole('button',{name:'5',exact:true}).click();
    assert.equal(await input.inputValue(),'55');
    await keyboard.getByRole('button',{name:'Hide keyboard',exact:true}).click();
  }
}));

test('real Expenses form submits 55 and Bonus autosave is untouched on focus then saves the typed amount',()=>withPage(async page=>{
  await page.getByRole('button',{name:'+ Add',exact:true}).click();
  const amount=page.getByLabel('Amount',{exact:true});await amount.click();await page.keyboard.press('End');await page.keyboard.type('55');
  assert.equal(await amount.inputValue(),'55');
  const sent=page.waitForRequest(req=>req.url().endsWith('/api/shop-money')&&req.method()==='POST');
  await page.getByRole('button',{name:'Save expense',exact:true}).click();
  assert.equal((await sent).postDataJSON().args.amount,'55');
  const bonus=page.locator('[name="bonus_amount"]');await bonus.click();await page.locator('[name="check_number"]').click();
  assert.deepEqual(await page.evaluate(()=>window.saves),[]);
  await bonus.click();await page.keyboard.press('End');await page.keyboard.type('55');
  assert.equal(await bonus.inputValue(),'55');await page.locator('[name="check_number"]').click();
  await page.waitForFunction(()=>window.saves.length===1);
  assert.equal(await page.evaluate(()=>window.saves[0].bonus_amount),'55');
  assert.equal(await page.evaluate(()=>window.saves[0].check_number),'0000');
}));
